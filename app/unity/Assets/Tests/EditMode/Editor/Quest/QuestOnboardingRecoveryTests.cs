using System;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using Object = UnityEngine.Object;

public sealed class QuestOnboardingRecoveryTests
{
    private GameObject host, head;
    private QuestOnboardingView view;
    private QuestOnboardingApi api;
    private static void Set(object target, string name, object value) => target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value);

    private static QuestOnboardingRoom Room(string id)
    {
        var room = new QuestOnboardingRoom();
        typeof(QuestOnboardingRoom).GetProperty("SessionId").SetValue(room, id);
        typeof(QuestOnboardingRoom).GetProperty("JoinCode").SetValue(room, "ABCD-EFGH");
        return room;
    }

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Recovery test");
        head = new GameObject("Head", typeof(Camera));
        api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity");
        view = host.AddComponent<QuestOnboardingView>();
        view.Configure(null, null, null, head.transform, api);
    }

    [TearDown]
    public void TearDown() { Object.DestroyImmediate(host); Object.DestroyImmediate(head); }

    [Test]
    public async Task ClearingSavedAuthenticationStopsTheConnectionAndDiscardsThePreviousAccountSelection()
    {
        var session = host.AddComponent<QuestPresentationSession>();
        view.Configure(session, null, null, head.transform, api);
        session.ConfigureConnection(new Uri("https://api.example"), "old-room", _ => Task.FromResult("saved-token"));
        Set(api, "credential", "saved-token");
        Set(api, "credentialExpiresAt", DateTimeOffset.UtcNow.AddHours(1));
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        view.Flow.RequireAuthentication();
        Set(view, "room", Room("old-room"));
        Set(view, "ownedRooms", new[] { Room("old-room") });
        Set(view, "nextRoomCursor", "old-room");
        Set(view, "roomListPage", 2);
        Set(view, "listPage", 1);
        Set(view, "presentations", new[] { new QuestOnboardingPresentation() });
        Set(view, "selected", new QuestOnboardingPresentation());
        view.CompleteExternalConnection();

        await view.ClearSavedAuthenticationAsync();

        Assert.That(api.IsAuthenticated, Is.False);
        Assert.That(session.HasConnectionSettings, Is.False);
        Assert.That(view.IsComplete, Is.False);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        Assert.That(view.Flow.Role, Is.EqualTo(QuestOnboardingRole.Presenter));
        Assert.That(view.Flow.IsReturningToRoom, Is.False);
        foreach (string field in new[] { "room", "selected", "authorization", "nextRoomCursor" })
            Assert.That(typeof(QuestOnboardingView).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view), Is.Null, field);
        foreach (string field in new[] { "ownedRooms", "presentations" })
            Assert.That((Array)typeof(QuestOnboardingView).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view), Is.Empty, field);
        Assert.That(view.FindButton("Authorize"), Is.Not.Null);
    }

    private sealed class FailingCredentialStore : IQuestCredentialStore
    {
        public bool FailDelete = true;
        public QuestAccountCredential Load(string scope) => null;
        public void Save(string scope, QuestAccountCredential credential) { }
        public void Delete(string scope) { if (FailDelete) throw new InvalidOperationException(); }
    }

    [Test]
    public async Task StorageDeletionFailureIsShownAndCanBeRetriedFromAuthentication()
    {
        var store = new FailingCredentialStore();
        api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", credentialStore: store);
        view.Configure(null, null, null, head.transform, api);
        await view.ClearSavedAuthenticationAsync();
        Assert.That(view.Panel.transform.Find("Message").GetComponent<UnityEngine.UI.Text>().text, Does.Contain("削除できませんでした"));
        Assert.That(view.FindButton("ClearAuthentication").interactable, Is.True);
        store.FailDelete = false;
        view.FindButton("ClearAuthentication").onClick.Invoke();
        Assert.That(view.Panel.transform.Find("Message").GetComponent<UnityEngine.UI.Text>().text, Does.Contain("削除しました"));
    }

    [Test]
    public async Task ReenablingDuringAuthenticationRemovalRestoresUsableButtonsAfterCompletion()
    {
        var gate = (System.Threading.SemaphoreSlim)typeof(QuestOnboardingApi)
            .GetField("authGate", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(api);
        await gate.WaitAsync();
        Task clearing = null;
        try
        {
            clearing = view.ClearSavedAuthenticationAsync();
            Assert.That(clearing.IsCompleted, Is.False);
            typeof(QuestOnboardingView).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
            typeof(QuestOnboardingView).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
            Assert.That(view.FindButton("Presenter").interactable, Is.False);
        }
        finally { gate.Release(); }
        await clearing;
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(view.FindButton("Presenter").interactable, Is.True);
    }

    [TestCase(QuestOnboardingPage.Role)]
    [TestCase(QuestOnboardingPage.Rooms)]
    public void SavedAuthenticationCanBeClearedBeforeConnecting(QuestOnboardingPage page)
    {
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        view.Flow.GoTo(page);
        view.Refresh();
        var button = view.FindButton("ClearAuthentication");
        Assert.That(button, Is.Not.Null);
        button.onClick.Invoke();
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        Assert.That(view.FindButton("Authorize"), Is.Not.Null);
    }

    [Test]
    public async Task ExpiredAuthenticationReturnsToApprovalAndPreservesTheOriginalRoomAndRole()
    {
        var room = Room("original-session");
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        Set(view, "room", room);
        typeof(QuestOnboardingView).GetProperty("IsComplete").SetValue(view, true);
        Assert.That(view.NeedsReauthentication, Is.True);
        await view.RetryConnectionAsync();
        Assert.That(view.IsComplete, Is.False);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        Assert.That(view.Flow.Role, Is.EqualTo(QuestOnboardingRole.Presenter));
        Assert.That(typeof(QuestOnboardingView).GetField("room", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view), Is.SameAs(room));
        Assert.That(view.FindButton("Authorize"), Is.Not.Null);
        view.FindButton("Back").onClick.Invoke();
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(view.NeedsReauthentication, Is.False);
    }

    [Test]
    public async Task ApprovalReconnectsTheOriginalSessionWithoutLoadingOrCreatingAnotherRoom()
    {
        var session = host.AddComponent<QuestPresentationSession>();
        var entry = host.AddComponent<QuestPresentationEntry>();
        view.Configure(session, entry, null, head.transform, api);
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        Set(view, "room", Room("original-session"));
        await view.RetryConnectionAsync();
        Set(api, "credential", "renewed-token");
        Set(api, "credentialExpiresAt", DateTimeOffset.UtcNow.AddHours(1));
        // Deliberately omit a tracking origin so the connection stops before any network access.
        var action = (Task)typeof(QuestOnboardingView).GetMethod("AfterAuthentication", BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(view, new object[] { System.Threading.CancellationToken.None });
        Assert.ThrowsAsync<InvalidOperationException>(async () => await action);
        Assert.That(session.SessionId, Is.EqualTo("original-session"));
        Assert.That(session.HasConnectionSettings, Is.True);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        Assert.That(view.IsComplete, Is.False);
    }

    [Test]
    public void PlaybackReturnsAnExpiredAnonymousViewerToJoinWithoutDeviceApproval()
    {
        var entry = host.AddComponent<QuestPresentationEntry>();
        view.Configure(null, entry, null, head.transform, api);
        view.Flow.SelectRole(QuestOnboardingRole.Audience);
        Set(view, "room", Room("session"));
        view.CompleteExternalConnection();
        Assert.That(entry.PresentationDisplayEnabled, Is.True);
        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Assert.That(view.IsComplete, Is.False);
        Assert.That(entry.PresentationDisplayEnabled, Is.False);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Join));
        Assert.That(view.FindButton("Authorize"), Is.Null);
        Assert.That(view.FindButton("Join"), Is.Not.Null);
    }

    [Test]
    public async Task ServerRejectedCredentialReturnsToApprovalEvenBeforeLocalExpiry()
    {
        var entry = host.AddComponent<QuestPresentationEntry>();
        view.Configure(null, entry, null, head.transform, api);
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        Set(view, "room", Room("session"));
        Set(api, "credential", "revoked-token");
        Set(api, "credentialExpiresAt", DateTimeOffset.UtcNow.AddHours(1));
        typeof(QuestPresentationEntry).GetProperty("LastErrorCode").SetValue(entry, "authentication-required");
        Assert.That(view.NeedsReauthentication, Is.True);
        await view.RetryConnectionAsync();
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        Assert.That(view.FindButton("Authorize"), Is.Not.Null);
    }

    [Test]
    public void DisablingAfterEntryReturnsToRoleSelectionWhenEnabledAgain()
    {
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        Set(view, "room", Room("session"));
        typeof(QuestOnboardingView).GetProperty("IsComplete").SetValue(view, true);
        typeof(QuestOnboardingView).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        typeof(QuestOnboardingView).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Assert.That(view.IsComplete, Is.False);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(view.NeedsReauthentication, Is.False);
        Assert.That(view.FindButton("Presenter"), Is.Not.Null);
    }

    [Test]
    public async Task DisablingDuringReauthenticationDiscardsThePendingRoom()
    {
        view.Flow.SelectRole(QuestOnboardingRole.Audience);
        Set(view, "room", Room("session"));
        await view.RetryConnectionAsync();
        typeof(QuestOnboardingView).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        typeof(QuestOnboardingView).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(view.NeedsReauthentication, Is.False);
    }

    [Test]
    public void AValidCredentialOrNoRoomDoesNotStartReauthentication()
    {
        Assert.That(view.NeedsReauthentication, Is.False);
        Set(view, "room", Room("session"));
        Set(api, "credential", "test-token");
        Set(api, "credentialExpiresAt", DateTimeOffset.UtcNow.AddHours(1));
        Assert.That(view.NeedsReauthentication, Is.False);
    }
}

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

    [TestCase(QuestOnboardingRole.Presenter)]
    [TestCase(QuestOnboardingRole.Audience)]
    public async Task ExpiredAuthenticationReturnsToApprovalAndPreservesTheOriginalRoomAndRole(QuestOnboardingRole role)
    {
        var room = Room("original-session");
        view.Flow.SelectRole(role);
        Set(view, "room", room);
        typeof(QuestOnboardingView).GetProperty("IsComplete").SetValue(view, true);
        Assert.That(view.NeedsReauthentication, Is.True);
        await view.RetryConnectionAsync();
        Assert.That(view.IsComplete, Is.False);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        Assert.That(view.Flow.Role, Is.EqualTo(role));
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
    public void PlaybackDetectsExpiredAuthenticationWithoutWaitingForAButtonPress()
    {
        view.Flow.SelectRole(QuestOnboardingRole.Audience);
        Set(view, "room", Room("session"));
        typeof(QuestOnboardingView).GetProperty("IsComplete").SetValue(view, true);
        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Assert.That(view.IsComplete, Is.False);
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        Assert.That(view.FindButton("Authorize"), Is.Not.Null);
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

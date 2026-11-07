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
    private System.Threading.CancellationTokenSource connectionLifetime;
    private PresentationSceneRenderer renderer;
    private PresentationRealtimeConnection realtime;
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
    public void TearDown()
    {
        connectionLifetime?.Cancel();
        realtime?.Dispose(); renderer?.Dispose();
        Object.DestroyImmediate(host); Object.DestroyImmediate(head);
        connectionLifetime?.Dispose();
        connectionLifetime = null; realtime = null; renderer = null;
    }

    private void PrepareConnectedEntry(bool presenter = true)
    {
        var entry = host.AddComponent<QuestPresentationEntry>();
        var runtime = host.GetComponent<PresentationBakedRuntime>();
        var store = (PresentationRuntimeDataStore)typeof(PresentationBakedRuntime)
            .GetField("store", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(runtime);
        var delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        delivery.ProjectionProfile.Key.Role = presenter ? Unframe.Presentation.SessionRole.Presenter : Unframe.Presentation.SessionRole.Viewer;
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        renderer = new PresentationSceneRenderer();
        typeof(PresentationSceneRenderer).GetProperty("Spatial").SetValue(renderer, new PresentationSpatialRenderer());
        typeof(PresentationSceneRenderer).GetProperty("Textures").SetValue(renderer, new PresentationTextureResidency());
        typeof(PresentationSceneRenderer).GetProperty("Models").SetValue(renderer, new PresentationModelResidency());
        typeof(PresentationSceneRenderer).GetProperty("Videos").SetValue(renderer, new PresentationVideoResidency());
        Set(renderer, "loaded", true);
        Set(renderer, "files", new PresentationRuntimeAssetFiles());
        Set(renderer, "native", new PresentationNativeSurfaceRenderer());
        Set(runtime, "sceneRenderer", renderer);
        realtime = new PresentationRealtimeConnection(store, renderer.Textures);
        typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(realtime, true);
        typeof(PresentationBakedRuntime).GetProperty("DownloadReady").SetValue(runtime, true);
        Set(runtime, "connection", realtime);
        connectionLifetime = new System.Threading.CancellationTokenSource();
        Set(entry, "lifetime", connectionLifetime);
        view.Configure(null, entry, null, head.transform, api);
        Set(view, "room", Room("session"));
        Set(view, "connectedSessionId", "session");
        Set(view, "ownsConnection", true);
        Set(view, "message", "ルームの準備を待っています。");
        Assert.That(entry.ControlReady, Is.True);
    }

    [TestCase(QuestOnboardingPage.Calibration)]
    [TestCase(QuestOnboardingPage.Ready)]
    public void ConnectionFailureDuringAlignmentExplainsRecoveryAndOffersRetry(QuestOnboardingPage page)
    {
        PrepareConnectedEntry();
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        view.Flow.GoTo(page);
        connectionLifetime.Cancel();
        typeof(QuestPresentationEntry).GetProperty("LastErrorCode").SetValue(host.GetComponent<QuestPresentationEntry>(), "network-unavailable");
        Set(host.GetComponent<QuestPresentationEntry>(), "connectionStage", PresentationConnectionStage.Failed);

        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);

        Assert.That(view.FindButton("RetryConnection"), Is.Not.Null);
        Assert.That(view.FindButton("RetryConnection").interactable, Is.True);
        Assert.That(view.Panel.transform.Find("Message").GetComponent<UnityEngine.UI.Text>().text, Does.Contain("再接続"));
        Assert.That(view.FindButton(page == QuestOnboardingPage.Ready ? "Begin" : "Aligned").interactable, Is.False);
    }

    [Test]
    public void EndedAudienceSessionReturnsToCompletionInsteadOfRejoining()
    {
        PrepareConnectedEntry(false);
        view.Flow.SelectRole(QuestOnboardingRole.Audience);
        view.CompleteExternalConnection();
        head.transform.position = new Vector3(5, 0, 0);
        typeof(QuestPresentationEntry).GetProperty("LastErrorCode").SetValue(host.GetComponent<QuestPresentationEntry>(), "session-ended");

        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);

        Assert.That(view.IsComplete, Is.False);
        Assert.That(view.Flow.Page.ToString(), Is.EqualTo("Ended"));
        Assert.That(view.Panel.transform.Find("Heading").GetComponent<UnityEngine.UI.Text>().text, Does.Contain("終了"));
        Assert.That(view.FindButton("Join"), Is.Null);
        Assert.That(view.FindButton("RetryConnection"), Is.Null);
        Assert.That(Vector3.Distance(view.Panel.transform.position, head.transform.position), Is.LessThan(2));
        view.FindButton("LeaveEndedSession").onClick.Invoke();
        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
    }

    [Test]
    public void PreviousAudienceCompletionDoesNotEndADifferentPresenterRoom()
    {
        PrepareConnectedEntry(false);
        view.Flow.SelectRole(QuestOnboardingRole.Audience);
        var viewer = typeof(QuestOnboardingApi).GetField("viewer", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(api);
        viewer.GetType().GetProperty("TerminalErrorCode").SetValue(viewer, "session-ended");
        typeof(QuestPresentationEntry).GetProperty("LastErrorCode").SetValue(host.GetComponent<QuestPresentationEntry>(), "session-ended");
        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        view.FindButton("LeaveEndedSession").onClick.Invoke();
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        view.Flow.GoTo(QuestOnboardingPage.Preparation);
        Set(view, "room", Room("another-session"));

        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);

        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Preparation));
    }

    [Test]
    public async Task RepeatedCancellationWaitsForThePreviousStopBeforeReleasingCredentials()
    {
        var previous = new TaskCompletionSource<bool>();
        Set(view, "stopTask", previous.Task);
        view.ResetFlow();
        view.ResetFlow();
        var stopping = (Task)typeof(QuestOnboardingView).GetField("stopTask", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view);
        Assert.That(stopping.IsCompleted, Is.False);
        previous.SetResult(true);
        await stopping;
        Assert.That(stopping.IsCompleted, Is.True);
    }

    [Test]
    public async Task SlowRoomPreparationKeepsLoadingUntilTheConnectionIsReady()
    {
        PrepareConnectedEntry();
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        view.Flow.GoTo(QuestOnboardingPage.Preparation);
        typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(realtime, false);
        using (var cancellation = new System.Threading.CancellationTokenSource())
        {
            Task connecting = (Task)typeof(QuestOnboardingView).GetMethod("Connect", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(view, new object[] { cancellation.Token });
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(31));
                Assert.That(connecting.IsCompleted, Is.False, "A slow download must not return to the preparation form.");
                typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(realtime, true);
                await connecting;
                Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Calibration));
                Assert.That(typeof(QuestOnboardingView).GetField("message", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view), Is.Empty);
            }
            finally { cancellation.Cancel(); }
        }
    }

    [Test]
    public async Task RoomPreparationReportsAStoppedConnectionInsteadOfWaitingForever()
    {
        PrepareConnectedEntry();
        typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(realtime, false);
        Task connecting = (Task)typeof(QuestOnboardingView).GetMethod("Connect", BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(view, new object[] { System.Threading.CancellationToken.None });
        connectionLifetime.Cancel();
        Exception failure = null;
        try { await connecting; }
        catch (Exception exception) { failure = exception; }
        Assert.That(failure, Is.TypeOf<InvalidOperationException>());
        Assert.That(failure.Message, Is.EqualTo("connection-failed"));
    }

    [Test]
    public async Task RoomPreparationCanBeCancelledWhileWaiting()
    {
        PrepareConnectedEntry();
        typeof(PresentationRealtimeConnection).GetProperty("ControlReady").SetValue(realtime, false);
        using (var cancellation = new System.Threading.CancellationTokenSource())
        {
            Task connecting = (Task)typeof(QuestOnboardingView).GetMethod("Connect", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(view, new object[] { cancellation.Token });
            cancellation.Cancel();
            Exception failure = null;
            try { await connecting; }
            catch (Exception exception) { failure = exception; }
            Assert.That(failure, Is.TypeOf<TaskCanceledException>());
        }
    }

    [TestCase(QuestOnboardingRole.Presenter, QuestOnboardingPage.Preparation, false)]
    [TestCase(QuestOnboardingRole.Audience, QuestOnboardingPage.Join, false)]
    [TestCase(QuestOnboardingRole.Presenter, QuestOnboardingPage.Authentication, true)]
    public void ConnectionCompletingAfterTheWaitAutomaticallyAdvancesToCalibration(
        QuestOnboardingRole role, QuestOnboardingPage page, bool returning)
    {
        PrepareConnectedEntry(role == QuestOnboardingRole.Presenter);
        view.Flow.SelectRole(role);
        if (returning) view.Flow.RequireAuthentication();
        view.Flow.GoTo(page);

        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);

        Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Calibration));
        Assert.That(view.Flow.IsReturningToRoom, Is.False);
        Assert.That(view.Panel.transform.Find("Message").GetComponent<UnityEngine.UI.Text>().text, Is.Empty);
        Assert.That(view.FindButton("Aligned"), Is.Not.Null);
        Assert.That(view.IsComplete, Is.False);
    }

    [TestCase(QuestOnboardingPage.Preparation, true, true, true)]
    [TestCase(QuestOnboardingPage.Preparation, false, false, true)]
    [TestCase(QuestOnboardingPage.Preparation, false, true, false)]
    [TestCase(QuestOnboardingPage.Rooms, false, true, true)]
    [TestCase(QuestOnboardingPage.Authentication, false, true, true)]
    [TestCase(QuestOnboardingPage.Ready, false, true, true)]
    public void LateConnectionDoesNotOverrideAnotherOperationPageOrRole(
        QuestOnboardingPage page, bool busy, bool owned, bool presenter)
    {
        PrepareConnectedEntry(presenter);
        view.Flow.SelectRole(QuestOnboardingRole.Presenter);
        view.Flow.GoTo(page);
        Set(view, "busy", busy); Set(view, "ownsConnection", owned);

        typeof(QuestOnboardingView).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);

        Assert.That(view.Flow.Page, Is.EqualTo(page));
    }

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

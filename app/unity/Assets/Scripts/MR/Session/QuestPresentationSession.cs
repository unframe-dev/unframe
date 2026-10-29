using System;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class QuestPresentationSession : MonoBehaviour
{
    [SerializeField] private QuestPresentationEntry entry;
    [SerializeField] private AprilTagPresentationCalibration calibrationSource;
    [Header("Application connection")]
    [SerializeField] private string controlPlaneEndpoint;
    [SerializeField] private string webEndpoint;
    [SerializeField] private string deviceClientId = "unframe-unity";
    private readonly SemaphoreSlim operationGate = new SemaphoreSlim(1, 1);
    [NonSerialized] private Uri origin;
    [NonSerialized] private string sessionId;
    [NonSerialized] private string logicalEventName;
    [NonSerialized] private Func<CancellationToken, Task<string>> credentialProvider;
    private bool externalConnection;
    private int generation;
    private int pendingOperations;
    public bool HasConnectionSettings => origin != null && credentialProvider != null;
    public bool IsBusy => pendingOperations != 0;
    public string ControlPlaneOrigin => origin?.AbsoluteUri ?? String.Empty;
    public string SessionId => sessionId ?? String.Empty;
    public string LastErrorCode { get; private set; } = String.Empty;

    public void ConfigureConnection(Uri controlPlaneOrigin, string targetSessionId,
        Func<CancellationToken, Task<string>> provider, string advanceLogicalEventName = null, bool managedByOnboarding = false)
    {
        if (controlPlaneOrigin == null || !controlPlaneOrigin.IsAbsoluteUri || controlPlaneOrigin.Scheme != "https"
            || controlPlaneOrigin.AbsolutePath != "/" || !String.IsNullOrEmpty(controlPlaneOrigin.UserInfo)
            || !String.IsNullOrEmpty(controlPlaneOrigin.Query) || !String.IsNullOrEmpty(controlPlaneOrigin.Fragment)
            || String.IsNullOrWhiteSpace(targetSessionId) || provider == null)
            throw new ArgumentException("An authenticated HTTPS Control Plane origin and session are required.");
        externalConnection = !managedByOnboarding;
        generation++;
        origin = controlPlaneOrigin;
        sessionId = targetSessionId;
        credentialProvider = provider;
        logicalEventName = advanceLogicalEventName;
        LastErrorCode = String.Empty;
    }

    public void Connect(Uri controlPlaneOrigin, string targetSessionId,
        Func<CancellationToken, Task<string>> provider, string advanceLogicalEventName = null)
    {
        EnsureTrackingOrigin();
        if (IsBusy || entry.IsRunning) throw new InvalidOperationException("Stop the active session before connecting again.");
        ConfigureConnection(controlPlaneOrigin, targetSessionId, provider, advanceLogicalEventName);
        entry.Configure(origin, sessionId, credentialProvider, calibrationSource.Calibration, logicalEventName);
        CompleteExternalConnection();
    }

    public Task RetryAsync() => ConnectAsync();

    public async Task ConnectAsync()
    {
        int requestedGeneration = generation;
        Interlocked.Increment(ref pendingOperations);
        try
        {
            await operationGate.WaitAsync();
            try
            {
                if (requestedGeneration != generation || !isActiveAndEnabled) return;
                EnsureTrackingOrigin();
                if (!HasConnectionSettings) { LastErrorCode = "connection-settings-required"; return; }
                await entry.StopAsync();
                if (requestedGeneration != generation || !isActiveAndEnabled) return;
                entry.Configure(origin, sessionId, credentialProvider, calibrationSource.Calibration, logicalEventName);
                CompleteExternalConnection();
                LastErrorCode = String.Empty;
            }
            finally { operationGate.Release(); }
        }
        catch (Exception)
        {
            if (requestedGeneration == generation) LastErrorCode = "connection-failed";
        }
        finally { Interlocked.Decrement(ref pendingOperations); }
    }

    public async Task ExitAsync()
    {
        ClearConnection();
        Interlocked.Increment(ref pendingOperations);
        try
        {
            await operationGate.WaitAsync();
            try { if (entry != null) await entry.StopAsync(); }
            finally { operationGate.Release(); }
        }
        finally { Interlocked.Decrement(ref pendingOperations); }
    }

    private void EnsureTrackingOrigin()
    {
        if (!isActiveAndEnabled || entry == null || calibrationSource == null
            || !calibrationSource.isActiveAndEnabled || calibrationSource.QuestTrackingOrigin == null
            || entry.QuestTrackingOrigin != calibrationSource.QuestTrackingOrigin)
            throw new InvalidOperationException("Session and marker calibration must use the same active tracking origin.");
    }

    private void CompleteExternalConnection()
    {
        if (externalConnection) GetComponent<QuestOnboardingView>()?.CompleteExternalConnection();
    }

    private void ClearConnection()
    {
        generation++;
        externalConnection = false;
        credentialProvider = null;
        origin = null;
        sessionId = null;
        logicalEventName = null;
        LastErrorCode = String.Empty;
    }

    private async void OnDisable()
    {
        try { await ExitAsync(); }
        catch (Exception) { }
    }

    private async void Start()
    {
        var view = GetComponent<QuestPresentationStatusView>();
        var runtime = GetComponent<PresentationBakedRuntime>();
        if (view != null && view.Head != null)
        {
            QuestOnboardingApi api = null;
            if (!String.IsNullOrWhiteSpace(controlPlaneEndpoint) && !String.IsNullOrWhiteSpace(webEndpoint))
            {
                try { api = new QuestOnboardingApi(new Uri(controlPlaneEndpoint), new Uri(webEndpoint), deviceClientId); }
                catch (Exception exception) when (exception is ArgumentException || exception is UriFormatException) { LastErrorCode = "application-endpoint-invalid"; }
            }
            var onboarding = GetComponent<QuestOnboardingView>();
            if (onboarding == null) onboarding = gameObject.AddComponent<QuestOnboardingView>();
            onboarding.Configure(this, entry, calibrationSource, view.Head, api);
            onboarding.Completed += () => view.SetMenuOpen(false);
            view.AttachOnboarding(onboarding);
            if (entry.IsRunning) CompleteExternalConnection();
        }
        if (runtime != null && view != null && view.Head != null && calibrationSource != null)
        {
            var guidance = GetComponent<QuestMotionGuideView>();
            if (guidance == null) guidance = gameObject.AddComponent<QuestMotionGuideView>();
            guidance.Configure(runtime, calibrationSource.QuestTrackingOrigin, view.Head, view);
        }
#if UNITY_ANDROID && !UNITY_EDITOR
        try
        {
            string launchOrigin = TakeLaunchExtra("unframe.controlPlaneOrigin");
            string launchSession = TakeLaunchExtra("unframe.sessionId");
            string credential = TakeLaunchExtra("unframe.credential");
            string logicalEvent = TakeLaunchExtra("unframe.advanceLogicalEvent");
            if (String.IsNullOrEmpty(launchOrigin) || String.IsNullOrEmpty(launchSession) || String.IsNullOrEmpty(credential)) return;
            ConfigureConnection(new Uri(launchOrigin), launchSession, _ => Task.FromResult(credential), logicalEvent);
            await ConnectAsync();
        }
        catch (Exception) { LastErrorCode = "launch-configuration-invalid"; }
#else
        await Task.CompletedTask;
#endif
    }

#if UNITY_ANDROID && !UNITY_EDITOR
    private static string TakeLaunchExtra(string key)
    {
        using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
        using (AndroidJavaObject activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
        using (AndroidJavaObject intent = activity.Call<AndroidJavaObject>("getIntent"))
        {
            string value = intent.Call<string>("getStringExtra", key);
            intent.Call("removeExtra", key);
            return value;
        }
    }
#endif
}

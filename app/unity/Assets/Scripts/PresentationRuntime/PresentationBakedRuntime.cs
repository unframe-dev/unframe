using System;
using System.Net.Http;
using Cysharp.Net.Http;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationBakedRuntime : MonoBehaviour
    {
        private readonly PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        private readonly PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
        private readonly PresentationNodeStateApplier stateApplier = new PresentationNodeStateApplier();
        private readonly PresentationPlaybackPlayer playback = new PresentationPlaybackPlayer();
        private PresentationSceneRenderer sceneRenderer;
        private PresentationPlaybackPlayer.RendererRefresh refreshRenderer;
        private PresentationRealtimeConnection connection;
        private RuntimeClockSnapshot clock;
        private double clockReceivedAt;
        private CancellationTokenSource lifetime;
        private PresentationCalibrationState calibration;
        private Transform questTrackingOrigin;
        private Transform presentationSpace;
        private bool displayEnabled = true;
        public bool DisplayEnabled
        {
            get => displayEnabled;
            set
            {
                if (displayEnabled == value) return;
                displayEnabled = value;
                RefreshCalibration();
            }
        }
        public Transform PresentationSpace => presentationSpace;
        public PresentationRuntimeDataStore DataStore => store;
        public bool CalibrationReady => calibration != null && calibration.IsValid
            && PresentationCalibrationMath.TryWorldFromPresentation(calibration.PresentationFromQuestLocal, questTrackingOrigin, out _, out _);
        public string CalibrationError { get; private set; }

        public void ConfigureCalibration(PresentationCalibrationState state, Transform trackingOrigin)
        {
            if (state == null || trackingOrigin == null) throw new ArgumentException("Calibration state and Quest tracking origin are required.");
            if (lifetime != null) throw new InvalidOperationException("Stop the runtime before changing its calibration source.");
            if (calibration != null) calibration.Changed -= RefreshCalibration;
            calibration = state;
            questTrackingOrigin = trackingOrigin;
            calibration.Changed += RefreshCalibration;
            if (presentationSpace == null) presentationSpace = new GameObject("Calibrated Presentation Space").transform;
            RefreshCalibration();
        }

        public void RefreshCalibration()
        {
            if (presentationSpace == null) return;
            CalibrationError = calibration?.Reason ?? "not-calibrated";
            if (calibration == null || !calibration.IsValid)
            {
                presentationSpace.gameObject.SetActive(false);
                return;
            }
            if (!PresentationCalibrationMath.TryWorldFromPresentation(calibration.PresentationFromQuestLocal, questTrackingOrigin,
                out UnityEngine.Pose worldFromPresentation, out string error))
            {
                calibration.Invalidate(error);
                return;
            }
            CalibrationError = null;
            presentationSpace.SetPositionAndRotation(worldFromPresentation.position, worldFromPresentation.rotation);
            presentationSpace.localScale = UnityEngine.Vector3.one;
            presentationSpace.gameObject.SetActive(isActiveAndEnabled && displayEnabled && SessionReady);
        }
        public bool DownloadReady { get; private set; }
        public bool ResidentReady { get { return sceneRenderer != null && sceneRenderer.IsReady(store); } }
        public bool ControlReady { get { return DownloadReady && ResidentReady && connection != null && connection.ControlReady; } }
        public bool SessionReady { get { return DownloadReady && ResidentReady && connection != null && connection.SessionReady; } }
        public ulong PresentationOriginVersion { get { return ControlReady ? store.PresentationOrigin?.Version ?? 0 : 0; } }
        public bool CanSendRuntimeControl { get { return ControlReady && store.Delivery.ProjectionProfile.Key.Role == SessionRole.Presenter; } }
        public System.Collections.Generic.IReadOnlyList<StepSelection> ReachedSteps => connection?.ReachedSteps ?? System.Array.Empty<StepSelection>();
        public event System.Action InputInvalidated;
        public event System.Action<ResyncReason> SnapshotResynchronizationRequired;
        public void DiscardPendingInputs() => connection?.DiscardPendingInputs();
        public PresenterInputSynchronizationState InputSynchronization => connection?.InputSynchronization;
        public bool CanSendInput
        {
            get
            {
                return CalibrationReady && SessionReady && InputSynchronization?.Ready == true
            && store.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running && store.Progression?.PhaseCase == ProgressionRuntimeState.PhaseOneofCase.Stable
            && store.Delivery.ProjectionProfile.Key.Role == SessionRole.Presenter;
            }
        }
        public bool CanSendTracking { get { return CalibrationReady && SessionReady && store.Delivery.ProjectionProfile.Key.Role == SessionRole.Presenter; } }

        public bool IsPresenter => store.Delivery?.ProjectionProfile?.Key?.Role == SessionRole.Presenter;
        public string LastCommandOutcomeCode => ControlReady ? store.LastCommandOutcomeCode : null;
        public string PlaybackStatus => ControlReady && store.RuntimeClock != null ? store.RuntimeClock.StatusCase.ToString() : "Unknown";
        public string LastError { get; private set; }
        public DeliveryManifest Delivery { get { return store.Delivery?.Clone(); } }
        public bool TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot) { return store.TryGetLastConnectionSnapshot(out snapshot); }

        public async Task RunAsync(DeliveryManifest manifest, Uri realtimeEndpoint, Func<CancellationToken, Task<string>> bearerProvider, CancellationToken cancellationToken,
            string certFingerprint = null, PresentationEncodedAssetCache encodedCache = null,
            Func<HttpMessageHandler> httpHandlerFactory = null, Func<YetAnotherHttpHandler> realtimeHandlerFactory = null, PresentationSessionDiagnostics diagnostics = null)
        {
            if (lifetime != null) throw new InvalidOperationException("A presentation is already running.");
            if (calibration == null || questTrackingOrigin == null) throw new InvalidOperationException("Presentation calibration must be configured before running.");
            LastError = null;
            DownloadReady = false;
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            try
            {
                if (!store.TryReceiveDelivery(manifest, out string error)) throw new InvalidOperationException(error);
                if (!hierarchy.TryReplace(store, presentationSpace, out error)) throw new InvalidOperationException(error);
                sceneRenderer = new PresentationSceneRenderer();
                refreshRenderer = (double time, out string renderError) => sceneRenderer.TryRefresh(store, time, out renderError);
                var selectedAssets = new List<AssetAccessBinding>(store.Delivery.AssetAccess);
                string consumerToken = PresentationRuntimeHost.ConsumerToken(store.Delivery.SessionId, store.Delivery.ProjectionInstance.ParticipantId);
                if (!(encodedCache ?? PresentationEncodedAssetCache.Shared).TryReserveSession(consumerToken, selectedAssets, out PresentationEncodedAssetCache.Lease lease, out error))
                    throw new InvalidOperationException(error);
                using (lease)
                using (HttpClient client = new HttpClient(httpHandlerFactory == null ? PresentationAssetDownloader.CreateHandler(realtimeEndpoint, certFingerprint) : httpHandlerFactory()) { Timeout = TimeSpan.FromSeconds(30) })
                    await sceneRenderer.LoadAsync(store, hierarchy,
                        (asset, token) => lease.GetAsync(asset, (binding, cancellation) => PresentationAssetDownloader.DownloadAsync(client, binding, cancellation, certFingerprint == null ? null : realtimeEndpoint, manifest.SessionId, bearerProvider), token), lifetime.Token);
                playback.Models = sceneRenderer.Models;
                playback.Videos = sceneRenderer.Videos;
                DownloadReady = true;
                diagnostics?.Record("assets.ready", direction: "receive", count: selectedAssets.Count);
                connection = new PresentationRealtimeConnection(store, sceneRenderer.Textures,
                    token => sceneRenderer.Videos.PrepareVisibleAsync(store, token), () => sceneRenderer.HasResidentAssets(store), diagnostics);
                connection.RuntimeChanged += Refresh;
                connection.InputSynchronization.Invalidated += () => InputInvalidated?.Invoke();
                connection.Disconnected += HandleDisconnected;
                connection.SnapshotResynchronizationRequired += reason => SnapshotResynchronizationRequired?.Invoke(reason);
                await connection.RunAsync(realtimeEndpoint, bearerProvider, lifetime.Token, certFingerprint, realtimeHandlerFactory);
            }
            catch (Exception exception)
            {
                LastError = exception is OperationCanceledException && lifetime.IsCancellationRequested ? "cancelled" : PresentationConnectionErrors.FromException(exception);
                throw;
            }
            finally
            {
                connection?.Dispose();
                connection = null;
                playback.Clear();
                clock = null;
                sceneRenderer?.Dispose();
                sceneRenderer = null;
                refreshRenderer = null;
                hierarchy.Clear();
                DownloadReady = false;
                RefreshCalibration();
                lifetime.Dispose();
                lifetime = null;
            }
        }

        private void Refresh()
        {
            if (connection != null && !connection.SessionReady) { HandleDisconnected(); return; }
            RefreshCalibration();
            RuntimeClockSnapshot latest = store.RuntimeClock;
            if (latest != null && (clock == null || latest.RuntimeTimeMs != clock.RuntimeTimeMs || latest.StatusCase != clock.StatusCase))
            {
                clock = latest;
                clockReceivedAt = Time.realtimeSinceStartupAsDouble;
            }
            if (!playback.TryRefresh(store, hierarchy, refreshRenderer, RuntimeTimeMs(), out string error, clock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running))
            {
                LastError = error;
                lifetime.Cancel();
            }
        }

        private void HandleDisconnected()
        {
            store.ClearCommandOutcome();
            sceneRenderer?.Videos?.Pause();
            clock = null;
            store.InvalidateAnchorSamples();
            stateApplier.ApplyAnchors(store, hierarchy);
            sceneRenderer?.Disable();
            RefreshCalibration();
        }

        private double RuntimeTimeMs()
        {
            return SampleRuntimeTimeMs(clock, clockReceivedAt, Time.realtimeSinceStartupAsDouble);
        }

        internal static double SampleRuntimeTimeMs(RuntimeClockSnapshot clock, double receivedAt, double now)
        {
            return PresentationPlaybackPlayer.SampleRuntimeTimeMs(clock, receivedAt, now);
        }

        public Task SendAsync(ControlClientItem command, CancellationToken token)
        {
            if (command == null || !(command.ItemCase == ControlClientItem.ItemOneofCase.RuntimeControl ? CanSendRuntimeControl : CanSendInput))
                throw new InvalidOperationException("Runtime commands require a ready Presenter connection.");
            string clientEventId = command.RuntimeControl?.ClientEventId ?? command.LogicalInput?.ClientEventId ?? command.SurfaceInteraction?.ClientEventId ?? command.GestureInput?.ClientEventId ?? command.ZoneInput?.ClientEventId;
            store.TrackCommand(clientEventId);
            return SendTrackedCommandAsync(command, clientEventId, token);
        }

        private async Task SendTrackedCommandAsync(ControlClientItem command, string clientEventId, CancellationToken token)
        {
            try { await connection.SendAsync(command, token); }
            catch { store.ClearCommandOutcome(clientEventId); throw; }
        }

        public async Task<CommandOutcome> SendConfirmedAsync(ControlClientItem command, CancellationToken token)
        {
            if (command == null || !(command.ItemCase == ControlClientItem.ItemOneofCase.RuntimeControl ? CanSendRuntimeControl : CanSendInput))
                throw new InvalidOperationException("Runtime commands require a ready Presenter connection.");
            string id = command.RuntimeControl?.ClientEventId ?? command.LogicalInput?.ClientEventId ?? command.SurfaceInteraction?.ClientEventId ?? command.GestureInput?.ClientEventId ?? command.ZoneInput?.ClientEventId;
            store.TrackCommand(id);
            try { return await connection.SendConfirmedAsync(command, TimeSpan.FromSeconds(10), token); }
            catch { store.ClearCommandOutcome(id); throw; }
        }

        public Task SendTrackingAsync(TrackingFrame frame, CancellationToken token)
        {
            if (!CanSendTracking) throw new InvalidOperationException("Runtime tracking requires a calibrated ready Presenter.");
            if (frame == null || !calibration.PresentationFromQuestLocal.Equals(frame.PresentationFromQuestLocal))
                throw new InvalidOperationException("Tracking calibration does not match the active local calibration.");
            return connection.SendTrackingAsync(frame, token);
        }

        public bool TryPickInteraction(Ray ray, out string surfaceId, out string interactionId)
        {
            surfaceId = null;
            interactionId = null;
            return CanSendInput && sceneRenderer != null
                && sceneRenderer.TryPickInteraction(ray, store, out surfaceId, out interactionId);
        }

        private void Update()
        {
            RefreshCalibration();
            if (connection != null && !connection.SessionReady) HandleDisconnected();
            if (connection != null && connection.SessionReady && sceneRenderer.HasResidentAssets(store))
            {
                double runtimeTime = RuntimeTimeMs();
                if (!playback.TryUpdate(store, hierarchy, refreshRenderer, runtimeTime, out string error, clock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running))
                {
                    LastError = error;
                    lifetime.Cancel();
                }
            }
            if (connection != null && !sceneRenderer.HasResidentAssets(store))
            {
                LastError = "asset_residency_lost";
                sceneRenderer.Disable();
                connection.Dispose();
            }
        }

        private void OnDisable()
        {
            lifetime?.Cancel();
            if (presentationSpace != null) presentationSpace.gameObject.SetActive(false);
        }

        private void OnDestroy()
        {
            if (calibration != null) calibration.Changed -= RefreshCalibration;
            if (presentationSpace != null)
            {
                if (Application.isPlaying) Destroy(presentationSpace.gameObject);
                else DestroyImmediate(presentationSpace.gameObject);
            }
        }
    }
}

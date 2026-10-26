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
        private PresentationTextureResidency textures;
        private PresentationModelResidency models;
        private PresentationVideoResidency videos;
        private PresentationBakedSurfaceRenderer surfaceRenderer;
        private PresentationRealtimeConnection connection;
        private RuntimeClockSnapshot clock;
        private double clockReceivedAt;
        private CancellationTokenSource lifetime;
        private PresentationCalibrationState calibration;
        private Transform questTrackingOrigin;
        private Transform presentationSpace;
        public Transform PresentationSpace => presentationSpace;
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
            presentationSpace.gameObject.SetActive(isActiveAndEnabled && SessionReady);
        }
        public bool DownloadReady { get; private set; }
        private bool TextureReady { get { return textures != null && store.Delivery != null && store.Delivery.Residency.Textures != null && textures.IsReady(store.Delivery.Residency.Textures.Textures); } }
        public bool ResidentReady { get { return TextureReady && (videos == null || videos.IsReady(store)); } }
        public bool ControlReady { get { return DownloadReady && ResidentReady && connection != null && connection.ControlReady; } }
        public bool SessionReady { get { return DownloadReady && ResidentReady && connection != null && connection.SessionReady; } }
        public ulong PresentationOriginVersion { get { return ControlReady ? store.PresentationOrigin?.Version ?? 0 : 0; } }
        public bool CanSendRuntimeControl { get { return ControlReady && store.Delivery.ProjectionProfile.Key.Role == SessionRole.Presenter; } }
        public System.Collections.Generic.IReadOnlyList<StepSelection> ReachedSteps => connection?.ReachedSteps ?? System.Array.Empty<StepSelection>();
        public event System.Action InputInvalidated;
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
        public string LastError { get; private set; }
        public DeliveryManifest Delivery { get { return store.Delivery?.Clone(); } }
        public bool TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot) { return store.TryGetLastConnectionSnapshot(out snapshot); }

        public async Task RunAsync(DeliveryManifest manifest, Uri realtimeEndpoint, Func<CancellationToken, Task<string>> bearerProvider, CancellationToken cancellationToken,
            string certFingerprint = null, PresentationEncodedAssetCache encodedCache = null,
            Func<HttpMessageHandler> httpHandlerFactory = null, Func<YetAnotherHttpHandler> realtimeHandlerFactory = null)
        {
            if (lifetime != null) throw new InvalidOperationException("A presentation is already running.");
            if (calibration == null || questTrackingOrigin == null) throw new InvalidOperationException("Presentation calibration must be configured before running.");
            LastError = null;
            DownloadReady = false;
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            try
            {
                if (!store.TryReceiveDelivery(manifest, out string error) || !SupportsDelivery()) throw new InvalidOperationException(error ?? "delivery renderer is unsupported");
                textures = new PresentationTextureResidency();
                models = new PresentationModelResidency { Limits = store.Delivery.CapabilityProfile.Limits.Model };
                playback.Models = models;
                var selectedAssets = new List<AssetAccessBinding>();
                foreach (TextureResidencyBinding binding in store.Delivery.Residency.Textures.Textures)
                {
                    if (!store.TryGetAsset(binding.AssetId, out AssetAccessBinding access)) throw new InvalidOperationException("asset access binding is absent");
                    selectedAssets.Add(access);
                }
                foreach (var binding in store.Delivery.Residency.Models.Models)
                {
                    if (!store.TryGetAsset(binding.AssetId, out var access)) throw new InvalidOperationException("model asset access binding is absent");
                    selectedAssets.Add(access);
                }
                foreach (var binding in store.Delivery.Residency.Video.Videos)
                {
                    if (!store.TryGetAsset(binding.AssetId, out var access)) throw new InvalidOperationException("video asset access binding is absent");
                    selectedAssets.Add(access);
                }
                string consumerToken = PresentationRuntimeHost.ConsumerToken(store.Delivery.SessionId, store.Delivery.ProjectionInstance.ParticipantId);
                if (!(encodedCache ?? PresentationEncodedAssetCache.Shared).TryReserveSession(consumerToken, selectedAssets, out PresentationEncodedAssetCache.Lease lease, out error))
                    throw new InvalidOperationException(error);
                using (lease)
                using (HttpClient client = new HttpClient(httpHandlerFactory == null ? new HttpClientHandler { AllowAutoRedirect = false } : httpHandlerFactory()) { Timeout = TimeSpan.FromSeconds(30) })
                {
                    foreach (TextureResidencyBinding binding in store.Delivery.Residency.Textures.Textures)
                    {
                        lifetime.Token.ThrowIfCancellationRequested();
                        if (!store.TryGetAsset(binding.AssetId, out AssetAccessBinding access)) throw new InvalidOperationException("asset access binding is absent");
                        byte[] bytes = await lease.GetAsync(access, (asset, token) => DownloadAsync(client, asset, token), lifetime.Token);
                        if (!textures.TryLoad(binding, access, bytes, out error)) throw new InvalidOperationException(error);
                    }
                    var modelBudget = new PresentationModelTextureBudget { Limits = store.Delivery.CapabilityProfile.Limits.Texture, UsedGpuBytes = textures.ResidentGpuBytes };
                    foreach (var textureBinding in store.Delivery.Residency.Textures.Textures) modelBudget.UsedBindings++;
                    foreach (var binding in store.Delivery.Residency.Models.Models)
                    {
                        if (!store.TryGetAsset(binding.AssetId, out var access)) throw new InvalidOperationException("model asset access binding is absent");
                        byte[] bytes = await lease.GetAsync(access, (asset, token) => DownloadAsync(client, asset, token), lifetime.Token);
                        await models.LoadAsync(binding, access, bytes, lifetime.Token, modelBudget);
                    }
                    if (!hierarchy.TryReplace(store, presentationSpace, out error)) throw new InvalidOperationException(error);
                    await models.InstantiateAsync(store, hierarchy, lifetime.Token);
                    videos = new PresentationVideoResidency { Limits = store.Delivery.CapabilityProfile.Limits.Video }; playback.Videos = videos;
                    await videos.BuildAsync(store, hierarchy, async (id, token) =>
                    {
                        if (!store.TryGetAsset(id, out var access)) throw new InvalidOperationException("video asset access binding is absent");
                        return new PresentationPreviewAssetData(await lease.GetAsync(access, (asset, t) => DownloadAsync(client, asset, t), token), access.MediaType);
                    }, lifetime.Token);
                }
                DownloadReady = true;
                if (!TextureReady) throw new InvalidOperationException("asset-texture-residency-failed");
                surfaceRenderer = new PresentationBakedSurfaceRenderer();
                if (!surfaceRenderer.TryBuild(store, hierarchy, out error)) throw new InvalidOperationException(error);
                connection = new PresentationRealtimeConnection(store, textures, token => videos.PrepareVisibleAsync(store, token));
                connection.RuntimeChanged += Refresh;
                connection.InputSynchronization.Invalidated += () => InputInvalidated?.Invoke();
                connection.Disconnected += HandleDisconnected;
                await connection.RunAsync(realtimeEndpoint, bearerProvider, lifetime.Token, certFingerprint, realtimeHandlerFactory);
            }
            catch (Exception exception)
            {
                LastError = exception is OperationCanceledException ? "cancelled" : exception is Grpc.Core.RpcException rpc ? rpc.Status.Detail
                    : exception is PresentationDeliveryReloadRequiredException ? "delivery-reload-required"
                    : exception is InvalidOperationException ? exception.Message : "presentation runtime resource failure";
                throw;
            }
            finally
            {
                connection?.Dispose();
                connection = null;
                playback.Clear();
                clock = null;
                surfaceRenderer?.Dispose();
                surfaceRenderer = null;
                videos?.Dispose();
                videos = null;
                models?.Dispose();
                models = null;
                hierarchy.Clear();
                textures?.Dispose();
                textures = null;
                DownloadReady = false;
                RefreshCalibration();
                lifetime.Dispose();
                lifetime = null;
            }
        }

        private bool SupportsDelivery()
        {
            if (store.Delivery.Residency.Textures == null || store.Delivery.ProjectionProfile.LocalOverlays.Count != 0) return false;
            foreach (DeliveredRenderSurface surface in store.Delivery.ProjectionProfile.RenderSurfaces) if (surface.RendererKind != RendererKind.BakedWeb && surface.RendererKind != RendererKind.Video) return false;

            return true;
        }

        private static async Task<byte[]> DownloadAsync(HttpClient client, AssetAccessBinding access, CancellationToken token)
        {
            if (!Uri.TryCreate(access.Url, UriKind.Absolute, out Uri url) || url.Scheme != "https"
                || !string.IsNullOrEmpty(url.UserInfo) || access.ExpiresAtUnixMs <= (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                || access.EncodedSizeBytes == 0 || access.EncodedSizeBytes > PresentationModelPreflight.MaximumEncodedBytes) throw new InvalidOperationException("asset-download-access-invalid");
            using (HttpResponseMessage response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token))
            {
                if (!response.IsSuccessStatusCode || response.Content.Headers.ContentType?.MediaType != access.MediaType
                    || response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value != (long)access.EncodedSizeBytes)
                    throw new InvalidOperationException("asset-download-metadata-mismatch");
                byte[] bytes = new byte[(int)access.EncodedSizeBytes];
                using (System.IO.Stream stream = await response.Content.ReadAsStreamAsync())
                {
                    int offset = 0;
                    while (offset < bytes.Length)
                    {
                        int read = await stream.ReadAsync(bytes, offset, bytes.Length - offset, token);
                        if (read == 0) throw new InvalidOperationException("asset-download-incomplete");
                        offset += read;
                    }
                    byte[] excess = new byte[1];
                    if (await stream.ReadAsync(excess, 0, 1, token) != 0) throw new InvalidOperationException("asset-download-size-mismatch");
                }
                return bytes;
            }
        }

        private void Refresh()
        {
            if (connection != null && !connection.SessionReady)
            {
                HandleDisconnected();
                return;
            }
            RefreshCalibration();
            RuntimeClockSnapshot latest = store.RuntimeClock;
            if (latest != null && (clock == null || latest.RuntimeTimeMs != clock.RuntimeTimeMs || latest.StatusCase != clock.StatusCase))
            {
                clock = latest;
                clockReceivedAt = Time.realtimeSinceStartupAsDouble;
            }
            if (!playback.TryRefresh(store, hierarchy, surfaceRenderer, textures, RuntimeTimeMs(), out string error, clock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running))
            {
                LastError = error;
                lifetime.Cancel();
            }
        }

        private void HandleDisconnected()
        {
            videos?.Pause();
            clock = null;
            store.InvalidateAnchorSamples();
            stateApplier.ApplyAnchors(store, hierarchy);
            surfaceRenderer?.Disable();
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
            return connection.SendAsync(command, token);
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
            return CanSendInput && surfaceRenderer != null
                && surfaceRenderer.TryPickInteraction(ray, store, textures, out surfaceId, out interactionId);
        }

        private void Update()
        {
            RefreshCalibration();
            if (connection != null && !connection.SessionReady) HandleDisconnected();
            if (connection != null && connection.SessionReady && TextureReady)
            {
                double runtimeTime = RuntimeTimeMs();
                if (!playback.TryUpdate(store, hierarchy, surfaceRenderer, textures, runtimeTime, out string error, clock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running))
                {
                    LastError = error;
                    lifetime.Cancel();
                }
            }
            if (connection != null && !TextureReady)
            {
                LastError = "asset_residency_lost";
                surfaceRenderer.Disable();
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

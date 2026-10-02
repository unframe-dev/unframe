using System;
using System.Net.Http;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery.V2;
using Unframe.Presentation.V2;
using Unframe.Realtime.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationBakedRuntime : MonoBehaviour
    {
        private readonly PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        private readonly PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
        private readonly PresentationNodeStateApplier stateApplier = new PresentationNodeStateApplier();
        private PresentationTextureResidency textures;
        private PresentationBakedSurfaceRenderer surfaceRenderer;
        private PresentationRealtimeConnection connection;
        private readonly PresentationTimelinePlayer timelines = new PresentationTimelinePlayer();
        private readonly Dictionary<string, string> activeTimelineRuns = new Dictionary<string, string>();
        private RuntimeClockSnapshot clock;
        private double clockReceivedAt;
        private CancellationTokenSource lifetime;
        public bool DownloadReady { get; private set; }
        public bool ResidentReady { get { return textures != null && store.Delivery != null && store.Delivery.Residency.Textures != null && textures.IsReady(store.Delivery.Residency.Textures.Textures); } }
        public bool SessionReady { get { return DownloadReady && ResidentReady && connection != null && connection.SessionReady; } }
        public ulong PresentationOriginVersion { get { return SessionReady ? store.PresentationOrigin?.Version ?? 0 : 0; } }
        public bool CanSendInput { get { return SessionReady && store.Delivery.ProjectionProfile.Key.Role == SessionRole.Presenter; } }
        public bool CanSendTracking { get { return CanSendInput; } }
        public string LastError { get; private set; }

        public async Task RunAsync(DeliveryManifest manifest, Uri realtimeEndpoint, Func<CancellationToken, Task<string>> bearerProvider, CancellationToken cancellationToken,
            string certFingerprint = null, PresentationEncodedAssetCache encodedCache = null)
        {
            if (lifetime != null) throw new InvalidOperationException("A presentation is already running.");
            LastError = null;
            DownloadReady = false;
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            try
            {
                if (!store.TryReceiveDelivery(manifest, out string error) || !SupportsDelivery()) throw new InvalidOperationException(error ?? "delivery renderer is unsupported");
                textures = new PresentationTextureResidency();
                var selectedAssets = new List<AssetAccessBinding>();
                foreach (TextureResidencyBinding binding in store.Delivery.Residency.Textures.Textures)
                {
                    if (!store.TryGetAsset(binding.AssetId, out AssetAccessBinding access)) throw new InvalidOperationException("asset access binding is absent");
                    selectedAssets.Add(access);
                }
                string consumerToken = PresentationRuntimeHost.ConsumerToken(store.Delivery.SessionId, store.Delivery.ProjectionInstance.ParticipantId);
                if (!(encodedCache ?? PresentationEncodedAssetCache.Shared).TryReserveSession(consumerToken, selectedAssets, out PresentationEncodedAssetCache.Lease lease, out error))
                    throw new InvalidOperationException(error);
                using (lease)
                using (HttpClient client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(30) })
                {
                    foreach (TextureResidencyBinding binding in store.Delivery.Residency.Textures.Textures)
                    {
                        lifetime.Token.ThrowIfCancellationRequested();
                        if (!store.TryGetAsset(binding.AssetId, out AssetAccessBinding access)) throw new InvalidOperationException("asset access binding is absent");
                        byte[] bytes = await lease.GetAsync(access, (asset, token) => DownloadAsync(client, asset, token), lifetime.Token);
                        if (!textures.TryLoad(binding, access, bytes, out error)) throw new InvalidOperationException(error);
                    }
                }
                DownloadReady = true;
                if (!ResidentReady) throw new InvalidOperationException("asset-texture-residency-failed");
                if (!hierarchy.TryReplace(store, transform, out error)) throw new InvalidOperationException(error);
                surfaceRenderer = new PresentationBakedSurfaceRenderer();
                if (!surfaceRenderer.TryBuild(store, hierarchy, out error)) throw new InvalidOperationException(error);
                connection = new PresentationRealtimeConnection(store, textures);
                connection.RuntimeChanged += Refresh;
                connection.Disconnected += HandleDisconnected;
                await connection.RunAsync(realtimeEndpoint, bearerProvider, lifetime.Token, certFingerprint);
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
                timelines.Clear();
                activeTimelineRuns.Clear();
                clock = null;
                surfaceRenderer?.Dispose();
                surfaceRenderer = null;
                hierarchy.Clear();
                textures?.Dispose();
                textures = null;
                DownloadReady = false;
                lifetime.Dispose();
                lifetime = null;
            }
        }

        private bool SupportsDelivery()
        {
            if (store.Delivery.Residency.Textures == null || store.Delivery.ProjectionProfile.LocalOverlays.Count != 0) return false;
            foreach (DeliveredRenderSurface surface in store.Delivery.ProjectionProfile.RenderSurfaces) if (surface.RendererKind != RendererKind.BakedWeb) return false;
            foreach (Unframe.Presentation.V2.ProjectedNodeDefinition node in store.Nodes)
                if (node.NodeCase == Unframe.Presentation.V2.ProjectedNodeDefinition.NodeOneofCase.Model) return false;
            return true;
        }

        private static async Task<byte[]> DownloadAsync(HttpClient client, AssetAccessBinding access, CancellationToken token)
        {
            if (!Uri.TryCreate(access.Url, UriKind.Absolute, out Uri url) || url.Scheme != "https"
                || !string.IsNullOrEmpty(url.UserInfo) || access.ExpiresAtUnixMs <= (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                || access.EncodedSizeBytes == 0 || access.EncodedSizeBytes > 17 * 1024 * 1024) throw new InvalidOperationException("asset-download-access-invalid");
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
            RuntimeClockSnapshot latest = store.RuntimeClock;
            if (latest != null && (clock == null || latest.RuntimeTimeMs != clock.RuntimeTimeMs || latest.StatusCase != clock.StatusCase))
            {
                clock = latest;
                clockReceivedAt = Time.realtimeSinceStartupAsDouble;
            }
            stateApplier.Apply(store, hierarchy);
            if (!SyncTimelines(out string error) || !surfaceRenderer.TryRefresh(store, textures, RuntimeTimeMs(), out error))
            {
                LastError = error;
                lifetime.Cancel();
            }
            else timelines.Update(RuntimeTimeMs() / 1000d);
        }

        private void HandleDisconnected()
        {
            store.InvalidateAnchorSamples();
            stateApplier.ApplyAnchors(store, hierarchy);
            surfaceRenderer?.Disable();
        }

        private double RuntimeTimeMs()
        {
            return SampleRuntimeTimeMs(clock, clockReceivedAt, Time.realtimeSinceStartupAsDouble);
        }

        internal static double SampleRuntimeTimeMs(RuntimeClockSnapshot clock, double receivedAt, double now)
        {
            if (clock == null) return 0;
            return clock.RuntimeTimeMs + (clock.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running
                ? Math.Max(0, now - receivedAt) * 1000d : 0d);
        }

        private bool SyncTimelines(out string error)
        {
            var present = new HashSet<string>();
            foreach (RuntimeRunSnapshot run in store.ActiveRuns)
            {
                if (run.RunCase != RuntimeRunSnapshot.RunOneofCase.Timeline) continue;
                string timelineId = run.Timeline.TimelineId;
                string runId = run.RunId.AssignmentEpoch + ":" + run.RunId.RunSequence;
                present.Add(timelineId);
                if (activeTimelineRuns.TryGetValue(timelineId, out string existing) && existing == runId) continue;
                if (!store.TryGetTimeline(timelineId, out var definition))
                {
                    error = "active timeline definition is absent";
                    return false;
                }
                if (!timelines.TryStart(definition, hierarchy, run.StartedAtRuntimeTimeMs / 1000d, out error)) return false;
                activeTimelineRuns[timelineId] = runId;
            }
            foreach (string timelineId in new List<string>(activeTimelineRuns.Keys))
            {
                if (present.Contains(timelineId)) continue;
                timelines.Stop(timelineId);
                activeTimelineRuns.Remove(timelineId);
            }
            error = null;
            return true;
        }

        public Task SendAsync(ControlClientItem command, CancellationToken token)
        {
            if (!CanSendInput) throw new InvalidOperationException("Runtime input requires a ready Presenter session.");
            return connection.SendAsync(command, token);
        }

        public Task SendTrackingAsync(TrackingFrame frame, CancellationToken token)
        {
            if (!SessionReady) throw new InvalidOperationException("Runtime tracking is disabled until session readiness.");
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
            if (connection != null && !connection.SessionReady) HandleDisconnected();
            if (connection != null && connection.SessionReady && ResidentReady)
            {
                stateApplier.ApplyAnchors(store, hierarchy);
                double runtimeTime = RuntimeTimeMs();
                if (!surfaceRenderer.TryRefresh(store, textures, runtimeTime, out string error))
                {
                    LastError = error;
                    lifetime.Cancel();
                }
                else timelines.Update(runtimeTime / 1000d);
            }
            if (connection != null && !ResidentReady)
            {
                LastError = "asset_residency_lost";
                surfaceRenderer.Disable();
                connection.Dispose();
            }
        }

        private void OnDisable() { lifetime?.Cancel(); }
    }
}

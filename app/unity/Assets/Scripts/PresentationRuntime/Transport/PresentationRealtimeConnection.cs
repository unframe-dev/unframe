using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using System.Threading.Tasks;
using Cysharp.Net.Http;
using Grpc.Core;
using Grpc.Net.Client;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationDeliveryReloadRequiredException : Exception
    {
        public ResyncReason Reason { get; }

        public PresentationDeliveryReloadRequiredException(ResyncReason reason)
            : base("Realtime assignment or publication fence changed; reload Delivery.")
        {
            Reason = reason;
        }
    }

    public sealed class PresentationRealtimeConnection : IDisposable
    {
        private sealed class SnapshotResyncRequiredException : Exception { }
        private readonly PresentationRuntimeDataStore store;
        private readonly PresentationTextureResidency textures;
        private readonly SemaphoreSlim writes = new SemaphoreSlim(1, 1);
        private readonly SemaphoreSlim stateWrites = new SemaphoreSlim(1, 1);
        private ulong trackingFrameSequence;
        private CancellationTokenSource lifetime;
        private AsyncDuplexStreamingCall<ControlClientItem, ControlServerItem> control;
        private AsyncDuplexStreamingCall<StateClientItem, StateServerItem> state;
        private string connectionId;
        private RuntimeProjectionFence fence;
        private bool hasSnapshot;
        private bool replayBootstrap;
        private bool replayMarkerPending;
        private bool replayReadyCutAvailable;
        private ulong replayReadyCut;
        private ulong replayOriginVersion;
        private bool awaitingKeyframe = true;
        public bool SessionReady { get; private set; }
        public event Action RuntimeChanged;
        public event Action Disconnected;

        public PresentationRealtimeConnection(PresentationRuntimeDataStore store, PresentationTextureResidency textures)
        {
            this.store = store ?? throw new ArgumentNullException(nameof(store));
            this.textures = textures ?? throw new ArgumentNullException(nameof(textures));
        }

        public async Task RunAsync(Uri endpoint, Func<CancellationToken, Task<string>> bearerProvider, CancellationToken cancellationToken, string certFingerprint = null)
        {
            if (lifetime != null) throw new InvalidOperationException("A connection is already running.");
            if (endpoint == null || endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && endpoint.IsLoopback))
                throw new ArgumentException("A TLS endpoint or local development loopback endpoint is required.", nameof(endpoint));
            if (certFingerprint != null && (certFingerprint.Length != 71 || !certFingerprint.StartsWith("sha256:", StringComparison.Ordinal)
                || !System.Text.RegularExpressions.Regex.IsMatch(certFingerprint.Substring(7), "^[0-9a-f]{64}$") || endpoint.Scheme != "https"))
                throw new ArgumentException("A lowercase SHA-256 TLS certificate fingerprint and HTTPS endpoint are required.", nameof(certFingerprint));
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            try
            {
                for (int attempt = 0; ; attempt++)
                {
                    RequireResidency();
                    string bearer = await bearerProvider(lifetime.Token);
                    if (string.IsNullOrWhiteSpace(bearer)) throw new InvalidOperationException("A fresh realtime bearer credential is required.");
                    try
                    {
                        await RunConnectionAsync(endpoint, bearer, certFingerprint, lifetime.Token);
                        throw new RpcException(new Status(StatusCode.Unavailable, "realtime stream ended"));
                    }
                    catch (RpcException exception) when (attempt < 5 && !lifetime.IsCancellationRequested && TryPrepareSnapshotRetry(exception))
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(5000, 250 * (1 << attempt))), lifetime.Token);
                    }
                    catch (RpcException exception) when (exception.StatusCode == StatusCode.Unavailable && attempt < 5 && !lifetime.IsCancellationRequested)
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(5000, 250 * (1 << attempt))), lifetime.Token);
                    }
                    catch (SnapshotResyncRequiredException) when (attempt < 5 && !lifetime.IsCancellationRequested)
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(5000, 250 * (1 << attempt))), lifetime.Token);
                    }
                    catch (SnapshotResyncRequiredException)
                    {
                        lifetime.Token.ThrowIfCancellationRequested();
                        throw Failure("realtime snapshot resynchronization exhausted");
                    }
                }
            }
            finally
            {
                SessionReady = false;
                Disconnected?.Invoke();
                lifetime.Dispose();
                lifetime = null;
            }
        }

        private async Task RunConnectionAsync(Uri endpoint, string bearer, string certFingerprint, CancellationToken token)
        {
            using (YetAnotherHttpHandler handler = new YetAnotherHttpHandler { Http2Only = true })
            {
                if (certFingerprint != null)
                    handler.OnVerifyServerCertificate = (serverName, certificateDer, now) => VerifyCertificate(endpoint.Host, serverName, certificateDer, now, certFingerprint);
                using (GrpcChannel channel = GrpcChannel.ForAddress(endpoint, new GrpcChannelOptions { HttpHandler = handler, MaxReceiveMessageSize = 4 * 1024 * 1024, MaxSendMessageSize = 1024 * 1024 }))
                {
                    RealtimeService.RealtimeServiceClient client = new RealtimeService.RealtimeServiceClient(channel);
                    Metadata headers = new Metadata { { "authorization", "Bearer " + bearer } };
                    using (control = client.ConnectControl(headers, cancellationToken: token))
                    {
                        Task stateLoop = null;
                        try
                        {
                            ControlHandshake handshake = new ControlHandshake { ProtocolVersion = "v2", ProgressionContractVersion = store.Delivery.CapabilityProfile.ContractVersions.Progression };
                            handshake.SupportedCapabilities.Add(store.Delivery.ProjectionProfile.RequiredRuntimeCapabilities);
                            bool resuming = connectionId != null && fence != null && hasSnapshot;
                            replayReadyCutAvailable = false;
                            if (resuming)
                            {
                                handshake.Resume = new ResumeCursor { PriorConnectionId = connectionId, AppliedReliableSequence = store.LastReliableSequence, Fence = fence.Clone() };
                                BeginReplayBootstrap();
                            }
                            await WriteAsync(new ControlClientItem { Handshake = handshake }, token);
                            bool connected = false;
                            bool snapshot = false;
                            while (true)
                            {
                                Task<bool> read = control.ResponseStream.MoveNext(token);
                                if (stateLoop != null && await Task.WhenAny(read, stateLoop) == stateLoop) await stateLoop;
                                if (!await read) break;
                                RequireResidency();
                                ControlServerItem item = control.ResponseStream.Current;
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.Connected)
                                {
                                    if (connected || item.Connected.ProtocolVersion != "v2" || item.Connected.ConnectionId.Length == 0
                                        || !store.Delivery.ProjectionInstance.Equals(item.Connected.ProjectionInstance)
                                        || item.Connected.ProgressionContractVersion != handshake.ProgressionContractVersion)
                                        throw Failure("realtime connected projection mismatch");
                                    connected = true;
                                    connectionId = item.Connected.ConnectionId;
                                    continue;
                                }
                                if (!connected) throw Failure("realtime connected message is required first");
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.ResyncRequired)
                                {
                                    HandleResync(item.ResyncRequired.Reason);
                                    continue;
                                }
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.StateConnectionNonce)
                                {
                                    if (resuming && !snapshot)
                                    {
                                        CompleteReplayBootstrap();
                                        snapshot = true;
                                    }
                                    if (!snapshot || stateLoop != null || item.StateConnectionNonce.Nonce.Length != 32 || item.StateConnectionNonce.ExpiresInMs == 0)
                                        throw Failure("realtime state nonce arrived before a snapshot or completed replay, or was duplicated");
                                    state = client.ConnectState(headers, cancellationToken: token);
                                    trackingFrameSequence = 0;
                                    StateHandshake stateHandshake = new StateHandshake { ProtocolVersion = "v2", ProgressionContractVersion = handshake.ProgressionContractVersion, ConnectionId = connectionId, StateConnectionNonce = item.StateConnectionNonce.Nonce };
                                    stateHandshake.SupportedCapabilities.Add(handshake.SupportedCapabilities);
                                    await state.RequestStream.WriteAsync(new StateClientItem { Handshake = stateHandshake });
                                    stateLoop = RunStateAsync(token);
                                    continue;
                                }
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.ConnectionSnapshot)
                                {
                                    if (resuming || snapshot || item.ConnectionSnapshot.ConnectionId != connectionId) throw Failure("realtime snapshot connection mismatch");
                                    fence = item.ConnectionSnapshot.Fence.Clone();
                                    snapshot = true;
                                    hasSnapshot = true;
                                    awaitingKeyframe = true;
                                }
                                if (resuming && !snapshot)
                                {
                                    if (!TryReceiveReplayBootstrap(item, out string replayError)) throw Failure(replayError);
                                }
                                else if (!store.TryReceiveNetworkControl(item, out string error)) throw Failure(error);
                                if (fence != null && store.PresentationOrigin != null)
                                    fence.PresentationOriginVersion = store.PresentationOrigin.Version;
                                RuntimeChanged?.Invoke();
                                if (stateLoop != null && stateLoop.IsCompleted) await stateLoop;
                            }
                        }
                        finally
                        {
                            SessionReady = false;
                            Disconnected?.Invoke();
                            state?.Dispose();
                            state = null;
                            if (stateLoop != null) try { await stateLoop; } catch (RpcException) { } catch (OperationCanceledException) { }
                            control = null;
                        }
                    }
                }
            }
        }

        private void HandleResync(ResyncReason reason)
        {
            switch (reason)
            {
                case ResyncReason.ReplayRangeUnavailable:
                case ResyncReason.PresentationOriginChanged:
                case ResyncReason.SnapshotCatchUpExhausted:
                    ResetSnapshotBootstrap();
                    throw new SnapshotResyncRequiredException();
                case ResyncReason.ProjectionChanged:
                case ResyncReason.PublicationFenceChanged:
                    throw new PresentationDeliveryReloadRequiredException(reason);
                default:
                    throw Failure("realtime resync reason is unsupported");
            }
        }

        private bool TryPrepareSnapshotRetry(RpcException exception)
        {
            if (exception.StatusCode != StatusCode.FailedPrecondition) return false;
            string reason = null;
            int count = 0;
            foreach (Metadata.Entry entry in exception.Trailers)
            {
                if (entry.Key != "unframe-reason") continue;
                count++;
                if (!entry.IsBinary) reason = entry.Value;
            }
            if (count != 1 || reason != "runtime_snapshot_required") return false;
            ResetSnapshotBootstrap();
            return true;
        }

        private void ResetSnapshotBootstrap()
        {
            connectionId = null;
            fence = null;
            hasSnapshot = false;
            replayBootstrap = false;
            replayMarkerPending = false;
            replayReadyCutAvailable = false;
            awaitingKeyframe = true;
            SessionReady = false;
        }

        private static bool VerifyCertificate(string expectedHost, string serverName, ReadOnlySpan<byte> certificateDer, DateTimeOffset now, string fingerprint)
        {
            if (!string.Equals(expectedHost, serverName, StringComparison.OrdinalIgnoreCase)) return false;
            using (var certificate = new X509Certificate2(certificateDer.ToArray()))
            using (var sha = SHA256.Create())
            {
                string actual = "sha256:" + BitConverter.ToString(sha.ComputeHash(certificate.RawData)).Replace("-", "").ToLowerInvariant();
                return string.Equals(actual, fingerprint, StringComparison.Ordinal)
                    && now >= new DateTimeOffset(certificate.NotBefore.ToUniversalTime())
                    && now <= new DateTimeOffset(certificate.NotAfter.ToUniversalTime());
            }
        }

        private StateReady CreateStateReady()
        {
            if (replayReadyCutAvailable)
                return new StateReady { AppliedReliableSequence = replayReadyCut, PresentationOriginVersion = replayOriginVersion };
            if (!store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope cut) || cut.Fence == null)
                throw Failure("realtime snapshot cut is unavailable");
            return new StateReady { AppliedReliableSequence = cut.ReliableSequence, PresentationOriginVersion = cut.Fence.PresentationOriginVersion };
        }

        private void BeginReplayBootstrap()
        {
            if (!store.TryGetLastConnectionSnapshot(out _)) throw Failure("realtime resume requires an accepted snapshot");
            replayBootstrap = true;
            replayMarkerPending = false;
            replayReadyCutAvailable = false;
        }

        private bool TryReceiveReplayBootstrap(ControlServerItem item, out string error)
        {
            error = "realtime replay requires contiguous reliable events before the state nonce";
            if (!replayBootstrap || item == null) return false;
            if (item.ItemCase == ControlServerItem.ItemOneofCase.ProjectionAdvance)
            {
                if (replayMarkerPending || !store.TryReceiveNetworkControl(item, out error)) return false;
                replayMarkerPending = true;
                return true;
            }
            if (item.ItemCase != ControlServerItem.ItemOneofCase.ReliableEvent
                || item.ReliableEvent.Sequence != store.LastReliableSequence + 1
                || !store.TryReceiveNetworkControl(item, out error)) return false;
            replayMarkerPending = false;
            return true;
        }

        private void CompleteReplayBootstrap()
        {
            if (!replayBootstrap || replayMarkerPending) throw Failure("realtime replay bootstrap is missing a visible event after projection advance");
            replayReadyCut = store.LastReliableSequence;
            replayOriginVersion = store.PresentationOrigin?.Version ?? 0;
            replayReadyCutAvailable = true;
            replayBootstrap = false;
        }

        private async Task RunStateAsync(CancellationToken token)
        {
            if (!await state.ResponseStream.MoveNext(token) || state.ResponseStream.Current.ItemCase != StateServerItem.ItemOneofCase.Connected
                || state.ResponseStream.Current.Connected.ConnectionId != connectionId) throw Failure("realtime state connection mismatch");
            if (!store.TryValidateRuntimeOwnership(out string ownershipError)) throw Failure(ownershipError);
            await WriteAsync(new ControlClientItem { StateReady = CreateStateReady() }, token);
            RequireResidency();
            BeginStateStream();
            SessionReady = true;
            while (await state.ResponseStream.MoveNext(token))
            {
                RequireResidency();
                if (!TryReceiveStateFrame(state.ResponseStream.Current, out bool applied, out string error)) throw Failure(error);
                if (applied) RuntimeChanged?.Invoke();
            }
            SessionReady = false;
            throw new RpcException(new Status(StatusCode.Unavailable, "realtime state stream ended"));
        }

        private void BeginStateStream()
        {
            // State sequences and tracking samples belong to the stream, even when Control resumes.
            store.ResetStateStream();
            awaitingKeyframe = true;
        }

        internal bool TryReceiveStateFrame(StateServerItem item, out bool applied, out string error)
        {
            applied = false;
            error = null;
            if (item == null || item.ItemCase != StateServerItem.ItemOneofCase.StateFrame)
            {
                error = "realtime.state.state_frame is required";
                return false;
            }
            ElementStateFrame frame = item.StateFrame;
            if (frame.Fence != null && store.PresentationOrigin != null
                && frame.Fence.PresentationOriginVersion != store.PresentationOrigin.Version)
            {
                awaitingKeyframe = true;
                return true;
            }
            if (frame.BaseReliableSequence != store.LastReliableSequence)
            {
                awaitingKeyframe = true;
                return true;
            }
            if (frame.FrameSequence <= store.LastStateFrameSequence) return true;
            if (awaitingKeyframe && frame.Kind != StateFrameKind.Keyframe
                || frame.Kind == StateFrameKind.Delta && (store.LastStateFrameSequence == 0 || frame.FrameSequence != store.LastStateFrameSequence + 1))
            {
                awaitingKeyframe = true;
                return true;
            }
            if (!store.TryValidateNetworkStateFrame(frame, out error) || !store.TryReceiveState(item, out error)) return false;
            if (frame.Kind == StateFrameKind.Keyframe) awaitingKeyframe = false;
            applied = true;
            return true;
        }

        public Task SendAsync(ControlClientItem command, CancellationToken token)
        {
            RequireResidency();
            if (!SessionReady || command == null || command.ItemCase != ControlClientItem.ItemOneofCase.LogicalInput
                && command.ItemCase != ControlClientItem.ItemOneofCase.SurfaceInteraction && command.ItemCase != ControlClientItem.ItemOneofCase.RuntimeControl)
                throw new InvalidOperationException("Runtime input requires a ready connection and a command payload.");
            return WriteAsync(command, token);
        }

        public Task SendTrackingAsync(TrackingFrame frame, CancellationToken token)
        {
            RequireResidency();
            if (!SessionReady || state == null || store.Delivery.ProjectionProfile.Key.Role != SessionRole.Presenter)
                throw new InvalidOperationException("Tracking requires a ready Presenter State connection.");
            if (frame == null || frame.Samples.Count > 4 || frame.CalculateSize() > 256 * 1024
                || !IsCanonicalTrackingPose(frame.PresentationFromQuestLocal))
                throw new InvalidOperationException("Tracking requires canonical calibration and at most four samples.");
            var targets = new HashSet<TrackedTarget>();
            foreach (TrackedPoseSample sample in frame.Samples)
            {
                if (sample == null || sample.Target < TrackedTarget.Head || sample.Target > TrackedTarget.Body
                    || !targets.Add(sample.Target) || !IsCanonicalTrackingPose(sample.QuestLocalPose))
                    throw new InvalidOperationException("Tracking samples require unique known targets and canonical poses.");
            }
            return WriteTrackingAsync(state, frame.Clone(), token);
        }

        private async Task WriteTrackingAsync(AsyncDuplexStreamingCall<StateClientItem, StateServerItem> expectedState, TrackingFrame frame, CancellationToken token)
        {
            await stateWrites.WaitAsync(token);
            try
            {
                RequireResidency();
                if (!SessionReady || state != expectedState || trackingFrameSequence == ulong.MaxValue)
                    throw new InvalidOperationException("The Tracking State connection is no longer ready.");
                token.ThrowIfCancellationRequested();
                frame.FrameSequence = ++trackingFrameSequence;
                await expectedState.RequestStream.WriteAsync(new StateClientItem { TrackingFrame = frame });
            }
            finally { stateWrites.Release(); }
        }

        private static bool IsCanonicalTrackingPose(Pose pose)
        {
            return pose?.Position != null && PresentationDeliveryCatalog.IsCanonicalFinite(pose.Position.X)
                && PresentationDeliveryCatalog.IsCanonicalFinite(pose.Position.Y)
                && PresentationDeliveryCatalog.IsCanonicalFinite(pose.Position.Z)
                && PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(pose.Rotation);
        }

        private async Task WriteAsync(ControlClientItem item, CancellationToken token)
        {
            await writes.WaitAsync(token);
            try { await control.RequestStream.WriteAsync(item); }
            finally { writes.Release(); }
        }

        private void RequireResidency()
        {
            if (store.Delivery == null || store.Delivery.Residency.Textures == null || !textures.IsReady(store.Delivery.Residency.Textures.Textures))
            {
                SessionReady = false;
                lifetime?.Cancel();
                throw Failure("asset_residency_lost");
            }
        }

        private static RpcException Failure(string message) { return new RpcException(new Status(StatusCode.FailedPrecondition, message)); }

        public void Dispose()
        {
            SessionReady = false;
            lifetime?.Cancel();
            control?.Dispose();
            state?.Dispose();
        }
    }
}

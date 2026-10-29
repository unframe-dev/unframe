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
        private readonly Func<CancellationToken, Task> prepareResources;
        private readonly Func<bool> additionalResidency;
        private readonly PresentationSessionDiagnostics diagnostics;
        private readonly SemaphoreSlim writes = new SemaphoreSlim(1, 1);
        private readonly SemaphoreSlim stateWrites = new SemaphoreSlim(1, 1);
        private readonly object pendingGate = new object();
        private readonly Dictionary<string, TaskCompletionSource<CommandOutcome>> pendingOutcomes = new Dictionary<string, TaskCompletionSource<CommandOutcome>>();
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
        private bool disposed;
        public PresenterInputSynchronizationState InputSynchronization { get; } = new PresenterInputSynchronizationState();
        private ulong inputGeneration;
        private PresenterStepSelectionCatalog pendingSteps;
        private ulong stepsSequence;
        private readonly List<StepSelection> reachedSteps = new List<StepSelection>();
        public IReadOnlyList<StepSelection> ReachedSteps => reachedSteps.ConvertAll(step => step.Clone());
        public bool ControlReady { get; private set; }
        public bool SessionReady { get; private set; }
        public event Action RuntimeChanged;
        public event Action Disconnected;
        public event Action<ResyncReason> SnapshotResynchronizationRequired;

        public PresentationRealtimeConnection(PresentationRuntimeDataStore store, PresentationTextureResidency textures, Func<CancellationToken, Task> prepareResources = null, Func<bool> additionalResidency = null, PresentationSessionDiagnostics diagnostics = null)
        {
            this.store = store ?? throw new ArgumentNullException(nameof(store));
            this.textures = textures ?? throw new ArgumentNullException(nameof(textures));
            this.prepareResources = prepareResources;
            this.additionalResidency = additionalResidency;
            this.diagnostics = diagnostics;
        }

        public async Task RunAsync(Uri endpoint, Func<CancellationToken, Task<string>> bearerProvider, CancellationToken cancellationToken, string certFingerprint = null, Func<YetAnotherHttpHandler> handlerFactory = null)
        {
            if (disposed) throw new ObjectDisposedException(nameof(PresentationRealtimeConnection));
            if (lifetime != null) throw new InvalidOperationException("A connection is already running.");
            if (endpoint == null || endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && endpoint.IsLoopback))
                throw new ArgumentException("A TLS endpoint or local development loopback endpoint is required.", nameof(endpoint));
            if (certFingerprint != null && (certFingerprint.Length != 71 || !certFingerprint.StartsWith("sha256:", StringComparison.Ordinal)
                || !System.Text.RegularExpressions.Regex.IsMatch(certFingerprint.Substring(7), "^[0-9a-f]{64}$") || endpoint.Scheme != "https"))
                throw new ArgumentException("A lowercase SHA-256 TLS certificate fingerprint and HTTPS endpoint are required.", nameof(certFingerprint));
            lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            try
            {
                int snapshotRetries = 0;
                for (int attempt = 0; ; attempt = Math.Min(5, attempt + 1))
                {
                    RequireResidency();
                    diagnostics?.Record(attempt == 0 ? "connection.stage" : "connection.retry", stage: "Connecting", kind: "Realtime");
                    string bearer = await bearerProvider(lifetime.Token);
                    if (string.IsNullOrWhiteSpace(bearer)) throw new InvalidOperationException("A fresh realtime bearer credential is required.");
                    try
                    {
                        await RunConnectionAsync(endpoint, bearer, certFingerprint, lifetime.Token, handlerFactory);
                        throw new RpcException(new Status(StatusCode.Unavailable, "realtime stream ended"));
                    }
                    catch (RpcException exception) when (snapshotRetries < 5 && !lifetime.IsCancellationRequested && TryPrepareSnapshotRetry(exception))
                    {
                        snapshotRetries++;
                        attempt = -1;
                        await Task.Delay(250, lifetime.Token);
                    }
                    catch (RpcException exception) when (!lifetime.IsCancellationRequested
                        && (exception.StatusCode == StatusCode.FailedPrecondition || exception.StatusCode == StatusCode.PermissionDenied || exception.StatusCode == StatusCode.Unauthenticated))
                    {
                        // The Control Plane owns Session termination and assignment changes; a transport status alone cannot identify them.
                        await bearerProvider(lifetime.Token);
                        throw;
                    }
                    catch (RpcException exception) when (PresentationConnectionErrors.CanRetryRealtimeTransport(exception) && !lifetime.IsCancellationRequested)
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(5000, 250 * (1 << attempt))), lifetime.Token);
                    }
                    catch (SnapshotResyncRequiredException) when (snapshotRetries < 5 && !lifetime.IsCancellationRequested)
                    {
                        snapshotRetries++;
                        attempt = -1;
                        await Task.Delay(250, lifetime.Token);
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
                ControlReady = false;
                SessionReady = false;
                diagnostics?.Record("connection.closed", kind: "Realtime");
                Disconnected?.Invoke();
                lifetime.Dispose();
                lifetime = null;
            }
        }

        private async Task RunConnectionAsync(Uri endpoint, string bearer, string certFingerprint, CancellationToken token, Func<YetAnotherHttpHandler> handlerFactory)
        {
            ControlReady = false;
            using (YetAnotherHttpHandler handler = handlerFactory == null ? new YetAnotherHttpHandler { Http2Only = true } : handlerFactory())
            {
                if (certFingerprint != null)
                    handler.OnVerifyServerCertificate = (serverName, certificateDer, now) => VerifyCertificate(endpoint.Host, serverName, certificateDer, now, certFingerprint);
                using (GrpcChannel channel = GrpcChannel.ForAddress(endpoint, new GrpcChannelOptions { HttpHandler = handler, MaxReceiveMessageSize = 1024 * 1024, MaxSendMessageSize = 1024 * 1024 }))
                {
                    RealtimeService.RealtimeServiceClient client = new RealtimeService.RealtimeServiceClient(channel);
                    Metadata headers = new Metadata { { "authorization", "Bearer " + bearer } };
                    using (control = client.ConnectControl(headers, cancellationToken: token))
                    {
                        Task stateLoop = null;
                        try
                        {
                            ControlHandshake handshake = new ControlHandshake { ProtocolVersion = "v3", ProgressionContractVersion = store.Delivery.CapabilityProfile.ContractVersions.Progression };
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
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.ResyncRequired)
                                {
                                    HandleResync(item.ResyncRequired.Reason);
                                    continue;
                                }
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.Connected)
                                {
                                    if (connected || item.Connected.ProtocolVersion != "v3" || item.Connected.ConnectionId.Length == 0
                                        || !store.Delivery.ProjectionInstance.Equals(item.Connected.ProjectionInstance)
                                        || item.Connected.ProgressionContractVersion != handshake.ProgressionContractVersion)
                                        throw Failure("realtime connected projection mismatch");
                                    connected = true;
                                    diagnostics?.Record("connection.stage", stage: "Connected", kind: "Realtime");
                                    connectionId = item.Connected.ConnectionId;
                                    continue;
                                }
                                if (!connected) throw Failure("realtime connected message is required first");
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.PresenterStepSelectionCatalog)
                                {
                                    if (store.Delivery.ProjectionProfile.Key.Role != SessionRole.Presenter) throw Failure("viewer received private Step catalog");
                                    if (item.PresenterStepSelectionCatalog.ReliableSequence < stepsSequence) continue;
                                    pendingSteps = item.PresenterStepSelectionCatalog.Clone();
                                    string prior = null;
                                    foreach (var step in pendingSteps.ReachedSteps)
                                    {
                                        string key = step.GroupId + "\0" + step.StepId;
                                        if (!PresentationDeliveryCatalog.IsId(step.GroupId) || !PresentationDeliveryCatalog.IsId(step.StepId)
                                            || prior != null && StringComparer.Ordinal.Compare(prior, key) >= 0) throw Failure("invalid reached Step catalog");
                                        prior = key;
                                    }
                                    ApplyStepCatalog();
                                    RuntimeChanged?.Invoke();
                                    continue;
                                }
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.PresenterInputSynchronization)
                                {
                                    if (store.Delivery.ProjectionProfile.Key.Role != SessionRole.Presenter) throw Failure("viewer received private input synchronization");
                                    ulong previousRevision = InputSynchronization.Revision;
                                    if (!InputSynchronization.Receive(item.PresenterInputSynchronization)) throw Failure("invalid presenter input synchronization");
                                    if (previousRevision != InputSynchronization.Revision) inputGeneration++;
                                    if (ControlReady && InputSynchronization.Ready && store.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Paused) SessionReady = true;
                                    await AcknowledgeInputSynchronization(token);
                                    RuntimeChanged?.Invoke();
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
                                    StateHandshake stateHandshake = new StateHandshake { ProtocolVersion = "v3", ProgressionContractVersion = handshake.ProgressionContractVersion, ConnectionId = connectionId, StateConnectionNonce = item.StateConnectionNonce.Nonce };
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
                                    WaitForKeyframe();
                                }
                                ulong priorReliableSequence = store.LastReliableSequence;
                                ulong priorOriginVersion = store.PresentationOrigin?.Version ?? 0;
                                if (resuming && !snapshot)
                                {
                                    if (!TryReceiveReplayBootstrap(item, out string replayError)) throw Failure(replayError);
                                }
                                else if (!store.TryReceiveNetworkControl(item, out string error)) throw Failure(error);
                                if (item.ItemCase == ControlServerItem.ItemOneofCase.CommandOutcome)
                                {
                                    diagnostics?.Record("control.outcome", direction: "receive", kind: item.CommandOutcome.ResultCase.ToString(), reliableSequence: store.LastReliableSequence, runtimeTimeMs: store.RuntimeClock?.RuntimeTimeMs, code: item.CommandOutcome.Rejected?.Reason.ToString() ?? item.CommandOutcome.NoOp?.Reason.ToString(), commandId: item.CommandOutcome.ClientEventId);
                                    lock (pendingGate)
                                        if (pendingOutcomes.TryGetValue(item.CommandOutcome.ClientEventId, out var completion)) completion.TrySetResult(item.CommandOutcome.Clone());
                                }
                                if (store.LastReliableSequence != priorReliableSequence || (store.PresentationOrigin?.Version ?? 0) != priorOriginVersion)
                                {
                                    diagnostics?.Record("control.received", direction: "receive", kind: item.ReliableEvent?.PayloadCase.ToString() ?? item.ItemCase.ToString(), reliableSequence: store.LastReliableSequence, runtimeTimeMs: store.RuntimeClock?.RuntimeTimeMs, groupId: store.Progression?.CurrentGroupId, stepId: store.Progression?.CurrentStepId);
                                    ReliableDisplayChanged(item);
                                }
                                if (fence != null && store.PresentationOrigin != null)
                                    fence.PresentationOriginVersion = store.PresentationOrigin.Version;
                                ApplyStepCatalog();
                                RuntimeChanged?.Invoke();
                                await AcknowledgeInputSynchronization(token);
                                if (stateLoop != null && stateLoop.IsCompleted) await stateLoop;
                            }
                        }
                        finally
                        {
                            ControlReady = false;
                            SessionReady = false;
                            InputSynchronization.Disconnect();
                            lock (pendingGate)
                                foreach (var completion in pendingOutcomes.Values)
                                    completion.TrySetException(new RpcException(new Status(StatusCode.Unavailable, "command outcome connection closed")));
                            pendingSteps = null; reachedSteps.Clear(); stepsSequence = 0;
                            inputGeneration++;
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

        private void ApplyStepCatalog()
        {
            if (!hasSnapshot || pendingSteps == null || pendingSteps.ReliableSequence > store.LastReliableSequence) return;
            stepsSequence = pendingSteps.ReliableSequence;
            reachedSteps.Clear();
            foreach (var step in pendingSteps.ReachedSteps) reachedSteps.Add(step.Clone());
            pendingSteps = null;
        }

        public void DiscardPendingInputs() { inputGeneration++; InputSynchronization.Suspend(); }

        private async Task AcknowledgeInputSynchronization(CancellationToken token)
        {
            if (!hasSnapshot) return;
            InputSynchronizationAck ack = InputSynchronization.TryCreateAck(store.LastReliableSequence);
            if (ack != null) await WriteAsync(new ControlClientItem { InputSynchronizationAck = ack }, token);
        }

        private void HandleResync(ResyncReason reason)
        {
            switch (reason)
            {
                case ResyncReason.ReplayRangeUnavailable:
                case ResyncReason.PresentationOriginChanged:
                case ResyncReason.SnapshotCatchUpExhausted:
                    ResetSnapshotBootstrap();
                    SnapshotResynchronizationRequired?.Invoke(reason);
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
            ControlReady = false;
            connectionId = null;
            fence = null;
            hasSnapshot = false;
            replayBootstrap = false;
            replayMarkerPending = false;
            replayReadyCutAvailable = false;
            WaitForKeyframe();
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
            ControlReady = false;
            WaitForKeyframe();
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
            var expectedControl = control;
            var expectedState = state;
            try
            {
                if (!await expectedState.ResponseStream.MoveNext(token) || expectedState.ResponseStream.Current.ItemCase != StateServerItem.ItemOneofCase.Connected
                    || expectedState.ResponseStream.Current.Connected.ConnectionId != connectionId) throw Failure("realtime state connection mismatch");
                if (!store.TryValidateRuntimeOwnership(out string ownershipError)) throw Failure(ownershipError);
                if (prepareResources != null) await prepareResources(token);
                await WriteAsync(new ControlClientItem { StateReady = CreateStateReady() }, token);
                token.ThrowIfCancellationRequested();
                if (disposed || control != expectedControl || state != expectedState)
                    throw new InvalidOperationException("The Control connection changed before State readiness.");
                RequireResidency();
                BeginStateStream();
                // Paused Snapshots are complete display cuts; input synchronization gates Presenter commands separately.
                ControlReady = true;
                SessionReady = store.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Paused;
                RuntimeChanged?.Invoke();
                while (await expectedState.ResponseStream.MoveNext(token))
                {
                    RequireResidency();
                    if (!TryReceiveStateFrame(expectedState.ResponseStream.Current, out bool applied, out string error)) throw Failure(error);
                    if (applied) RuntimeChanged?.Invoke();
                }
                throw new RpcException(new Status(StatusCode.Unavailable, "realtime state stream ended"));
            }
            finally { ControlReady = false; WaitForKeyframe(); }
        }

        private void BeginStateStream()
        {
            // State sequences and tracking samples belong to the stream, even when Control resumes.
            store.ResetStateStream();
            WaitForKeyframe();
        }

        private void ReliableDisplayChanged(ControlServerItem item)
        {
            SetWaitForKeyframe(true);
            if (ControlReady && item.ReliableEvent?.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.RuntimeViewReplaced
                && store.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Paused)
                SessionReady = true;
        }

        private void WaitForKeyframe() => SetWaitForKeyframe(false);

        private void SetWaitForKeyframe(bool keepDisplay)
        {
            awaitingKeyframe = true;
            if (!keepDisplay) SessionReady = false;
        }

        internal bool TryReceiveStateFrame(StateServerItem item, out bool applied, out string error)
        {
            applied = false;
            error = null;
            if (item == null || item.ItemCase != StateServerItem.ItemOneofCase.StateFrame)
            {
                error = "realtime.state.state_frame is required";
                WaitForKeyframe();
                return false;
            }
            ElementStateFrame frame = item.StateFrame;
            if (frame.Fence != null && store.PresentationOrigin != null
                && frame.Fence.PresentationOriginVersion != store.PresentationOrigin.Version)
            {
                SetWaitForKeyframe(true);
                return true;
            }
            if (frame.BaseReliableSequence != store.LastReliableSequence)
            {
                SetWaitForKeyframe(true);
                return true;
            }
            if (frame.FrameSequence <= store.LastStateFrameSequence) return true;
            if (awaitingKeyframe && frame.Kind != StateFrameKind.Keyframe
                || frame.Kind == StateFrameKind.Delta && (store.LastStateFrameSequence == 0 || frame.FrameSequence != store.LastStateFrameSequence + 1))
            {
                SetWaitForKeyframe(true);
                return true;
            }
            if (!store.TryValidateNetworkStateFrame(frame, out error) || !store.TryReceiveState(item, out error))
            {
                WaitForKeyframe();
                return false;
            }
            if (frame.Kind == StateFrameKind.Keyframe)
            {
                awaitingKeyframe = false;
                SessionReady = true;
            }
            diagnostics?.SampleState(store.LastReliableSequence, frame.FrameSequence, frame.ProducedAtRuntimeTimeMs, store.Progression?.CurrentGroupId, store.Progression?.CurrentStepId);
            applied = true;
            return true;
        }

        public Task SendAsync(ControlClientItem command, CancellationToken token)
        {
            RequireResidency();
            if (!IsCommandReady(command))
                throw new InvalidOperationException("Runtime input requires a ready connection and a command payload.");
            return WriteInputAsync(control, command.Clone(), inputGeneration, token);
        }

        public async Task<CommandOutcome> SendConfirmedAsync(ControlClientItem command, TimeSpan timeout, CancellationToken token)
        {
            if (timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));
            string id = command?.RuntimeControl?.ClientEventId ?? command?.LogicalInput?.ClientEventId
                ?? command?.SurfaceInteraction?.ClientEventId ?? command?.GestureInput?.ClientEventId ?? command?.ZoneInput?.ClientEventId;
            if (String.IsNullOrWhiteSpace(id)) throw new ArgumentException("A command event identifier is required.", nameof(command));
            var completion = new TaskCompletionSource<CommandOutcome>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (pendingGate)
            {
                if (pendingOutcomes.ContainsKey(id)) throw new InvalidOperationException("This command is already awaiting its outcome.");
                pendingOutcomes.Add(id, completion);
            }
            try
            {
                await SendAsync(command, token);
                using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(token))
                {
                    deadline.CancelAfter(timeout);
                    using (deadline.Token.Register(() => completion.TrySetCanceled()))
                    {
                        try { return await completion.Task; }
                        catch (OperationCanceledException) when (!token.IsCancellationRequested)
                        { throw new TimeoutException("The Runtime did not confirm the command outcome."); }
                    }
                }
            }
            finally { lock (pendingGate) pendingOutcomes.Remove(id); }
        }

        private bool IsCommandReady(ControlClientItem command)
        {
            if (disposed || command == null) return false;
            if (command.ItemCase == ControlClientItem.ItemOneofCase.RuntimeControl)
                return ControlReady && store.Delivery.ProjectionProfile.Key.Role == SessionRole.Presenter;
            return SessionReady && InputSynchronization.Ready && store.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running
                && store.Delivery.ProjectionProfile.Key.Role == SessionRole.Presenter
                && store.Progression?.PhaseCase == ProgressionRuntimeState.PhaseOneofCase.Stable
                && (command.ItemCase == ControlClientItem.ItemOneofCase.LogicalInput
                || command.ItemCase == ControlClientItem.ItemOneofCase.SurfaceInteraction
                || command.ItemCase == ControlClientItem.ItemOneofCase.GestureInput
                || command.ItemCase == ControlClientItem.ItemOneofCase.ZoneInput);
        }

        private async Task WriteInputAsync(AsyncDuplexStreamingCall<ControlClientItem, ControlServerItem> expectedControl, ControlClientItem command, ulong generation, CancellationToken token)
        {
            await writes.WaitAsync(token);
            try
            {
                RequireResidency();
                if (generation != inputGeneration || !IsCommandReady(command) || control != expectedControl || expectedControl == null)
                    throw new InvalidOperationException("The runtime input connection is no longer ready.");
                token.ThrowIfCancellationRequested();
                await expectedControl.RequestStream.WriteAsync(command);
                diagnostics?.Record("control.sent", direction: "send", kind: command.RuntimeControl != null ? command.RuntimeControl.Kind.ToString() : command.ItemCase.ToString(), reliableSequence: store.LastReliableSequence, runtimeTimeMs: store.RuntimeClock?.RuntimeTimeMs, groupId: store.Progression?.CurrentGroupId, stepId: store.Progression?.CurrentStepId, commandId: command.RuntimeControl?.ClientEventId ?? command.LogicalInput?.ClientEventId ?? command.SurfaceInteraction?.ClientEventId ?? command.GestureInput?.ClientEventId ?? command.ZoneInput?.ClientEventId);
            }
            finally { writes.Release(); }
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
                diagnostics?.SampleTracking(frame.FrameSequence);
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
            if (store.Delivery == null || store.Delivery.Residency.Textures == null || !textures.IsReady(store.Delivery.Residency.Textures.Textures)
                || additionalResidency != null && !additionalResidency())
            {
                ControlReady = false;
                SessionReady = false;
                lifetime?.Cancel();
                throw Failure("asset_residency_lost");
            }
        }

        private static RpcException Failure(string message) { return new RpcException(new Status(StatusCode.FailedPrecondition, message)); }

        public void Dispose()
        {
            disposed = true;
            ControlReady = false;
            SessionReady = false;
            lifetime?.Cancel();
            control?.Dispose();
            state?.Dispose();
        }
    }
}

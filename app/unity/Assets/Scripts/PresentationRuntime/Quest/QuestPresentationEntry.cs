using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.XR;
using Vector3 = UnityEngine.Vector3;
using Quaternion = UnityEngine.Quaternion;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    [RequireComponent(typeof(PresentationBakedRuntime))]
    public sealed class QuestPresentationEntry : MonoBehaviour
    {
        [SerializeField] private PresentationBakedRuntime runtime;
        [SerializeField] private Transform questTrackingOrigin;
        public Transform QuestTrackingOrigin => questTrackingOrigin;
        private IQuestBodyPoseSource bodySource;
        private PresentationControlPlaneConnection connection;
        private CancellationTokenSource lifetime;
        private CancellationTokenSource interactionLifetime;
        private Task run;
        private Task input;
        private Task tracking;
        private Task controlCommand;
        private PresentationCalibrationState calibration;
        private readonly List<XRInputSubsystem> xrSubsystems = new List<XRInputSubsystem>();
        private readonly HashSet<XRInputSubsystem> subscribedSubsystems = new HashSet<XRInputSubsystem>();
        public PresentationCalibrationState Calibration => calibration;
        private PresentationConnectionStage connectionStage;
        private bool commandPending;
        public Func<Ray, bool> UiRayHandler { get; set; }
        public bool PresentationInputEnabled { get; set; } = true;
        private bool presentationDisplayEnabled = true;
        public bool PresentationDisplayEnabled
        {
            get => presentationDisplayEnabled;
            set
            {
                presentationDisplayEnabled = value;
                if (runtime == null) runtime = GetComponent<PresentationBakedRuntime>();
                if (runtime != null) runtime.DisplayEnabled = value;
            }
        }
        public bool IsRunning => lifetime != null && !lifetime.IsCancellationRequested;
        public bool AssetsReady => IsRunning && runtime != null && runtime.DownloadReady && runtime.ResidentReady;
        public bool ControlReady => IsRunning && runtime != null && runtime.ControlReady;
        public bool SessionReady => IsRunning && runtime != null && runtime.SessionReady;
        public bool CalibrationReady => runtime != null && runtime.CalibrationReady;
        public bool IsPresenter => IsRunning && runtime != null && runtime.IsPresenter;
        public bool CanControlPresentation => IsRunning && !commandPending && runtime != null && CanControl;
        public bool HasLogicalAdvance => !String.IsNullOrWhiteSpace(logicalEventName);
        public bool CanAdvance => IsRunning && !commandPending && runtime != null && runtime.CanSendInput
            && HasLogicalAdvance && (input == null || input.IsCompleted);
        public string LastErrorCode { get; private set; }
        public string LastCommandOutcomeCode => ControlReady ? runtime.LastCommandOutcomeCode : null;
        public string PlaybackStatus => ControlReady ? runtime.PlaybackStatus : "Unknown";
        public PresentationConnectionStage ConnectionStage
        {
            get
            {
                if (!IsRunning) return connectionStage;
                if (connectionStage == PresentationConnectionStage.Connecting) return connectionStage;
                if (!AssetsReady) return PresentationConnectionStage.LoadingAssets;
                return SessionReady ? PresentationConnectionStage.Ready : PresentationConnectionStage.Synchronizing;
            }
        }
        public string Summary => ConnectionStage == PresentationConnectionStage.Failed ? "Session failed: " + LastErrorCode
            : calibration == null ? "Session not configured"
            : !runtime.CalibrationReady ? "Calibration required: " + (runtime.CalibrationError ?? calibration.Reason)
            : !IsRunning ? "Session stopped"
            : ConnectionStage == PresentationConnectionStage.Connecting ? "Connecting to session"
            : !AssetsReady ? "Loading presentation assets"
            : !SessionReady ? "Synchronizing session"
            : IsPresenter ? "Ready: Presenter" : "Ready: Viewer";
        private string logicalEventName;
        private PresentationSessionDiagnostics diagnostics;
        private PresentationConnectionStage? diagnosticStage;
        private readonly QuestPresentationButtonEdges buttons = new QuestPresentationButtonEdges();
        private readonly QuestPresentationButtonEdges uiButtons = new QuestPresentationButtonEdges();
        private double lastTrackingAt;

        private readonly PresenterRecognition recognition = new PresenterRecognition();
        private ulong recognitionRevision;
        private bool recalibrationPending;
        private ulong calibrationRevision;
        private Task recalibration;
        public Func<Ray, bool> ControlRayHandler { get; set; }
        public IReadOnlyList<StepSelection> ReachedSteps => runtime != null ? runtime.ReachedSteps : Array.Empty<StepSelection>();
        public bool CanControl => runtime != null && runtime.CanSendRuntimeControl && runtime.InputSynchronization?.CommandEpoch > 0;

        public Task ControlAsync(RuntimeControlKind kind, string groupId = null, string stepId = null)
        {
            if (!CanControl || lifetime == null) throw new InvalidOperationException("Presenter control is unavailable.");
            return runtime.SendAsync(QuestPresentationInput.CreateControl(kind, runtime.PresentationOriginVersion,
                runtime.InputSynchronization.CommandEpoch, groupId, stepId), lifetime.Token);
        }

        public async Task ControlConfirmedAsync(RuntimeControlKind kind, CancellationToken token)
        {
            if (!CanControl || lifetime == null) throw new InvalidOperationException("Presenter control is unavailable.");
            using (var linked = CancellationTokenSource.CreateLinkedTokenSource(token, lifetime.Token))
            {
                CommandOutcome outcome = await runtime.SendConfirmedAsync(QuestPresentationInput.CreateControl(kind,
                    runtime.PresentationOriginVersion, runtime.InputSynchronization.CommandEpoch), linked.Token);
                if (outcome.ResultCase != CommandOutcome.ResultOneofCase.Accepted)
                    throw new InvalidOperationException("Presenter control was not accepted: " + outcome.ResultCase);
            }
        }


        private void Awake()
        {
            if (runtime == null) runtime = GetComponent<PresentationBakedRuntime>();
            foreach (MonoBehaviour component in GetComponents<MonoBehaviour>())
                if (component is IQuestBodyPoseSource source) { bodySource = source; break; }
        }

        public async Task StopAsync()
        {
            CancellationTokenSource active = lifetime;
            if (active == null) return;
            try { active.Cancel(); }
            catch (ObjectDisposedException) { }
            Task completion = run;
            if (completion != null) await completion;
        }

        public void Configure(Uri controlPlaneOrigin, string sessionId, Func<CancellationToken, Task<string>> credentialProvider,
            PresentationCalibrationState calibrationState, string advanceLogicalEventName, PresentationSessionDiagnostics diagnosticLog = null,
            Func<CancellationToken, Task<PresentationCredentialLease>> credentialLeaseProvider = null)
        {
            if (!isActiveAndEnabled) throw new InvalidOperationException("The Quest presentation entry must be active.");
            if (lifetime != null) throw new InvalidOperationException("A Quest presentation is already configured.");
            if (runtime == null) runtime = GetComponent<PresentationBakedRuntime>();
            if (calibrationState == null || questTrackingOrigin == null)
                throw new ArgumentException("Calibration state and XR tracking origin are required.");
            diagnostics = diagnosticLog?.ForSession(sessionId);
            diagnosticStage = null;
            connection = new PresentationControlPlaneConnection(controlPlaneOrigin, sessionId, credentialProvider,
                reportStage: stage => { connectionStage = stage; diagnostics?.Record("connection.stage", stage: stage.ToString()); }, diagnostics: diagnostics, credentialLeaseProvider: credentialLeaseProvider);
            LastErrorCode = null;
            commandPending = false;
            connectionStage = PresentationConnectionStage.Connecting;
            calibration = calibrationState;
            runtime.DisplayEnabled = presentationDisplayEnabled;
            runtime.ConfigureCalibration(calibration, questTrackingOrigin);
            logicalEventName = advanceLogicalEventName;
            CancellationTokenSource runLifetime = new CancellationTokenSource();
            lifetime = runLifetime;
            calibrationRevision = 0;
            recalibrationPending = false;
            recalibration = null;
            runtime.InputInvalidated += ResetRecognition;
            calibration.Changed += OnCalibrationChanged;
            OnCalibrationChanged();
            run = RunAsync(connection, runLifetime);
        }

        private async Task RunAsync(PresentationControlPlaneConnection activeConnection, CancellationTokenSource runLifetime)
        {
            try { await activeConnection.RunAsync(runtime, runLifetime.Token); }
            catch (OperationCanceledException) when (runLifetime.IsCancellationRequested) { }
            catch (Exception exception)
            {
                LastErrorCode = PresentationConnectionErrors.FromException(exception);
                connectionStage = PresentationConnectionStage.Failed;
                diagnostics?.Record("connection.closed", code: LastErrorCode);
            }
            finally
            {
                runLifetime.Cancel();
                interactionLifetime?.Cancel();
                await ObserveInteractionAsync(input);
                await ObserveInteractionAsync(tracking);
                await ObserveInteractionAsync(controlCommand);
                await ObserveInteractionAsync(recalibration);
                if (ReferenceEquals(lifetime, runLifetime))
                {
                    calibration.Changed -= OnCalibrationChanged;
                    runtime.InputInvalidated -= ResetRecognition;
                    interactionLifetime?.Dispose();
                    interactionLifetime = null;
                    lifetime = null;
                    connection = null;
                    logicalEventName = null;
                    commandPending = false;
                    if (connectionStage != PresentationConnectionStage.Failed) connectionStage = PresentationConnectionStage.Stopped;
                }
                runLifetime.Dispose();
            }
        }

        private static async Task ObserveInteractionAsync(Task task)
        {
            if (task == null) return;
            try { await task; }
            catch (Exception) { }
        }

        public Task ResumeAsync() => QueueRuntimeControl(RuntimeControlKind.Resume);
        public Task PauseAsync() => QueueRuntimeControl(RuntimeControlKind.Pause);
        public Task EndAsync() => QueueRuntimeControl(RuntimeControlKind.End);

        private Task QueueRuntimeControl(RuntimeControlKind kind)
        {
            if (commandPending) return Task.CompletedTask;
            controlCommand = SendRuntimeControlAsync(kind);
            return controlCommand;
        }

        private async Task SendRuntimeControlAsync(RuntimeControlKind kind)
        {
            if (!CanControlPresentation)
            {
                LastErrorCode = "command-unavailable";
                return;
            }
            commandPending = true;
            try
            {
                await runtime.SendAsync(QuestPresentationInput.CreateControl(kind, runtime.PresentationOriginVersion, runtime.InputSynchronization.CommandEpoch), lifetime.Token);
                LastErrorCode = null;
            }
            catch (OperationCanceledException) when (!IsRunning) { }
            catch (Exception exception) { LastErrorCode = PresentationConnectionErrors.FromException(exception); }
            finally { commandPending = false; }
        }

        public async Task AdvanceAsync()
        {
            if (!CanAdvance || interactionLifetime == null)
            {
                LastErrorCode = "command-unavailable";
                return;
            }
            commandPending = true;
            try
            {
                input = SendInputAsync(QuestPresentationInput.CreateLogical(logicalEventName, runtime.PresentationOriginVersion, runtime.InputSynchronization.Context, runtime.InputSynchronization.CommandEpoch), interactionLifetime.Token);
                await input;
            }
            finally { commandPending = false; }
        }

        private void Update()
        {
            SubscribeTrackingOrigins();
            var currentStage = ConnectionStage;
            if (diagnosticStage != currentStage)
            {
                diagnosticStage = currentStage;
                diagnostics?.Record("connection.stage", stage: currentStage.ToString());
            }
            bool nextLeft = IsPressed(XRNode.LeftHand, CommonUsages.triggerButton);
            bool nextRight = IsPressed(XRNode.RightHand, CommonUsages.triggerButton);
            bool nextPrimary = IsPressed(XRNode.RightHand, CommonUsages.primaryButton);
            buttons.Sample(nextLeft, nextRight, nextPrimary, runtime.CanSendInput && PresentationInputEnabled,
                out bool leftRayPressed, out bool rightRayPressed, out bool logicalPressed);
            uiButtons.Sample(nextLeft, nextRight, false, true, out bool uiLeft, out bool uiRight, out _);
            if (uiLeft && TryControllerRay(XRNode.LeftHand, out Ray leftUiRay) && TryUseUiRay(leftUiRay)) leftRayPressed = false;
            if (uiRight && TryControllerRay(XRNode.RightHand, out Ray rightUiRay) && TryUseUiRay(rightUiRay)) rightRayPressed = false;
            if (lifetime == null || lifetime.IsCancellationRequested) return;
            TrySendRecalibration();
            if (!runtime.SessionReady || !runtime.CalibrationReady || interactionLifetime == null || interactionLifetime.IsCancellationRequested) return;

            if (!commandPending && logicalPressed && !String.IsNullOrWhiteSpace(logicalEventName)
                && (input == null || input.IsCompleted))
                input = SendInputAsync(QuestPresentationInput.CreateLogical(logicalEventName, runtime.PresentationOriginVersion, runtime.InputSynchronization.Context, runtime.InputSynchronization.CommandEpoch), interactionLifetime.Token);
            else if (!commandPending && (leftRayPressed || rightRayPressed) && (input == null || input.IsCompleted))
            {
                XRNode hand = rightRayPressed ? XRNode.RightHand : XRNode.LeftHand;
                if (TryControllerRay(hand, out Ray ray) && runtime.TryPickInteraction(ray, out string surfaceId, out string interactionId))
                    input = SendInputAsync(QuestPresentationInput.CreateSurfaceInteraction(surfaceId, interactionId, runtime.PresentationOriginVersion, runtime.InputSynchronization.Context, runtime.InputSynchronization.CommandEpoch), interactionLifetime.Token);
            }

            if (PresentationInputEnabled) SampleRecognition();
            else ResetRecognition();

            if (runtime.CanSendTracking && Time.realtimeSinceStartupAsDouble - lastTrackingAt >= 0.1
                && (tracking == null || tracking.IsCompleted))
            {
                lastTrackingAt = Time.realtimeSinceStartupAsDouble;
                var samples = new List<QuestPoseSample>(4);
                QuestPresentationTracking.TrySample(XRNode.Head, TrackedTarget.Head, out QuestPoseSample head);
                QuestPresentationTracking.TrySample(XRNode.LeftHand, TrackedTarget.LeftHand, out QuestPoseSample left);
                QuestPresentationTracking.TrySample(XRNode.RightHand, TrackedTarget.RightHand, out QuestPoseSample right);
                samples.Add(head);
                samples.Add(left);
                samples.Add(right);
                if (bodySource != null && bodySource.TryGetQuestLocalPose(out Vector3 bodyPosition, out Quaternion bodyRotation))
                    samples.Add(new QuestPoseSample(TrackedTarget.Body, bodyPosition, bodyRotation));
                else samples.Add(QuestPoseSample.Unavailable(TrackedTarget.Body));
                tracking = SendTrackingAsync(QuestPresentationTracking.CreateFrame(calibration.PresentationFromQuestLocal, samples.ToArray()), interactionLifetime.Token);
            }
        }

        private void ResetRecognition() { recognition.Reset(null, null); recognitionRevision = 0; }

        private void SampleRecognition()
        {
            var synchronization = runtime.InputSynchronization;
            if (!runtime.CanSendInput)
            {
                recognition.Reset(null, null); recognitionRevision = 0; return;
            }
            if (recognitionRevision != synchronization.Revision)
            {
                recognition.Reset(synchronization.Context, synchronization.Catalog);
                recognitionRevision = synchronization.Revision;
            }
            if (!PresentationCoordinateAdapter.TryToUnityPose(calibration.PresentationFromQuestLocal, out UnityEngine.Pose fromLocal)) return;
            QuestPresentationTracking.TrySample(XRNode.Head, TrackedTarget.Head, out QuestPoseSample head);
            QuestPresentationTracking.TrySample(XRNode.LeftHand, TrackedTarget.LeftHand, out QuestPoseSample left);
            QuestPresentationTracking.TrySample(XRNode.RightHand, TrackedTarget.RightHand, out QuestPoseSample right);
            Unframe.Presentation.Vector3 position(QuestPoseSample sample) => sample.Available
                ? QuestPresentationTracking.ToCanonicalPose(fromLocal.position + fromLocal.rotation * sample.Position, Quaternion.identity).Position : null;
            Vector3 direction = fromLocal.rotation * head.Rotation * Vector3.forward;
            var result = recognition.SampleHands(Time.realtimeSinceStartupAsDouble, position(left), position(right), head.Available
                ? new Unframe.Presentation.Vector3 { X = direction.x, Y = direction.y, Z = -direction.z } : null);
            if (result != null) _ = SendInputAsync(QuestPresentationInput.CreateRecognition(result, runtime.PresentationOriginVersion, synchronization.CommandEpoch), interactionLifetime.Token);
            Unframe.Presentation.Vector3 waist = null;
            if (bodySource != null && bodySource.TryGetQuestLocalPose(out Vector3 bodyPosition, out Quaternion _))
                waist = QuestPresentationTracking.ToCanonicalPose(fromLocal.position + fromLocal.rotation * bodyPosition, Quaternion.identity).Position;
            foreach (var edge in recognition.SampleWaist(waist))
                _ = SendInputAsync(QuestPresentationInput.CreateRecognition(edge, runtime.PresentationOriginVersion, synchronization.CommandEpoch), interactionLifetime.Token);
        }

        private async Task SendInputAsync(ControlClientItem item, CancellationToken token)
        {
            try { await runtime.SendAsync(item, token); LastErrorCode = null; }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { }
            catch (InvalidOperationException) when (!runtime.CanSendInput) { }
            catch (Exception exception) { LastErrorCode = PresentationConnectionErrors.FromException(exception); }
        }

        private async Task SendTrackingAsync(TrackingFrame frame, CancellationToken token)
        {
            try { await runtime.SendTrackingAsync(frame, token); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { }
            catch (InvalidOperationException) when (!runtime.CanSendTracking) { }
            catch (Exception exception) { LastErrorCode = PresentationConnectionErrors.FromException(exception); }
        }

        private bool TryUseUiRay(Ray ray)
        {
            if (UiRayHandler == null && ControlRayHandler == null) return false;
            try { return (UiRayHandler?.Invoke(ray) ?? false) || (ControlRayHandler?.Invoke(ray) ?? false); }
            catch (Exception) { LastErrorCode = "ui-operation-failed"; return true; }
        }

        private static bool IsPressed(XRNode node, InputFeatureUsage<bool> feature)
        {
            InputDevice device = InputDevices.GetDeviceAtXRNode(node);
            return device.isValid && device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked) && tracked
                && device.TryGetFeatureValue(feature, out bool pressed) && pressed;
        }

        private bool TryControllerRay(XRNode node, out Ray ray)
        {
            ray = default;
            TrackedTarget target = node == XRNode.LeftHand ? TrackedTarget.LeftHand : TrackedTarget.RightHand;
            if (questTrackingOrigin == null
                || !QuestPresentationTracking.TrySample(node, target, out QuestPoseSample pose)) return false;
            Transform trackingOrigin = questTrackingOrigin;
            ray = new Ray(trackingOrigin.TransformPoint(pose.Position), trackingOrigin.TransformDirection(pose.Rotation * Vector3.forward));
            return true;
        }

        private void OnCalibrationChanged()
        {
            interactionLifetime?.Cancel();
            interactionLifetime?.Dispose();
            interactionLifetime = null;
            recognition.Reset(null, null); recognitionRevision = 0;
            runtime.DiscardPendingInputs();
            if (!calibration.IsValid || calibrationRevision != 0) recalibrationPending = true;
            calibrationRevision = calibration.Revision;
            TrySendRecalibration();
            if (lifetime != null && !lifetime.IsCancellationRequested && calibration.IsValid)
                interactionLifetime = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        }

        private void TrySendRecalibration()
        {
            if (recalibrationPending && calibration?.IsValid == true && CanControl
                && lifetime != null && !lifetime.IsCancellationRequested && (recalibration == null || recalibration.IsCompleted))
                recalibration = SendRecalibrationAsync();
        }

        private async Task SendRecalibrationAsync()
        {
            recalibrationPending = false;
            try { await ControlAsync(RuntimeControlKind.Recalibrate); }
            catch (OperationCanceledException) when (lifetime == null || lifetime.IsCancellationRequested) { }
            catch (Exception exception)
            {
                recalibrationPending = true;
                Debug.LogWarning("[Presentation] Recalibration rejected: " + exception.GetType().Name, this);
            }
        }

        public void InvalidateCalibration(string reason) => calibration?.Invalidate(reason);

        private void OnEnable()
        {
            InputTracking.trackingLost += OnTrackingLost;
            SubscribeTrackingOrigins();
        }

        private void SubscribeTrackingOrigins()
        {
            SubsystemManager.GetSubsystems(xrSubsystems);
            foreach (XRInputSubsystem subsystem in xrSubsystems)
                if (subscribedSubsystems.Add(subsystem)) subsystem.trackingOriginUpdated += OnTrackingOriginUpdated;
        }

        private void OnTrackingLost(XRNodeState state)
        {
            if (state.nodeType == XRNode.Head) InvalidateCalibration("head-tracking-lost");
        }

        private void OnTrackingOriginUpdated(XRInputSubsystem _) => InvalidateCalibration("tracking-origin-changed");

        private void OnApplicationPause(bool paused)
        {
            if (paused) InvalidateCalibration("application-paused");
        }

        private void OnDisable()
        {
            InputTracking.trackingLost -= OnTrackingLost;
            foreach (XRInputSubsystem subsystem in subscribedSubsystems) subsystem.trackingOriginUpdated -= OnTrackingOriginUpdated;
            subscribedSubsystems.Clear();
            InvalidateCalibration("entry-disabled");
            try { lifetime?.Cancel(); }
            catch (ObjectDisposedException) { }
        }

    }
}

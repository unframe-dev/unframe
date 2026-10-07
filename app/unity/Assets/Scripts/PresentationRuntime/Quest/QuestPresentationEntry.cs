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
        private PresentationCalibrationState calibration;
        private readonly List<XRInputSubsystem> xrSubsystems = new List<XRInputSubsystem>();
        private readonly HashSet<XRInputSubsystem> subscribedSubsystems = new HashSet<XRInputSubsystem>();
        public PresentationCalibrationState Calibration => calibration;
        public string Summary => calibration == null ? "Session not configured"
            : !runtime.CalibrationReady ? "Calibration required: " + (runtime.CalibrationError ?? calibration.Reason)
            : lifetime == null ? "Session stopped"
            : !runtime.DownloadReady ? "Loading presentation assets"
            : !runtime.SessionReady ? "Synchronizing session"
            : runtime.CanSendInput ? "Ready: Presenter" : "Ready: Viewer";
        private string logicalEventName;
        private readonly QuestPresentationButtonEdges buttons = new QuestPresentationButtonEdges();
        private double lastTrackingAt;

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
            PresentationCalibrationState calibrationState, string advanceLogicalEventName)
        {
            if (!isActiveAndEnabled) throw new InvalidOperationException("The Quest presentation entry must be active.");
            if (lifetime != null) throw new InvalidOperationException("A Quest presentation is already configured.");
            if (runtime == null) runtime = GetComponent<PresentationBakedRuntime>();
            if (calibrationState == null || questTrackingOrigin == null)
                throw new ArgumentException("Calibration state and XR tracking origin are required.");
            connection = new PresentationControlPlaneConnection(controlPlaneOrigin, sessionId, credentialProvider);
            calibration = calibrationState;
            runtime.ConfigureCalibration(calibration, questTrackingOrigin);
            logicalEventName = advanceLogicalEventName;
            CancellationTokenSource runLifetime = new CancellationTokenSource();
            lifetime = runLifetime;
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
                Debug.LogError("[Presentation] Quest session stopped: " + exception.GetType().Name, this);
            }
            finally
            {
                runLifetime.Cancel();
                interactionLifetime?.Cancel();
                if (input != null) await input;
                if (tracking != null) await tracking;
                if (ReferenceEquals(lifetime, runLifetime))
                {
                    calibration.Changed -= OnCalibrationChanged;
                    interactionLifetime?.Dispose();
                    interactionLifetime = null;
                    lifetime = null;
                    connection = null;
                    logicalEventName = null;
                }
                runLifetime.Dispose();
            }
        }

        private void Update()
        {
            SubscribeTrackingOrigins();
            bool nextLeft = IsPressed(XRNode.LeftHand, CommonUsages.triggerButton);
            bool nextRight = IsPressed(XRNode.RightHand, CommonUsages.triggerButton);
            bool nextPrimary = IsPressed(XRNode.RightHand, CommonUsages.primaryButton);
            buttons.Sample(nextLeft, nextRight, nextPrimary, runtime.CanSendInput,
                out bool leftRayPressed, out bool rightRayPressed, out bool logicalPressed);
            if (lifetime == null || lifetime.IsCancellationRequested || !runtime.SessionReady || !runtime.CalibrationReady || interactionLifetime == null || interactionLifetime.IsCancellationRequested) return;

            if (logicalPressed && !String.IsNullOrWhiteSpace(logicalEventName)
                && (input == null || input.IsCompleted) && runtime.PresentationOriginVersion != 0)
                input = SendInputAsync(QuestPresentationInput.CreateLogical(logicalEventName, runtime.PresentationOriginVersion), interactionLifetime.Token);
            else if ((leftRayPressed || rightRayPressed) && (input == null || input.IsCompleted) && runtime.PresentationOriginVersion != 0)
            {
                XRNode hand = rightRayPressed ? XRNode.RightHand : XRNode.LeftHand;
                if (TryControllerRay(hand, out Ray ray) && runtime.TryPickInteraction(ray, out string surfaceId, out string interactionId))
                    input = SendInputAsync(QuestPresentationInput.CreateSurfaceInteraction(surfaceId, interactionId, runtime.PresentationOriginVersion), interactionLifetime.Token);
            }

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

        private async Task SendInputAsync(ControlClientItem item, CancellationToken token)
        {
            try { await runtime.SendAsync(item, token); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { }
            catch (InvalidOperationException) when (!runtime.CanSendInput) { }
            catch (Exception exception) { Debug.LogWarning("[Presentation] Quest input rejected: " + exception.GetType().Name, this); }
        }

        private async Task SendTrackingAsync(TrackingFrame frame, CancellationToken token)
        {
            try { await runtime.SendTrackingAsync(frame, token); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { }
            catch (InvalidOperationException) when (!runtime.CanSendTracking) { }
            catch (Exception exception) { Debug.LogWarning("[Presentation] Quest tracking rejected: " + exception.GetType().Name, this); }
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
            if (lifetime != null && !lifetime.IsCancellationRequested && calibration.IsValid)
                interactionLifetime = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
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

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Google.Protobuf;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.XR;
using Unity.XR.CoreUtils;
using ProtoPose = Unframe.Presentation.Pose;
using Vector3 = UnityEngine.Vector3;
using Quaternion = UnityEngine.Quaternion;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    [RequireComponent(typeof(PresentationBakedRuntime))]
    public sealed class QuestPresentationEntry : MonoBehaviour
    {
        [SerializeField] private PresentationBakedRuntime runtime;
        [SerializeField] private XROrigin xrOrigin;
        private IQuestBodyPoseSource bodySource;
        private PresentationControlPlaneConnection connection;
        private CancellationTokenSource lifetime;
        private Task run;
        private Task input;
        private Task tracking;
        private ProtoPose calibration;
        private string logicalEventName;
        private readonly QuestPresentationButtonEdges buttons = new QuestPresentationButtonEdges();
        private double lastTrackingAt;

        private void Awake()
        {
            if (runtime == null) runtime = GetComponent<PresentationBakedRuntime>();
            if (xrOrigin == null) xrOrigin = FindAnyObjectByType<XROrigin>();
            foreach (MonoBehaviour component in GetComponents<MonoBehaviour>())
                if (component is IQuestBodyPoseSource source) { bodySource = source; break; }
        }

        private void Start()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (lifetime == null) TryStartFromAndroidLaunch();
#endif
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
            ProtoPose presentationFromQuestLocal, string advanceLogicalEventName)
        {
            if (!isActiveAndEnabled) throw new InvalidOperationException("The Quest presentation entry must be active.");
            if (lifetime != null) throw new InvalidOperationException("A Quest presentation is already configured.");
            if (runtime == null) runtime = GetComponent<PresentationBakedRuntime>();
            if (presentationFromQuestLocal?.Position == null || !PresentationDeliveryCatalog.IsCanonicalFinite(presentationFromQuestLocal.Position.X)
                || !PresentationDeliveryCatalog.IsCanonicalFinite(presentationFromQuestLocal.Position.Y)
                || !PresentationDeliveryCatalog.IsCanonicalFinite(presentationFromQuestLocal.Position.Z)
                || !PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(presentationFromQuestLocal.Rotation))
                throw new ArgumentException("Canonical calibration is required.");
            connection = new PresentationControlPlaneConnection(controlPlaneOrigin, sessionId, credentialProvider);
            calibration = presentationFromQuestLocal.Clone();
            logicalEventName = advanceLogicalEventName;
            CancellationTokenSource runLifetime = new CancellationTokenSource();
            lifetime = runLifetime;
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
                if (input != null) await input;
                if (tracking != null) await tracking;
                if (ReferenceEquals(lifetime, runLifetime))
                {
                    lifetime = null;
                    connection = null;
                    calibration = null;
                    logicalEventName = null;
                }
                runLifetime.Dispose();
            }
        }

        private void Update()
        {
            bool nextLeft = IsPressed(XRNode.LeftHand, CommonUsages.triggerButton);
            bool nextRight = IsPressed(XRNode.RightHand, CommonUsages.triggerButton);
            bool nextPrimary = IsPressed(XRNode.RightHand, CommonUsages.primaryButton);
            buttons.Sample(nextLeft, nextRight, nextPrimary, runtime.CanSendInput,
                out bool leftRayPressed, out bool rightRayPressed, out bool logicalPressed);
            if (lifetime == null || lifetime.IsCancellationRequested || !runtime.SessionReady) return;

            if (logicalPressed && !String.IsNullOrWhiteSpace(logicalEventName)
                && (input == null || input.IsCompleted) && runtime.PresentationOriginVersion != 0)
                input = SendInputAsync(QuestPresentationInput.CreateLogical(logicalEventName, runtime.PresentationOriginVersion), lifetime.Token);
            else if ((leftRayPressed || rightRayPressed) && (input == null || input.IsCompleted) && runtime.PresentationOriginVersion != 0)
            {
                XRNode hand = rightRayPressed ? XRNode.RightHand : XRNode.LeftHand;
                if (TryControllerRay(hand, out Ray ray) && runtime.TryPickInteraction(ray, out string surfaceId, out string interactionId))
                    input = SendInputAsync(QuestPresentationInput.CreateSurfaceInteraction(surfaceId, interactionId, runtime.PresentationOriginVersion), lifetime.Token);
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
                tracking = SendTrackingAsync(QuestPresentationTracking.CreateFrame(calibration, samples.ToArray()), lifetime.Token);
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
            if (xrOrigin == null || xrOrigin.CameraFloorOffsetObject == null
                || !QuestPresentationTracking.TrySample(node, target, out QuestPoseSample pose)) return false;
            Transform trackingOrigin = xrOrigin.CameraFloorOffsetObject.transform;
            ray = new Ray(trackingOrigin.TransformPoint(pose.Position), trackingOrigin.TransformDirection(pose.Rotation * Vector3.forward));
            return true;
        }

        private void OnDisable()
        {
            try { lifetime?.Cancel(); }
            catch (ObjectDisposedException) { }
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        private void TryStartFromAndroidLaunch()
        {
            try
            {
                string origin = ReadLaunchExtra("unframe.controlPlaneOrigin");
                string sessionId = ReadLaunchExtra("unframe.sessionId");
                string eventName = ReadLaunchExtra("unframe.advanceLogicalEvent");
                string calibrationJson = ReadLaunchExtra("unframe.presentationFromQuestLocal");
                if (String.IsNullOrEmpty(origin) || String.IsNullOrEmpty(sessionId) || String.IsNullOrEmpty(calibrationJson)) return;
                ProtoPose pose = JsonParser.Default.Parse<ProtoPose>(calibrationJson);
                Configure(new Uri(origin), sessionId, _ => Task.FromResult(ReadLaunchExtra("unframe.credential")), pose, eventName);
            }
            catch (Exception exception)
            {
                Debug.LogError("[Presentation] Quest launch configuration invalid: " + exception.GetType().Name, this);
            }
        }

        private static string ReadLaunchExtra(string key)
        {
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (AndroidJavaObject activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (AndroidJavaObject intent = activity.Call<AndroidJavaObject>("getIntent"))
                return intent.Call<string>("getStringExtra", key);
        }
#endif
    }
}

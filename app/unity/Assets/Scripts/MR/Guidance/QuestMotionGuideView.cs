using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.XR;
using Vector3 = UnityEngine.Vector3;
using Quaternion = UnityEngine.Quaternion;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestMotionGuideView : MonoBehaviour
    {
        private readonly QuestMotionGuideState state = new QuestMotionGuideState();
        private PresentationBakedRuntime runtime;
        private Transform trackingOrigin;
        private Transform head;
        private QuestPresentationStatusView ui;
        private QuestMotionGuideVisuals visuals;
        private string framedCue;
        private ulong groupEpoch;
        private ulong stepEpoch;
        private int candidateSignature;
        private Vector3 anchor;
        private Vector3 forward;
        private Vector3 right;
        private double candidateStartedAt;

        public bool Visible => visuals != null && visuals.Visible;

        public void Configure(PresentationBakedRuntime source, Transform origin, Transform headTransform, QuestPresentationStatusView statusView)
        {
            Hide();
            runtime = source;
            trackingOrigin = origin;
            head = headTransform;
            ui = statusView;
        }

        private void Update()
        {
            bool headTracked = QuestPresentationTracking.TrySample(XRNode.Head, TrackedTarget.Head, out _);
            bool leftTracked = QuestPresentationTracking.TrySample(XRNode.LeftHand, TrackedTarget.LeftHand, out _);
            bool rightTracked = QuestPresentationTracking.TrySample(XRNode.RightHand, TrackedTarget.RightHand, out _);
            if (runtime == null || head == null || trackingOrigin == null || ui == null || !ui.MotionGuideEnabled
                || !runtime.ControlReady || runtime.PlaybackStatus != "Running" && runtime.PlaybackStatus != "Paused") { Hide(); return; }
            var progression = runtime.DataStore.Progression;
            state.Refresh(runtime.InputSynchronization?.Catalog, progression,
                runtime.IsPresenter,
                runtime.CalibrationReady, runtime.DataStore.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running,
                headTracked, leftTracked, rightTracked, ui.MenuOpen, runtime.CanSendInput);
            if (!state.ShowHint) { Hide(); return; }
            int signature = 17;
            for (int candidate = 0; candidate < state.Candidates.Count; candidate++)
                signature = unchecked(signature * 31 + (int)state.Candidates[candidate]);
            if (candidateSignature != signature || groupEpoch != (progression?.GroupEntryEpoch ?? 0) || stepEpoch != (progression?.StepEntryEpoch ?? 0))
            {
                candidateSignature = signature;
                groupEpoch = progression?.GroupEntryEpoch ?? 0;
                stepEpoch = progression?.StepEntryEpoch ?? 0;
                candidateStartedAt = Time.realtimeSinceStartupAsDouble;
                framedCue = null;
            }
            int index = state.Candidates.Count == 0 ? 0 : (int)((Time.realtimeSinceStartupAsDouble - candidateStartedAt) / 6) % state.Candidates.Count;
            GestureKind selected = state.Candidates.Count == 0 ? GestureKind.Unspecified : state.Candidates[index];
            string cue = state.Candidates.Count == 0 ? state.Title : selected.ToString();
            bool candidateChanged = framedCue != cue;
            QuestMotionGuideGeometry.GetFrame(head.rotation, out Vector3 currentForward, out Vector3 currentRight);
            if (candidateChanged || QuestMotionGuideGeometry.NeedsReframe(forward, currentForward))
            {
                framedCue = cue;
                forward = currentForward;
                right = currentRight;
                anchor = head.position + forward * 1.5f + right * .3f - Vector3.up * .24f;
            }
            EnsureVisuals();
            if (visuals == null) return;
            if (state.Candidates.Count == 0)
                visuals.ShowHint(state.Title, state.Instruction, ui.MotionGuideDetails, anchor, forward);
            else
                visuals.Render(selected, index, state.Candidates.Count, anchor, forward, right, leftTracked,
                    Mathf.Repeat((float)Time.unscaledTimeAsDouble * .65f, 1), ui.MotionGuideDetails);
        }

        private void EnsureVisuals()
        {
            if (visuals != null) return;
            if (Resources.Load<Shader>("PresentationMaterials/MotionGuide") == null) { enabled = false; return; }
            visuals = new QuestMotionGuideVisuals(transform);
        }

        private void Hide() { visuals?.Hide(); framedCue = null; candidateSignature = 0; }
        private void OnDisable() => Hide();
        private void OnDestroy() { visuals?.Dispose(); visuals = null; }
    }
}

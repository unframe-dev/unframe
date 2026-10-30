using System;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.XR;
using Vector3 = UnityEngine.Vector3;
using Vector2 = UnityEngine.Vector2;
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
        private GameObject visuals;
        private readonly QuestMotionArmRig[] arms = new QuestMotionArmRig[2];
        private Text label;
        private RectTransform instructionPanel;
        private string framedCue;
        private ulong groupEpoch;
        private ulong stepEpoch;
        private int candidateSignature;
        private Vector3 anchor;
        private Vector3 forward;
        private Vector3 right;
        private Quaternion guideRotation;
        private bool hasGuideFrame;
        private double candidateStartedAt;

        public bool Visible => visuals != null && visuals.activeSelf;

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
            ProgressionRuntimeState progression = runtime?.DataStore.Progression;
            state.Refresh(runtime?.InputSynchronization?.Catalog, progression,
                runtime != null && runtime.IsPresenter && runtime.CanSendInput,
                runtime != null && runtime.CalibrationReady, runtime?.DataStore.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running,
                headTracked && head != null && trackingOrigin != null, leftTracked, rightTracked, ui == null || ui.MenuOpen);
            if (state.Candidates.Count == 0) { Hide(); return; }
            int signature = 17;
            for (int candidate = 0; candidate < state.Candidates.Count; candidate++)
                signature = unchecked(signature * 31 + (int)state.Candidates[candidate]);
            if (candidateSignature != signature || groupEpoch != progression.GroupEntryEpoch || stepEpoch != progression.StepEntryEpoch)
            {
                candidateSignature = signature;
                groupEpoch = progression.GroupEntryEpoch;
                stepEpoch = progression.StepEntryEpoch;
                candidateStartedAt = Time.realtimeSinceStartupAsDouble;
                framedCue = null;
            }
            int index = (int)((Time.realtimeSinceStartupAsDouble - candidateStartedAt) / 6) % state.Candidates.Count;
            GestureKind selected = state.Candidates[index];
            bool candidateChanged = framedCue != selected.ToString();
            Quaternion targetRotation = head.rotation;
            Vector3 targetAnchor = head.position + targetRotation * new Vector3(0, -.3f, 1.05f);
            if (!hasGuideFrame)
            {
                anchor = targetAnchor;
                guideRotation = targetRotation;
                hasGuideFrame = true;
            }
            else
            {
                float follow = 1 - Mathf.Exp(-8f * Time.unscaledDeltaTime);
                anchor = Vector3.Lerp(anchor, targetAnchor, follow);
                guideRotation = Quaternion.Slerp(guideRotation, targetRotation, follow);
            }
            // Keep gesture directions in the recognizer's horizontal frame while the panel follows the head.
            QuestMotionGuideGeometry.GetFrame(guideRotation, out forward, out right);
            bool both = (int)selected >= 7;
            bool firstLeft = leftTracked;
            framedCue = selected.ToString();
            EnsureVisuals();
            if (visuals == null) return;
            visuals.SetActive(true);
            instructionPanel.SetPositionAndRotation(anchor + guideRotation * Vector3.up * .3f, guideRotation);
            if (candidateChanged) label.text = Description((int)selected);
            Quaternion motionFrame = Quaternion.LookRotation(forward, Vector3.up);
            Vector3 diagramOrigin = anchor;
            for (int i = 0; i < 2; i++)
            {
                bool left = i == 0;
                bool shown = both || left == firstLeft;
                arms[i].SetVisible(shown);
                if (!shown) continue;
                arms[i].Play(diagramOrigin, motionFrame, selected);
            }
        }

        private void EnsureVisuals()
        {
            if (visuals != null) return;
            try
            {
                visuals = new GameObject("Presenter motion guide");
                visuals.transform.SetParent(transform, false);
                for (int i = 0; i < 2; i++)
                {
                    string model = i == 0 ? "LeftMotionArm" : "RightMotionArm";
                    arms[i] = new QuestMotionArmRig(Resources.Load<GameObject>("PresentationUi/MotionArms/Editable/" + model),
                        visuals.transform, i == 0);
                }
                var canvasHost = new GameObject("Motion instruction", typeof(RectTransform), typeof(Canvas));
                canvasHost.transform.SetParent(visuals.transform, false);
                canvasHost.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
                // The transparent arm meshes must not obscure the gesture instruction.
                canvasHost.GetComponent<Canvas>().overrideSorting = true;
                canvasHost.GetComponent<Canvas>().sortingOrder = 10;
                QuestPresentationUiFont.ConfigureCanvas(canvasHost.GetComponent<Canvas>());
                instructionPanel = canvasHost.GetComponent<RectTransform>();
                instructionPanel.sizeDelta = new Vector2(600, 100);
                instructionPanel.localScale = Vector3.one * .0008f;
                var backplate = canvasHost.AddComponent<Image>();
                backplate.color = new Color(.025f, .045f, .075f, .94f);
                backplate.raycastTarget = false;
                var textHost = new GameObject("Instruction text", typeof(RectTransform));
                textHost.transform.SetParent(canvasHost.transform, false);
                var textRect = textHost.GetComponent<RectTransform>();
                textRect.anchorMin = Vector2.zero;
                textRect.anchorMax = Vector2.one;
                textRect.offsetMin = new Vector2(20, 10);
                textRect.offsetMax = new Vector2(-20, -10);
                label = textHost.AddComponent<Text>();
                label.font = QuestPresentationUiFont.Load();
                label.fontSize = 36;
                label.alignment = TextAnchor.MiddleCenter;
                label.color = Color.white;
                label.raycastTarget = false;
                label.horizontalOverflow = HorizontalWrapMode.Wrap;
            }
            catch (Exception)
            {
                ReleaseVisuals();
                enabled = false;
                Debug.LogError("Motion guide assets could not be initialized.");
            }
        }

        private static string Description(int preset)
        {
            switch (preset)
            {
                case 1: return "左へ薙ぎ払う";
                case 2: return "右へ薙ぎ払う";
                case 3: return "振り下ろす";
                case 4: return "振りかぶる";
                case 5: return "押し出す";
                case 6: return "手前へ引く";
                case 7: return "両手を広げる";
                case 8: return "両手を寄せる";
                default: return String.Empty;
            }
        }

        private void Hide()
        {
            foreach (QuestMotionArmRig arm in arms) arm?.SetVisible(false);
            if (visuals != null) visuals.SetActive(false);
            framedCue = null;
            candidateSignature = 0;
            hasGuideFrame = false;
        }
        private void OnDisable() => Hide();
        private void OnDestroy() => ReleaseVisuals();
        private void ReleaseVisuals()
        {
            if (visuals != null)
            {
                visuals.SetActive(false);
                DestroyOwned(visuals);
            }
            visuals = null;
            instructionPanel = null;
            label = null;
            for (int i = 0; i < arms.Length; i++)
            {
                arms[i] = null;
            }
        }
        private static void DestroyOwned(UnityEngine.Object value) { if (Application.isPlaying) Destroy(value); else DestroyImmediate(value); }
    }
}

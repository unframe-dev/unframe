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
        private QuestPresentationEntry entry;
        private Transform trackingOrigin;
        private Transform head;
        private Camera headCamera;
        private QuestPresentationStatusView ui;
        private GameObject visuals;
        private readonly QuestMotionArmRig[] arms = new QuestMotionArmRig[2];
        private Text label;
        private RectTransform instructionPanel;
        private ulong groupEpoch;
        private ulong stepEpoch;
        private int candidateSignature;
        private double candidateStartedAt;

        public bool Visible => visuals != null && visuals.activeSelf;

        public void Configure(PresentationBakedRuntime source, Transform origin, Transform headTransform, QuestPresentationStatusView statusView)
        {
            Hide();
            runtime = source;
            entry = source != null ? source.GetComponent<QuestPresentationEntry>() : null;
            trackingOrigin = origin;
            head = headTransform;
            headCamera = head != null ? head.GetComponent<Camera>() : null;
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
                headTracked && head != null && headCamera != null && trackingOrigin != null, leftTracked, rightTracked, ui == null || !ui.GuidanceVisible, entry != null && entry.CanAdvance);
            int candidateCount = state.Zones.Count + state.Candidates.Count;
            if (candidateCount == 0 && !state.ShowAdvance) { Hide(); return; }
            int signature = 17;
            foreach (var zone in state.Zones)
                signature = unchecked(signature * 31 + zone.ZoneId.GetHashCode());
            for (int candidate = 0; candidate < state.Candidates.Count; candidate++)
                signature = unchecked(signature * 31 + (int)state.Candidates[candidate]);
            if (candidateSignature != signature || groupEpoch != progression.GroupEntryEpoch || stepEpoch != progression.StepEntryEpoch)
            {
                candidateSignature = signature;
                groupEpoch = progression.GroupEntryEpoch;
                stepEpoch = progression.StepEntryEpoch;
                candidateStartedAt = Time.realtimeSinceStartupAsDouble;
            }
            int index = candidateCount == 0 ? 0
                : (int)((Time.realtimeSinceStartupAsDouble - candidateStartedAt) / 6) % candidateCount;
            bool showZone = index < state.Zones.Count;
            GestureKind selected = candidateCount == 0 || showZone
                ? GestureKind.Unspecified : state.Candidates[index - state.Zones.Count];
            Quaternion guideRotation = head.rotation;
            Vector3 anchor = QuestMotionGuideGeometry.GetAnchorPosition(head.position, guideRotation,
                headCamera.fieldOfView, headCamera.aspect);
            QuestMotionGuideGeometry.GetFrame(guideRotation, out Vector3 forward, out _);
            bool both = selected == GestureKind.SpreadHands || selected == GestureKind.CloseHands;
            bool firstLeft = leftTracked;
            EnsureVisuals();
            if (visuals == null) return;
            visuals.SetActive(true);
            Vector3 instructionPosition = QuestMotionGuideGeometry.GetInstructionPosition(anchor, guideRotation);
            instructionPanel.SetPositionAndRotation(instructionPosition,
                QuestMotionGuideGeometry.GetFacingRotation(instructionPosition, head.position, head.rotation));
            float viewportScale = QuestMotionGuideGeometry.GetViewportScale(headCamera.fieldOfView, headCamera.aspect);
            instructionPanel.localScale = Vector3.one * (.00022f * viewportScale);
            string instruction = showZone ? ZoneInstruction(state.Zones[index]) : Instruction(selected, state.ShowAdvance);
            if (label.text != instruction) label.text = instruction;
            Quaternion motionFrame = Quaternion.LookRotation(forward, Vector3.up);
            Vector3 diagramOrigin = anchor;
            for (int i = 0; i < 2; i++)
            {
                bool left = i == 0;
                bool shown = selected >= GestureKind.SwipeLeft && selected <= GestureKind.CloseHands
                    && (both || left == firstLeft);
                arms[i].SetVisible(shown);
                if (!shown) continue;
                arms[i].Play(diagramOrigin, motionFrame, selected, viewportScale);
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
                instructionPanel.sizeDelta = new Vector2(640, 190);
                instructionPanel.localScale = Vector3.one * .00022f;
                var backplate = canvasHost.AddComponent<Image>();
                QuestPresenterUiStyle.ApplySurface(backplate);
                var textHost = new GameObject("Instruction text", typeof(RectTransform));
                textHost.transform.SetParent(canvasHost.transform, false);
                var textRect = textHost.GetComponent<RectTransform>();
                textRect.anchorMin = Vector2.zero;
                textRect.anchorMax = Vector2.one;
                textRect.offsetMin = new Vector2(28, 18);
                textRect.offsetMax = new Vector2(-28, -18);
                label = textHost.AddComponent<Text>();
                QuestPresenterUiStyle.ConfigureText(label, 34);
                label.alignment = TextAnchor.MiddleCenter;
                label.horizontalOverflow = HorizontalWrapMode.Wrap;
            }
            catch (Exception)
            {
                ReleaseVisuals();
                enabled = false;
                Debug.LogError("Motion guide assets could not be initialized.");
            }
        }

        private static string ZoneInstruction(PresenterRecognitionZone zone)
        {
            var center = zone.Center;
            string location = "ステージ中央";
            if (Math.Abs(center.X) >= Math.Abs(center.Z) && center.X != 0)
                location = center.X < 0 ? "ステージ左側" : "ステージ右側";
            else if (center.Z != 0)
                location = center.Z < 0 ? "ステージ前方" : "ステージ後方";
            return location + "のゾーン\n境界を越えて移動";
        }

        private static string Instruction(GestureKind gesture, bool showAdvance)
        {
            string motion = Description((int)gesture);
            if (!showAdvance) return motion;
            return string.IsNullOrEmpty(motion) ? "次へ: 右コントローラーのAボタン"
                : motion + "\nまたは右Aボタンで次へ";
        }

        private static string Description(int preset)
        {
            string action;
            switch (preset)
            {
                case 1: action = "左へ薙ぎ払う"; break;
                case 2: action = "右へ薙ぎ払う"; break;
                case 3: action = "振り下ろす"; break;
                case 4: action = "振りかぶる"; break;
                case 5: action = "押し出す"; break;
                case 6: action = "手前へ引く"; break;
                case 7: action = "両手を広げる"; break;
                case 8: action = "両手を寄せる"; break;
                case 9: return "トリガーを押して投げる動作\n最後にトリガーを離す";
                case 10: return "トリガーを押して円を描く\n最後にトリガーを離す";
                default: return String.Empty;
            }
            return (preset >= 7 ? "両トリガーを押したまま\n" : "トリガーを押したまま\n") + action;
        }

        private void Hide()
        {
            foreach (QuestMotionArmRig arm in arms) arm?.SetVisible(false);
            if (visuals != null) visuals.SetActive(false);
            candidateSignature = 0;
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

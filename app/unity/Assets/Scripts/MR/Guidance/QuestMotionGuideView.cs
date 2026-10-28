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
        private Material material;
        private Mesh ghostMesh;
        private readonly LineRenderer[] arrows = new LineRenderer[2];
        private readonly Transform[] ghosts = new Transform[2];
        private Text label;
        private Text titleLabel;
        private RectTransform instructionPanel;
        private string framedCue;
        private ulong groupEpoch;
        private ulong stepEpoch;
        private int candidateSignature;
        private readonly Vector3[][] arrowPoints = { new Vector3[5], new Vector3[5] };
        private Vector3 anchor;
        private Vector3 forward;
        private Vector3 right;
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
            ShowInstruction(state.Candidates.Count == 0 ? state.Title : QuestMotionGuideState.Description(selected),
                state.Candidates.Count == 0 ? state.Instruction : "操作候補 " + (index + 1) + " / " + state.Candidates.Count + "\n"
                    + QuestMotionGuideState.InstructionFor(selected, ui.MotionGuideDetails) + "\nX：操作・設定・退出", ui.MotionGuideDetails);
            if (visuals == null) return;
            instructionPanel.SetPositionAndRotation(anchor + Vector3.up * .1f, Quaternion.LookRotation(forward, Vector3.up));
            if (state.Candidates.Count == 0)
            {
                for (int i = 0; i < arrows.Length; i++) { arrows[i].gameObject.SetActive(false); ghosts[i].gameObject.SetActive(false); }
                return;
            }
            QuestMotionGuideGeometry.Diagram((int)selected, ((int)selected >= 7 ? .25 : .18), out float startHalf, out float endHalf, out float scale);
            bool both = (int)selected >= 7;
            bool firstLeft = leftTracked;
            float phase = Mathf.Repeat((float)Time.unscaledTimeAsDouble * .65f, 1);
            for (int i = 0; i < 2; i++)
            {
                bool shown = i == 0 || both;
                arrows[i].gameObject.SetActive(shown);
                ghosts[i].gameObject.SetActive(shown);
                if (!shown) continue;
                bool left = both ? i == 0 : firstLeft;
                Vector3 diagramOrigin = anchor - Vector3.up * .34f;
                Vector3 start = diagramOrigin + (both ? (left ? -right : right) * startHalf * scale : Vector3.zero);
                Vector3 direction = QuestMotionGuideGeometry.Direction((int)selected, forward, right, left);
                Vector3 end = both ? diagramOrigin + (left ? -right : right) * endHalf * scale : start + direction * endHalf * scale;
                Vector3 wing = Mathf.Abs(Vector3.Dot(direction, Vector3.up)) > .9f ? right : Vector3.up;
                Vector3[] points = arrowPoints[i];
                points[0] = start;
                points[1] = end;
                points[2] = end - direction * .055f + wing * .035f;
                points[3] = end;
                points[4] = end - direction * .055f - wing * .035f;
                arrows[i].SetPositions(points);
                ghosts[i].position = Vector3.Lerp(start, end, phase);
            }
        }

        private void ShowInstruction(string title, string instruction, bool detailed)
        {
            EnsureVisuals();
            if (visuals == null) return;
            visuals.SetActive(true);
            instructionPanel.sizeDelta = new Vector2(900, detailed ? 360 : 250);
            titleLabel.rectTransform.anchoredPosition = new Vector2(0, instructionPanel.sizeDelta.y * .5f - 47);
            titleLabel.text = title;
            label.text = instruction;
        }

        private void EnsureVisuals()
        {
            if (visuals != null) return;
            Shader shader = Resources.Load<Shader>("PresentationMaterials/PresentationUnlit");
            if (shader == null) { enabled = false; return; }
            material = new Material(shader) { name = "Motion guide material" };
            material.SetColor("_BaseColor", QuestUiTheme.Primary);
            visuals = new GameObject("Presenter motion guide");
            visuals.transform.SetParent(transform, false);
            ghostMesh = CreateGhostMesh();
            for (int i = 0; i < 2; i++)
            {
                var arrow = new GameObject("Direction " + i);
                arrow.transform.SetParent(visuals.transform, false);
                arrows[i] = arrow.AddComponent<LineRenderer>();
                arrows[i].sharedMaterial = material;
                arrows[i].useWorldSpace = true;
                arrows[i].positionCount = 5;
                arrows[i].widthMultiplier = .009f;
                arrows[i].numCapVertices = 4;
                var ghost = new GameObject("Hand position ghost " + i);
                ghost.transform.SetParent(visuals.transform, false);
                ghost.AddComponent<MeshFilter>().sharedMesh = ghostMesh;
                ghost.AddComponent<MeshRenderer>().sharedMaterial = material;
                ghosts[i] = ghost.transform;
                ghosts[i].localScale = Vector3.one * .028f;
            }
            var canvasHost = new GameObject("Motion instruction", typeof(RectTransform), typeof(Canvas));
            canvasHost.transform.SetParent(visuals.transform, false);
            canvasHost.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
            instructionPanel = canvasHost.GetComponent<RectTransform>();
            instructionPanel.sizeDelta = new Vector2(900, 250);
            instructionPanel.localScale = Vector3.one * .0008f;
            var backplate = canvasHost.AddComponent<Image>();
            QuestUiTheme.ApplySurface(backplate);
            backplate.raycastTarget = false;
            var titleHost = new GameObject("Instruction title", typeof(RectTransform), typeof(Text));
            titleHost.transform.SetParent(canvasHost.transform, false);
            titleLabel = titleHost.GetComponent<Text>();
            titleLabel.rectTransform.sizeDelta = new Vector2(850, 65);
            titleLabel.rectTransform.anchoredPosition = new Vector2(0, 78);
            titleLabel.font = QuestPresentationUiFont.Load();
            titleLabel.fontSize = 34;
            titleLabel.alignment = TextAnchor.MiddleCenter;
            titleLabel.color = QuestUiTheme.Primary;
            titleLabel.raycastTarget = false;
            titleLabel.supportRichText = false;
            var textHost = new GameObject("Instruction text", typeof(RectTransform));
            textHost.transform.SetParent(canvasHost.transform, false);
            var textRect = textHost.GetComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = new Vector2(24, 14);
            textRect.offsetMax = new Vector2(-24, -78);
            label = textHost.AddComponent<Text>();
            label.font = QuestPresentationUiFont.Load();
            label.fontSize = 27;
            label.alignment = TextAnchor.MiddleCenter;
            label.color = QuestUiTheme.Text;
            label.raycastTarget = false;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.supportRichText = false;
        }

        private static Mesh CreateGhostMesh()
        {
            const int rings = 8;
            const int segments = 12;
            var vertices = new Vector3[(rings + 1) * (segments + 1)];
            var triangles = new int[rings * segments * 6];
            int cursor = 0;
            for (int ring = 0; ring <= rings; ring++)
                for (int segment = 0; segment <= segments; segment++)
                {
                    float theta = Mathf.PI * ring / rings;
                    float phi = 2 * Mathf.PI * segment / segments;
                    vertices[ring * (segments + 1) + segment] = new Vector3(Mathf.Sin(theta) * Mathf.Cos(phi), Mathf.Cos(theta), Mathf.Sin(theta) * Mathf.Sin(phi));
                    if (ring == rings || segment == segments) continue;
                    int a = ring * (segments + 1) + segment;
                    int b = a + segments + 1;
                    triangles[cursor++] = a; triangles[cursor++] = a + 1; triangles[cursor++] = b;
                    triangles[cursor++] = a + 1; triangles[cursor++] = b + 1; triangles[cursor++] = b;
                }
            var mesh = new Mesh { name = "Motion guide hand ghost", vertices = vertices, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private void Hide() { if (visuals != null) visuals.SetActive(false); framedCue = null; candidateSignature = 0; }
        private void OnDisable() => Hide();
        private void OnDestroy()
        {
            if (visuals != null) DestroyOwned(visuals);
            if (material != null) DestroyOwned(material);
            if (ghostMesh != null) DestroyOwned(ghostMesh);
        }
        private static void DestroyOwned(UnityEngine.Object value) { if (Application.isPlaying) Destroy(value); else DestroyImmediate(value); }
    }
}

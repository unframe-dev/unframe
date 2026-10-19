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
            var progression = runtime?.DataStore.Progression;
            state.Refresh(runtime?.DataStore.Catalog, progression,
                runtime != null && runtime.IsPresenter && runtime.SessionReady,
                runtime != null && runtime.CalibrationReady, runtime?.DataStore.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running,
                headTracked && head != null && trackingOrigin != null, leftTracked, rightTracked, ui == null || ui.MenuOpen);
            if (state.Candidates.Count == 0) { Hide(); return; }
            int signature = 17;
            for (int candidate = 0; candidate < state.Candidates.Count; candidate++)
                signature = unchecked(signature * 31 + state.Candidates[candidate].CueId.GetHashCode());
            if (candidateSignature != signature || groupEpoch != progression.GroupEntryEpoch || stepEpoch != progression.StepEntryEpoch)
            {
                candidateSignature = signature;
                groupEpoch = progression.GroupEntryEpoch;
                stepEpoch = progression.StepEntryEpoch;
                candidateStartedAt = Time.realtimeSinceStartupAsDouble;
                framedCue = null;
            }
            int index = (int)((Time.realtimeSinceStartupAsDouble - candidateStartedAt) / 6) % state.Candidates.Count;
            ProjectedMotionGuideDefinition selected = state.Candidates[index];
            bool candidateChanged = framedCue != selected.CueId;
            QuestMotionGuideGeometry.GetFrame(head.rotation, out Vector3 currentForward, out Vector3 currentRight);
            if (candidateChanged || QuestMotionGuideGeometry.NeedsReframe(forward, currentForward))
            {
                framedCue = selected.CueId;
                forward = currentForward;
                right = currentRight;
                anchor = head.position + forward * 1.05f - Vector3.up * .3f;
            }
            EnsureVisuals();
            if (visuals == null) return;
            visuals.SetActive(true);
            instructionPanel.SetPositionAndRotation(anchor + Vector3.up * .3f, Quaternion.LookRotation(forward, Vector3.up));
            QuestMotionGuideGeometry.Diagram((int)selected.Preset, selected.MinimumDistanceMeters, out float startHalf, out float endHalf, out float scale);
            bool both = (int)selected.Hand == 4;
            if (candidateChanged)
            {
                var culture = System.Globalization.CultureInfo.InvariantCulture;
                string distance = (selected.MinimumDistanceMeters * 100).ToString("0.#", culture);
                string seconds = (selected.WindowMs / 1000.0).ToString("0.##", culture);
                label.text = "操作候補 " + (index + 1) + "/" + state.Candidates.Count + "　" + Description((int)selected.Preset)
                    + "\n前を見る → " + HandDescription((int)selected.Hand) + "を0.2秒止める → 動かす"
                    + "\n" + (both ? "両手の間隔を" : "手を") + distance + "cm以上 / " + seconds + "秒以内（25cm/秒以上）"
                    + (both ? "\n開始間隔" + (startHalf * 200).ToString("0.#", culture) + "cm → 終了間隔" + (endHalf * 200).ToString("0.#", culture) + "cm・各手10cm以上" : "")
                    + "\n方向の例・縮尺図（実寸ではありません）";
            }
            bool firstLeft = (int)selected.Hand == 2 || (int)selected.Hand == 1 && leftTracked;
            float phase = Mathf.Repeat((float)Time.unscaledTimeAsDouble * .65f, 1);
            for (int i = 0; i < 2; i++)
            {
                bool shown = i == 0 || both;
                arrows[i].gameObject.SetActive(shown);
                ghosts[i].gameObject.SetActive(shown);
                if (!shown) continue;
                bool left = both ? i == 0 : firstLeft;
                Vector3 diagramOrigin = anchor - Vector3.up * .16f;
                Vector3 start = diagramOrigin + (both ? (left ? -right : right) * startHalf * scale : Vector3.zero);
                Vector3 direction = QuestMotionGuideGeometry.Direction((int)selected.Preset, forward, right, left);
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

        private void EnsureVisuals()
        {
            if (visuals != null) return;
            Shader shader = Resources.Load<Shader>("PresentationMaterials/PresentationUnlit");
            if (shader == null) { enabled = false; return; }
            material = new Material(shader) { name = "Motion guide material" };
            material.SetColor("_BaseColor", new Color(.25f, .9f, 1, .85f));
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
            instructionPanel.sizeDelta = new Vector2(900, 300);
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
            label.fontSize = 30;
            label.alignment = TextAnchor.MiddleCenter;
            label.color = Color.white;
            label.raycastTarget = false;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
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

        private static string Description(int preset)
        {
            switch (preset)
            {
                case 1: return "左へ動かす";
                case 2: return "右へ動かす";
                case 3: return "下へ動かす";
                case 4: return "上へ動かす";
                case 5: return "前へ押す";
                case 6: return "手前へ引く";
                case 7: return "両手を広げる";
                case 8: return "両手を寄せる";
                default: return String.Empty;
            }
        }

        private static string HandDescription(int hand) => hand == 2 ? "左手" : hand == 3 ? "右手" : hand == 4 ? "両手" : "左右いずれかの手";
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

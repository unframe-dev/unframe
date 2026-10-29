using System;
using Unframe.Presentation;
using UnityEngine;
using UnityEngine.UI;
using Vector3 = UnityEngine.Vector3;
using Vector2 = UnityEngine.Vector2;
using Quaternion = UnityEngine.Quaternion;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestMotionGuideVisuals : IDisposable
    {
        private readonly Transform parent;
        private GameObject visuals;
        private Material material;
        private Mesh mesh;
        private readonly Arm[] arms = new Arm[2];
        private Text label;
        private Text titleLabel;
        private RectTransform instructionPanel;
        private bool disposed;

        public QuestMotionGuideVisuals(Transform parent)
        {
            this.parent = parent != null ? parent : throw new ArgumentNullException(nameof(parent));
            try { CreateVisuals(); Hide(); }
            catch { Dispose(); throw; }
        }
        public Transform Root => visuals != null ? visuals.transform : null;
        public bool Visible => visuals != null && visuals.activeSelf;

        public void Render(GestureKind gesture, int candidateIndex, int candidateCount,
            Vector3 anchor, Vector3 forward, Vector3 right, bool leftHand, float phase, bool detailed = true)
        {
            if (disposed) throw new ObjectDisposedException(nameof(QuestMotionGuideVisuals));
            if (gesture < GestureKind.SwipeLeft || gesture > GestureKind.CloseHands) throw new ArgumentOutOfRangeException(nameof(gesture));
            bool both = gesture == GestureKind.SpreadHands || gesture == GestureKind.CloseHands;
            double minimumDistance = both ? .25 : .18;
            ShowInstruction(QuestMotionGuideState.Description(gesture),
                "操作候補 " + (candidateIndex + 1) + " / " + candidateCount + "\n"
                    + QuestMotionGuideState.InstructionFor(gesture, detailed)
                    + "\nX：操作・設定・退出\n腕は動作の見本です（実寸ではありません）", detailed, anchor, forward);
            float progress = QuestMotionGuideGeometry.MotionProgress(phase);
            for (int i = 0; i < 2; i++)
            {
                bool left = i == 0;
                bool shown = both || left == leftHand;
                arms[i].Root.gameObject.SetActive(shown);
                if (!shown) continue;
                Vector3 origin = anchor - Vector3.up * .16f;
                var pose = QuestMotionGuideGeometry.ArmPose((int)gesture, minimumDistance, both, left,
                    origin, forward, right, progress);
                arms[i].Apply(pose);
            }
        }

        public void ShowHint(string title, string instruction, bool detailed, Vector3 anchor, Vector3 forward)
        {
            ShowInstruction(title, instruction, detailed, anchor, forward);
            foreach (var arm in arms) arm.Root.gameObject.SetActive(false);
        }

        private void ShowInstruction(string title, string instruction, bool detailed, Vector3 anchor, Vector3 forward)
        {
            if (disposed) throw new ObjectDisposedException(nameof(QuestMotionGuideVisuals));
            visuals.SetActive(true);
            instructionPanel.SetPositionAndRotation(anchor + Vector3.up * .3f, Quaternion.LookRotation(forward, Vector3.up));
            instructionPanel.sizeDelta = new Vector2(900, detailed ? 420 : 330);
            titleLabel.rectTransform.anchoredPosition = new Vector2(0, instructionPanel.sizeDelta.y * .5f - 47);
            titleLabel.text = title;
            label.text = instruction;
        }

        private void CreateVisuals()
        {
            Shader shader = Resources.Load<Shader>("PresentationMaterials/MotionGuide");
            if (shader == null) throw new InvalidOperationException("motion-guide-shader-missing");
            material = new Material(shader) { name = "Motion guide material" };
            material.SetColor("_BaseColor", QuestUiTheme.Primary);
            visuals = new GameObject("Presenter motion guide");
            visuals.transform.SetParent(parent, false);
            mesh = CreateArmMesh();
            for (int i = 0; i < 2; i++)
            {
                arms[i] = new Arm(visuals.transform, mesh, material, i == 0 ? "Left demonstration arm" : "Right demonstration arm");
            }
            var canvasHost = new GameObject("Motion instruction", typeof(RectTransform), typeof(Canvas));
            canvasHost.transform.SetParent(visuals.transform, false);
            canvasHost.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
            instructionPanel = canvasHost.GetComponent<RectTransform>();
            instructionPanel.sizeDelta = new Vector2(900, 300);
            instructionPanel.localScale = Vector3.one * .0008f;
            var backplate = canvasHost.AddComponent<Image>();
            QuestUiTheme.ApplySurface(backplate);
            backplate.raycastTarget = false;
            var titleHost = new GameObject("Instruction title", typeof(RectTransform), typeof(Text));
            titleHost.transform.SetParent(canvasHost.transform, false);
            titleLabel = titleHost.GetComponent<Text>();
            titleLabel.rectTransform.sizeDelta = new Vector2(850, 65);
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

        private static Mesh CreateArmMesh()
        {
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.SetActive(false);
            try
            {
                // CreatePrimitive requires its collider type to survive Player stripping.
                var collider = cube.GetComponent<BoxCollider>();
                if (collider != null) DestroyOwned(collider);
                var mesh = UnityEngine.Object.Instantiate(cube.GetComponent<MeshFilter>().sharedMesh);
                mesh.name = "Motion guide cuboid";
                return mesh;
            }
            finally { DestroyOwned(cube); }
        }

        public void Hide() { if (visuals != null) visuals.SetActive(false); }
        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            if (visuals != null) { visuals.SetActive(false); DestroyOwned(visuals); }
            if (material != null) DestroyOwned(material);
            if (mesh != null) DestroyOwned(mesh);
            visuals = null; material = null; mesh = null;
        }
        private static void DestroyOwned(UnityEngine.Object value) { if (Application.isPlaying) UnityEngine.Object.Destroy(value); else UnityEngine.Object.DestroyImmediate(value); }

        private sealed class Arm
        {
            public Transform Root { get; }
            private readonly Transform upper, forearm, elbow, palm;
            private readonly Transform wrist;
            public Arm(Transform parent, Mesh mesh, Material material, string name)
            {
                Root = new GameObject(name).transform;
                Root.SetParent(parent, false);
                upper = Part("Upper arm", mesh, material);
                forearm = Part("Forearm", mesh, material);
                elbow = Part("Elbow", mesh, material);
                wrist = new GameObject("Hand").transform; wrist.SetParent(Root, false);
                palm = Part("Palm", mesh, material); palm.SetParent(wrist, false);
                Tint(upper, QuestUiTheme.Primary);
                Tint(forearm, Color.Lerp(QuestUiTheme.Primary, QuestUiTheme.Text, .25f));
                Tint(elbow, Color.Lerp(QuestUiTheme.Primary, QuestUiTheme.Surface, .2f));
                Tint(palm, Color.Lerp(QuestUiTheme.Primary, QuestUiTheme.Text, .55f));
            }
            private Transform Part(string name, Mesh mesh, Material material)
            {
                var part = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
                part.transform.SetParent(Root, false);
                part.GetComponent<MeshFilter>().sharedMesh = mesh;
                part.GetComponent<MeshRenderer>().sharedMaterial = material;
                return part.transform;
            }
            public void Apply(QuestMotionGuideArmPose pose)
            {
                // The bend plane stays stable when either bone points toward the viewer.
                Vector3 normal = Vector3.Cross(pose.Elbow - pose.Shoulder, pose.Wrist - pose.Elbow).normalized;
                Segment(upper, pose.Shoulder, pose.Elbow, .048f, normal);
                Segment(forearm, pose.Elbow, pose.Wrist, .042f, normal);
                elbow.SetPositionAndRotation(pose.Elbow, upper.rotation);
                elbow.localScale = Vector3.one * .05f;
                wrist.SetPositionAndRotation(pose.Wrist, forearm.rotation * Quaternion.Euler(-90, 0, 0));
                palm.localPosition = new Vector3(0, 0, .04f);
                palm.localScale = new Vector3(.07f, .032f, .08f);
            }
            private static void Tint(Transform part, Color color)
            {
                var properties = new MaterialPropertyBlock();
                properties.SetColor("_BaseColor", color);
                part.GetComponent<MeshRenderer>().SetPropertyBlock(properties);
            }

            private static void Segment(Transform part, Vector3 start, Vector3 end, float width, Vector3 normal)
            {
                Vector3 direction = end - start;
                part.SetPositionAndRotation((start + end) * .5f, Quaternion.LookRotation(normal, direction));
                part.localScale = new Vector3(width, direction.magnitude, width);
            }
        }
    }
}

using System;
using UnityEngine;
using Unframe.Unity.VisualEffects.Gestures;

namespace Unframe.Unity.VisualEffects
{
    public sealed class VisualEffectsPreview : MonoBehaviour
    {
        [SerializeField, Range(0.25f, 2)] private float size = 1;
        [SerializeField, Range(0.25f, 3)] private float speed = 1;
        [SerializeField] private Color color = Color.cyan;
        [SerializeField] private GestureRecognitionSettings recognition = new GestureRecognitionSettings();
        private VisualEffectPlayer player;
        private GameObject stage;
        private Material modelMaterial;
        private string handId;
        private int sequence;
        private string status = "Select an effect. Gesture buttons use synthetic samples, not device tracking.";
        public MeshRenderer Model { get; private set; }
        public double RuntimeMs { get; private set; }
        public bool Paused { get; set; }
        public int ActiveCount => player?.ActiveCount ?? 0;

        private void Start() => Initialize();
        public void Initialize()
        {
            if (player != null) return;
            player = new VisualEffectPlayer();
            stage = new GameObject("Preview stage");
            stage.transform.SetParent(transform, false);
            var camera = new GameObject("Preview camera").AddComponent<Camera>();
            camera.transform.SetParent(stage.transform, false);
            camera.transform.localPosition = new Vector3(0, 1, -7);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.025f, 0.03f, 0.06f);
            var light = new GameObject("Preview light").AddComponent<Light>();
            light.transform.SetParent(stage.transform, false);
            light.type = LightType.Directional;
            light.transform.localRotation = Quaternion.Euler(35, -30, 0);
            light.intensity = 1.5f;
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = "Dissolve target";
            cube.transform.SetParent(stage.transform, false);
            cube.transform.localPosition = new Vector3(0, 1, 0);
            Model = cube.GetComponent<MeshRenderer>();
            Model.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            modelMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            modelMaterial.color = new Color(0.65f, 0.7f, 0.85f);
            Model.sharedMaterial = modelMaterial;
        }
        private EffectOptions Options(string id, double duration) =>
            new EffectOptions(id, size, color, speed, duration, 42, RuntimeMs);
        private string NextId() => "preview-" + ++sequence;
        public void PlayWave()
        {
            Initialize();
            player.PlayWave(Options(NextId(), 1600), stage.transform);
        }
        public void PlayDissolve()
        {
            ResetPreview();
            player.PlayDissolve(Options(NextId(), 1400), Model,
                Resources.Load<Shader>("VisualEffects/VisualDissolve")).Completed += () => Model.enabled = false;
        }
        public void BeginHand()
        {
            Initialize();
            if (handId != null) return;
            handId = NextId();
            player.BeginHandGlow(Options(handId, 350));
        }
        public void EndHand()
        {
            if (handId == null) return;
            player.EndHandGlow(handId, RuntimeMs);
            handId = null;
        }
        public void ResetPreview()
        {
            Initialize();
            player.Dispose();
            player = new VisualEffectPlayer();
            handId = null;
            Model.enabled = true;
        }
        public void Advance(double deltaMs)
        {
            if (double.IsNaN(deltaMs) || double.IsInfinity(deltaMs) || deltaMs < 0) throw new ArgumentOutOfRangeException(nameof(deltaMs));
            Initialize();
            if (Paused || deltaMs == 0) return;
            RuntimeMs += deltaMs;
            if (handId != null)
            {
                var angle = (float)(RuntimeMs / 500);
                var point = new Vector3(Mathf.Cos(angle), 1 + Mathf.Sin(angle) * 0.5f, -0.5f);
                player.UpdatePose(handId, stage.transform.TransformPoint(point), RuntimeMs);
            }
            player.Evaluate(RuntimeMs);
        }
        private void Update() => Advance(Time.unscaledDeltaTime * 1000);
        private void TryGesture(VisualGesture kind)
        {
            var recognizer = new VisualGestureRecognizer(recognition);
            Vector3 initial = kind == VisualGesture.Circle ? new Vector3(0.2f, 0, 0) : Vector3.zero;
            recognizer.Begin(kind, GestureHand.Right, new GestureSample(0, initial, Vector3.zero, Vector3.forward, true));
            GestureRecognition result = null;
            if (kind == VisualGesture.Throw)
            {
                recognizer.Update(new GestureSample(0.1, new Vector3(0.25f, 0, -0.2f), Vector3.zero, Vector3.forward, true));
                result = recognizer.Update(new GestureSample(0.2, new Vector3(0.25f, 0, 0.2f), Vector3.zero, Vector3.forward, true));
            }
            else for (var i = 1; i <= 48 && result == null; i++)
            {
                float angle = i * Mathf.PI * 2 / 48;
                result = recognizer.Update(new GestureSample(i / 48.0,
                    new Vector3(Mathf.Cos(angle), Mathf.Sin(angle), 0) * 0.2f, Vector3.zero, Vector3.forward, true));
            }
            status = result == null ? "Synthetic gesture rejected with current settings." : "Synthetic gesture recognized: " + result.Kind;
            if (result != null) PlayWave();
        }
        private void OnGUI()
        {
            GUILayout.BeginArea(new Rect(16, 16, 360, 450), GUI.skin.box);
            GUILayout.Label("Visual Effects Preview (offline)");
            GUILayout.Label("Size: " + size.ToString("F2")); size = GUILayout.HorizontalSlider(size, 0.25f, 2);
            GUILayout.Label("Speed: " + speed.ToString("F2")); speed = GUILayout.HorizontalSlider(speed, 0.25f, 3);
            GUILayout.Label("Color (RGB)");
            color.r = GUILayout.HorizontalSlider(color.r, 0, 1);
            color.g = GUILayout.HorizontalSlider(color.g, 0, 1);
            color.b = GUILayout.HorizontalSlider(color.b, 0, 1);
            if (GUILayout.Button("Wave")) PlayWave();
            if (GUILayout.Button("Dissolve model")) PlayDissolve();
            if (GUILayout.Button("Begin hand glow (demo orbit)")) BeginHand();
            if (GUILayout.Button("End hand glow")) EndHand();
            if (GUILayout.Button(Paused ? "Resume" : "Pause")) Paused = !Paused;
            if (GUILayout.Button("Reset / cancel all")) ResetPreview();
            if (GUILayout.Button("Test throw (synthetic)")) TryGesture(VisualGesture.Throw);
            if (GUILayout.Button("Test circle (synthetic)")) TryGesture(VisualGesture.Circle);
            GUILayout.Label(status);
            GUILayout.EndArea();
        }
        private void OnDisable() => ReleasePreview();
        public void ReleasePreview()
        {
            player?.Dispose();
            player = null;
            handId = null;
            if (stage) { if (Application.isPlaying) Destroy(stage); else DestroyImmediate(stage); }
            stage = null;
            Model = null;
            if (modelMaterial) { if (Application.isPlaying) Destroy(modelMaterial); else DestroyImmediate(modelMaterial); }
        }
    }
}

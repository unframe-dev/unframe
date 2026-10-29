using System;
using Unframe.Presentation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;
using Vector2 = UnityEngine.Vector2;
using Vector3 = UnityEngine.Vector3;

namespace Unframe.Unity.PresentationRuntime.Editor
{
    public sealed class QuestMotionGuidePreview : IDisposable
    {
        private QuestMotionGuideVisuals visuals;
        private bool disposed;
        public Scene Scene { get; private set; }
        public GameObject Root { get; private set; }
        public Camera Camera { get; private set; }
        public RenderTexture Target { get; private set; }

        public QuestMotionGuidePreview()
        {
            try
            {
                Scene = EditorSceneManager.NewPreviewScene();
                Root = new GameObject("Motion guide preview") { hideFlags = HideFlags.HideAndDontSave };
                SceneManager.MoveGameObjectToScene(Root, Scene);
                var cameraHost = new GameObject("Motion guide preview camera") { hideFlags = HideFlags.HideAndDontSave };
                SceneManager.MoveGameObjectToScene(cameraHost, Scene);
                Camera = cameraHost.AddComponent<Camera>();
                Camera.enabled = false;
                Camera.scene = Scene;
                Camera.clearFlags = CameraClearFlags.SolidColor;
                Camera.backgroundColor = QuestUiTheme.Surface;
                Camera.fieldOfView = 65;
                Camera.aspect = 4f / 3;
                Camera.nearClipPlane = .03f;
                Camera.farClipPlane = 10;
                Camera.stereoTargetEye = StereoTargetEyeMask.None;
                Target = new RenderTexture(1200, 900, 24, RenderTextureFormat.ARGB32)
                {
                    name = "Motion guide preview target",
                    hideFlags = HideFlags.HideAndDontSave,
                };
                Target.Create();
                visuals = new QuestMotionGuideVisuals(Root.transform);
                visuals.Root.GetComponentInChildren<Canvas>(true).worldCamera = Camera;
                Update(1, true, .2f);
            }
            catch { Dispose(); throw; }
        }

        public void Update(int preset, bool leftHand, float phase, bool detailed = true)
        {
            if (disposed) throw new ObjectDisposedException(nameof(QuestMotionGuidePreview));
            if (preset < 1 || preset > 8) throw new ArgumentOutOfRangeException(nameof(preset));
            visuals.Render((GestureKind)preset, 0, 1, new Vector3(0, -.15f, 1.25f), Vector3.forward, Vector3.right, leftHand, phase, detailed);
        }

        public void Render()
        {
            if (disposed) throw new ObjectDisposedException(nameof(QuestMotionGuidePreview));
            Canvas.ForceUpdateCanvases();
            if (GraphicsSettings.currentRenderPipeline != null)
                RenderPipeline.SubmitRenderRequest(Camera, new UniversalRenderPipeline.SingleCameraRequest { destination = Target });
            else
            {
                Camera.targetTexture = Target;
                try { Camera.Render(); }
                finally { Camera.targetTexture = null; }
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            visuals?.Dispose();
            visuals = null;
            if (Camera != null) Object.DestroyImmediate(Camera.gameObject);
            if (Root != null) Object.DestroyImmediate(Root);
            if (Target != null) { Target.Release(); Object.DestroyImmediate(Target); }
            if (Scene.IsValid()) EditorSceneManager.ClosePreviewScene(Scene);
            Root = null; Camera = null; Target = null;
        }
    }

    public sealed class QuestMotionGuidePreviewWindow : EditorWindow
    {
        private static readonly string[] Presets = { "左へ動かす", "右へ動かす", "下へ動かす", "上へ動かす", "前へ押す", "手前へ引く", "両手を広げる", "両手を寄せる" };
        private QuestMotionGuidePreview preview;
        private int preset;
        private int hand;
        private bool animate = true;
        private bool detailed = true;
        private float phase = .2f;
        private double lastUpdate;
        private string error;
        private Vector2 scroll;

        [MenuItem("Unframe/Presentation/Preview Motion Guide")]
        public static void Open()
        {
            var window = GetWindow<QuestMotionGuidePreviewWindow>("動作ガイド");
            window.minSize = new Vector2(540, 540);
            window.Show();
        }

        private void OnEnable()
        {
            lastUpdate = EditorApplication.timeSinceStartup;
            EditorApplication.update += Tick;
        }

        private void OnDisable()
        {
            EditorApplication.update -= Tick;
            preview?.Dispose();
            preview = null;
        }

        private void Tick()
        {
            double now = EditorApplication.timeSinceStartup;
            if (animate) phase = Mathf.Repeat(phase + (float)(now - lastUpdate) * .65f, 1);
            lastUpdate = now;
            if (animate) Repaint();
        }

        private void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            EditorGUILayout.LabelField("直方体の腕モデル・操作説明", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Play・Quest・マーカー・サーバー接続は不要です。実際のアプリと同じ描画処理で動作の見本を確認します。", MessageType.Info);
            preset = EditorGUILayout.Popup("動作", preset, Presets);
            using (new EditorGUI.DisabledScope(preset >= 6))
                hand = EditorGUILayout.Popup("手", hand, new[] { "左手", "右手" });
            if (preset >= 6) EditorGUILayout.LabelField("この動作は両手で表示します。");
            detailed = EditorGUILayout.Toggle("詳しい操作説明", detailed);
            animate = EditorGUILayout.Toggle("アニメーション", animate);
            using (new EditorGUI.DisabledScope(animate))
                phase = EditorGUILayout.Slider("進行", phase, 0, 1);
            Rect area = GUILayoutUtility.GetAspectRect(4f / 3);
            if (Event.current.type == EventType.Repaint && error == null)
            {
                try
                {
                    if (preview == null) preview = new QuestMotionGuidePreview();
                    preview.Update(preset + 1, hand == 0, phase, detailed);
                    preview.Render();
                }
                catch (Exception exception)
                {
                    error = exception.Message;
                    preview?.Dispose(); preview = null;
                }
            }
            if (preview != null) GUI.DrawTexture(area, preview.Target, ScaleMode.ScaleToFit, false);
            if (error != null) EditorGUILayout.HelpBox(error, MessageType.Error);
            EditorGUILayout.LabelField("実際の案内と設定は Quest アプリのシーンで確認できます。", EditorStyles.wordWrappedLabel);
            if (GUILayout.Button("Quest の UI シーンを開く")) QuestPresentationSceneEditor.PrepareScene();
            EditorGUILayout.LabelField("正式プレゼン: nix run .#presentation-sample を起動してから Play Local Sample in Editor", EditorStyles.wordWrappedLabel);
            if (GUILayout.Button("ローカルサンプルを再生")) PresentationSamplePreviewMenu.PlayLocalSample();
            EditorGUILayout.EndScrollView();
        }
    }
}

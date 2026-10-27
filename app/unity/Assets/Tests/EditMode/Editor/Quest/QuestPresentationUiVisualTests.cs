using System;
using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;
using UnityEngine.UI;
using Object = UnityEngine.Object;

public sealed class QuestPresentationUiVisualTests
{
    [UnityTest]
    public IEnumerator JapaneseMenuRendersReadableLabelsAndContainsEveryVisibleControl()
    {
        yield return new EnterPlayMode();
        var originalScene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
        RenderPipelineAsset originalDefault = GraphicsSettings.defaultRenderPipeline;
        RenderPipelineAsset originalQuality = QualitySettings.renderPipeline;
        RenderTexture originalActive = RenderTexture.active;
        var scene = UnityEngine.SceneManagement.SceneManager.CreateScene("Quest UI verification");
        UnityEngine.SceneManagement.SceneManager.SetActiveScene(scene);
        GameObject host = null;
        GameObject cameraHost = null;
        RenderTexture target = null;
        Texture2D pixels = null;
        try
        {
            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/PC_RPAsset.asset");
            Assert.That(pipeline, Is.Not.Null, "The production URP pipeline is required for a representative UI render.");
            GraphicsSettings.defaultRenderPipeline = pipeline;
            QualitySettings.renderPipeline = pipeline;
            cameraHost = new GameObject("Quest UI screenshot camera", typeof(Camera));
            UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(cameraHost, scene);
            Camera camera = cameraHost.GetComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.045f, .055f, .07f);
            camera.fieldOfView = 48;
            camera.aspect = 4f / 3;
            camera.nearClipPlane = .05f;
            camera.farClipPlane = 10;
            camera.stereoTargetEye = StereoTargetEyeMask.None;
            camera.cullingMask = 1 << 31;
            host = new GameObject("Quest production menu visual test");
            UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(host, scene);
            var view = host.AddComponent<QuestPresentationStatusView>();
            view.Configure(null, null, camera.transform);
            view.FindButton("Details").onClick.Invoke();
            view.Refresh();
            foreach (Transform child in host.GetComponentsInChildren<Transform>(true)) child.gameObject.layer = 31;
            Canvas.ForceUpdateCanvases();

            Font font = QuestPresentationUiFont.Load();
            const string japanese = "プレゼン操作準備再生次一時停止終了位置合わせ詳細接続資料見る";
            font.RequestCharactersInTexture(japanese, 42, FontStyle.Normal);
            foreach (char character in japanese)
                Assert.That(font.HasCharacter(character), Is.True, "Missing Japanese glyph: " + character);
            Assert.That(view.Panel.transform.Find("Details text").gameObject.activeSelf, Is.True);
            Assert.That(view.Panel.GetComponentsInChildren<Text>().All(text => text.font == font), Is.True);
            foreach (Button button in view.Panel.GetComponentsInChildren<Button>())
            {
                var corners = new Vector3[4];
                button.GetComponent<RectTransform>().GetWorldCorners(corners);
                foreach (Vector3 corner in corners)
                {
                    Vector3 viewport = camera.WorldToViewportPoint(corner);
                    Assert.That(viewport.z, Is.GreaterThan(camera.nearClipPlane), button.name);
                    Assert.That(viewport.x, Is.InRange(.02f, .98f), button.name + " is horizontally clipped.");
                    Assert.That(viewport.y, Is.InRange(.02f, .98f), button.name + " is vertically clipped.");
                }
            }

            for (int frame = 0; frame < 3; frame++) yield return null;
            Canvas.ForceUpdateCanvases();
            target = new RenderTexture(1600, 1200, 24, RenderTextureFormat.ARGB32);
            pixels = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
            target.Create();
            RenderPipeline.SubmitRenderRequest(camera,
                new UniversalRenderPipeline.SingleCameraRequest { destination = target });
            RenderTexture.active = target;
            pixels.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
            pixels.Apply();
            string screenshot = Environment.GetEnvironmentVariable("UNFRAME_QUEST_UI_SCREENSHOT");
            if (String.IsNullOrEmpty(screenshot))
                screenshot = Path.GetFullPath(Path.Combine(Application.dataPath, "../../..", ".unframe/quest-app/ui.png"));
            screenshot = Path.GetFullPath(screenshot);
            Directory.CreateDirectory(Path.GetDirectoryName(screenshot));
            File.WriteAllBytes(screenshot, pixels.EncodeToPNG());
            Color32[] colors = pixels.GetPixels32();
            int readablePixels = colors.Count(pixel => pixel.r < 90 && pixel.g < 90 && pixel.b < 110);
            Assert.That(readablePixels, Is.GreaterThan(4000), "The menu background rendered without readable labels.");
            var headingRect = view.Panel.transform.Find("Heading").GetComponent<RectTransform>();
            var headingCorners = new Vector3[4];
            headingRect.GetWorldCorners(headingCorners);
            Vector3 lower = camera.WorldToViewportPoint(headingCorners[0]);
            Vector3 upper = camera.WorldToViewportPoint(headingCorners[2]);
            int headingPixels = 0;
            for (int y = Mathf.FloorToInt(lower.y * target.height); y < Mathf.CeilToInt(upper.y * target.height); y++)
                for (int x = Mathf.FloorToInt(lower.x * target.width); x < Mathf.CeilToInt(upper.x * target.width); x++)
                {
                    Color32 pixel = colors[y * target.width + x];
                    if (pixel.r < 90 && pixel.g < 90 && pixel.b < 110) headingPixels++;
                }
            Assert.That(headingPixels, Is.GreaterThan(300), "The Japanese heading did not produce visible glyphs.");

        }
        finally
        {
            RenderTexture.active = originalActive;
            if (target != null) { target.Release(); Object.DestroyImmediate(target); }
            if (pixels != null) Object.DestroyImmediate(pixels);
            if (host != null) Object.DestroyImmediate(host);
            if (cameraHost != null) Object.DestroyImmediate(cameraHost);
            GraphicsSettings.defaultRenderPipeline = originalDefault;
            QualitySettings.renderPipeline = originalQuality;
            if (originalScene.IsValid() && originalScene.isLoaded)
                UnityEngine.SceneManagement.SceneManager.SetActiveScene(originalScene);
            if (scene.IsValid() && scene.isLoaded) UnityEngine.SceneManagement.SceneManager.UnloadSceneAsync(scene);
        }
    }

    [UnityTearDown]
    public IEnumerator LeavePlayMode()
    {
        if (Application.isPlaying) yield return new ExitPlayMode();
    }
}

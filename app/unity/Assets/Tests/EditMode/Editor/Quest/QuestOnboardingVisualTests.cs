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

public sealed class QuestOnboardingVisualTests
{
    [UnityTest]
    public IEnumerator RoleSelectionAndPresenterPreviewRenderWithoutClippedControls()
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
            var view = host.AddComponent<QuestOnboardingView>();
            view.Configure(null, null, null, camera.transform, null);
            target = new RenderTexture(1600, 1200, 24, RenderTextureFormat.ARGB32);
            pixels = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
            target.Create();
            string directory = Environment.GetEnvironmentVariable("UNFRAME_ONBOARDING_SCREENSHOTS");
            if (String.IsNullOrEmpty(directory))
                directory = Path.GetFullPath(Path.Combine(Application.dataPath, "../../..", ".unframe/quest-app/onboarding"));
            Directory.CreateDirectory(directory);
            var expected = new[] { QuestOnboardingPage.Role, QuestOnboardingPage.Authentication,
                QuestOnboardingPage.Presentations, QuestOnboardingPage.Preparation,
                QuestOnboardingPage.Calibration, QuestOnboardingPage.Ready, QuestOnboardingPage.RoomCode };
            for (int screen = 0; screen < expected.Length; screen++)
            {
                Assert.That(view.Flow.Page, Is.EqualTo(expected[screen]));
                foreach (Transform child in host.GetComponentsInChildren<Transform>(true)) child.gameObject.layer = 31;
                for (int frame = 0; frame < 3; frame++) yield return null;
                Canvas.ForceUpdateCanvases();
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
                RenderPipeline.SubmitRenderRequest(camera,
                    new UniversalRenderPipeline.SingleCameraRequest { destination = target });
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
                pixels.Apply();
                File.WriteAllBytes(Path.Combine(directory, expected[screen] + ".png"), pixels.EncodeToPNG());
                var heading = view.Panel.transform.Find("Heading").GetComponent<RectTransform>();
                var headingCorners = new Vector3[4];
                heading.GetWorldCorners(headingCorners);
                Vector3 lower = camera.WorldToViewportPoint(headingCorners[0]);
                Vector3 upper = camera.WorldToViewportPoint(headingCorners[2]);
                Color32[] colors = pixels.GetPixels32();
                int headingPixels = 0;
                for (int y = Mathf.FloorToInt(lower.y * target.height); y < Mathf.CeilToInt(upper.y * target.height); y++)
                    for (int x = Mathf.FloorToInt(lower.x * target.width); x < Mathf.CeilToInt(upper.x * target.width); x++)
                    {
                        Color32 pixel = colors[y * target.width + x];
                        if (pixel.r < 100 && pixel.g < 100 && pixel.b < 130) headingPixels++;
                    }
                Assert.That(headingPixels, Is.GreaterThan(300), "The Japanese heading produced no visible glyphs: " + expected[screen]);
                if (screen == 0) Click(view, "Presenter");
                else if (screen < 5) Click(view, "DebugNext");
                else if (screen == 5) { Click(view, "Begin"); Click(view, "Audience"); }
            }
            Assert.That(view.Panel.GetComponentsInChildren<Button>().Any(button => button.name == "DebugNext"), Is.False,
                "Audience must not expose presenter debug progression.");

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

    private static void Click(QuestOnboardingView view, string name)
    {
        view.Panel.GetComponentsInChildren<Button>().Single(button => button.name == name).onClick.Invoke();
    }

    [UnityTearDown]
    public IEnumerator LeavePlayMode()
    {
        if (Application.isPlaying) yield return new ExitPlayMode();
    }
}

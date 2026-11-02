using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
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
        GameObject backdrop = null;
        Material backdropMaterial = null;
        Texture2D backdropTexture = null;
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
            int readablePixels = colors.Count(pixel => pixel.r < 100 && pixel.g < 100 && pixel.b < 130);
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
                    if (pixel.r < 100 && pixel.g < 100 && pixel.b < 130) headingPixels++;
                }
            Assert.That(headingPixels, Is.GreaterThan(300), "The Japanese heading did not produce visible glyphs.");
            string assistanceDirectory = Path.Combine(Path.GetDirectoryName(screenshot), "assistance");
            Directory.CreateDirectory(assistanceDirectory);
            view.FindButton("Details").onClick.Invoke();
            view.Refresh();
            Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "menu.png"));
            view.FindButton("Details").onClick.Invoke();
            view.Refresh();
            Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "settings.png"));
            view.enabled = false;
            camera.fieldOfView = 80;
            var guide = host.AddComponent<QuestMotionGuideView>();
            guide.enabled = false;
            var flags = BindingFlags.Instance | BindingFlags.NonPublic;
            typeof(QuestMotionGuideView).GetMethod("EnsureVisuals", flags).Invoke(guide, null);
            var visuals = (GameObject)typeof(QuestMotionGuideView).GetField("visuals", flags).GetValue(guide);
            Assert.That(visuals, Is.Not.Null);
            visuals.SetActive(true);
            var skins = visuals.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            Assert.That(skins.Length, Is.EqualTo(2), "The guide must render both imported arm models.");
            var instruction = visuals.GetComponentInChildren<Text>(true);
            Assert.That(instruction, Is.Not.Null);
            var instructionPanel = instruction.transform.parent;
            var animators = visuals.GetComponentsInChildren<Animator>(true);
            Assert.That(animators.Length, Is.EqualTo(2));
            for (int side = 0; side < animators.Length; side++)
            {
                animators[side].gameObject.SetActive(true);
                animators[side].enabled = false;
                Assert.That(animators[side].runtimeAnimatorController.animationClips.Length, Is.EqualTo(8));
            }
            var hud = host.AddComponent<QuestPresenterHudView>();
            hud.enabled = false;
            typeof(QuestPresenterHudView).GetMethod("EnsureVisuals", flags).Invoke(hud, null);
            var hudVisuals = (GameObject)typeof(QuestPresenterHudView).GetField("visuals", flags).GetValue(hud);
            hudVisuals.SetActive(true);
            Vector3 instructionScale = instructionPanel.localScale;
            Vector3 hudScale = hudVisuals.transform.localScale;
            Vector3[] armScales = animators.Select(animator => animator.transform.localScale).ToArray();
            void PlaceAssistance()
            {
                float scale = QuestMotionGuideGeometry.GetViewportScale(camera.fieldOfView, camera.aspect);
                Vector3 guideAnchor = QuestMotionGuideGeometry.GetAnchorPosition(camera.transform.position, camera.transform.rotation,
                    camera.fieldOfView, camera.aspect);
                Vector3 instructionPosition = QuestMotionGuideGeometry.GetInstructionPosition(guideAnchor, camera.transform.rotation);
                instructionPanel.localScale = instructionScale * scale;
                instructionPanel.SetPositionAndRotation(instructionPosition,
                    QuestMotionGuideGeometry.GetFacingRotation(instructionPosition, camera.transform.position, camera.transform.rotation));
                Vector3 hudPosition = QuestPresenterHudView.GetPosition(camera.transform.position, camera.transform.rotation,
                    camera.fieldOfView, camera.aspect);
                hudVisuals.transform.localScale = hudScale * scale;
                hudVisuals.transform.SetPositionAndRotation(hudPosition,
                    QuestMotionGuideGeometry.GetFacingRotation(hudPosition, camera.transform.position, camera.transform.rotation));
                for (int side = 0; side < animators.Length; side++)
                {
                    animators[side].transform.localScale = armScales[side] * scale;
                    animators[side].transform.SetPositionAndRotation(guideAnchor,
                        QuestMotionGuideGeometry.GetYawRotation(camera.transform.rotation));
                }
            }
            PlaceAssistance();
            var hudText = hudVisuals.GetComponentInChildren<Text>();
            hudText.text = "現在ページ: 1ページ目";
            var elapsedText = (Text)typeof(QuestPresenterHudView).GetField("elapsedLabel", flags).GetValue(hud);
            elapsedText.text = "経過時間: 01:23";
            Canvas.ForceUpdateCanvases();
            Assert.That(hudText.preferredHeight, Is.LessThanOrEqualTo(hudText.rectTransform.rect.height));
            Assert.That(elapsedText.preferredHeight, Is.LessThanOrEqualTo(elapsedText.rectTransform.rect.height));
            foreach (float fieldOfView in new[] { 48f, 80f, 95f })
            {
                camera.fieldOfView = fieldOfView;
                PlaceAssistance();
                AssertPanelVisible(camera, hudVisuals.GetComponent<RectTransform>(), "Presenter HUD");
                AssertPanelVisible(camera, (RectTransform)instructionPanel, "Motion instruction");
                Assert.That(Vector3.Distance(hudVisuals.transform.position, camera.transform.position), Is.EqualTo(.5f).Within(.0001f));
            }
            foreach (float fieldOfView in new[] { 48f, 80f, 95f })
            {
                camera.fieldOfView = fieldOfView;
                foreach (Unframe.Presentation.GestureKind gesture in Enum.GetValues(typeof(Unframe.Presentation.GestureKind)))
                {
                    if (gesture < Unframe.Presentation.GestureKind.SwipeLeft || gesture > Unframe.Presentation.GestureKind.CloseHands) continue;
                    foreach (float phase in new[] { 0f, .1f, .2f, .3f, .4f, .5f, .6f, .7f, .8f, .9f, 1f })
                    {
                        PlaceAssistance();
                        for (int side = 0; side < animators.Length; side++)
                        {
                            string clipName = (side == 0 ? "Left" : "Right") + gesture;
                            var clip = animators[side].runtimeAnimatorController.animationClips.Single(item => item.name == clipName);
                            clip.SampleAnimation(animators[side].gameObject, clip.length * phase);
                        }
                        foreach (SkinnedMeshRenderer skin in skins)
                            AssertArmMeshVisible(camera, skin, gesture, phase);
                    }
                }
            }
            camera.fieldOfView = 80;
            PlaceAssistance();
            foreach (Unframe.Presentation.GestureKind gesture in Enum.GetValues(typeof(Unframe.Presentation.GestureKind)))
            {
                if (gesture < Unframe.Presentation.GestureKind.SwipeLeft || gesture > Unframe.Presentation.GestureKind.CloseHands) continue;
                for (int side = 0; side < animators.Length; side++)
                {
                    string clipName = (side == 0 ? "Left" : "Right") + gesture;
                    var clip = animators[side].runtimeAnimatorController.animationClips.Single(item => item.name == clipName);
                    clip.SampleAnimation(animators[side].gameObject, clip.length * .4f);
                }
                instruction.text = (string)typeof(QuestMotionGuideView).GetMethod("Description", BindingFlags.Static | BindingFlags.NonPublic)
                    .Invoke(null, new object[] { (int)gesture });
                foreach (Transform child in host.GetComponentsInChildren<Transform>(true)) child.gameObject.layer = 31;
                Canvas.ForceUpdateCanvases();
                Assert.That(instruction.preferredHeight, Is.LessThanOrEqualTo(instruction.rectTransform.rect.height + 1),
                    gesture + " instruction is vertically clipped.");
                foreach (SkinnedMeshRenderer skin in skins)
                {
                    Assert.That(skin.sharedMesh, Is.Not.Null);
                    Assert.That(skin.bones.All(bone => bone != null), Is.True);
                }
                Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "guide-" + gesture + ".png"));
                if (gesture == Unframe.Presentation.GestureKind.SpreadHands)
                {
                    Color32[] withArms = pixels.GetPixels32();
                    foreach (SkinnedMeshRenderer skin in skins) skin.enabled = false;
                    Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "guide-label-reference.png"));
                    Color32[] reference = pixels.GetPixels32();
                    int glyphPixels = 0, visibleGlyphPixels = 0;
                    for (int i = 0; i < reference.Length; i++)
                    {
                        if (reference[i].r < 220 || reference[i].g < 220 || reference[i].b < 220) continue;
                        glyphPixels++;
                        if (withArms[i].r >= 210 && withArms[i].g >= 210 && withArms[i].b >= 210) visibleGlyphPixels++;
                    }
                    Assert.That(glyphPixels, Is.GreaterThan(100));
                    Assert.That(visibleGlyphPixels, Is.GreaterThanOrEqualTo(glyphPixels * .95f),
                        "The animated arms must not cover the instruction glyphs.");
                    foreach (SkinnedMeshRenderer skin in skins) skin.enabled = true;
                }
            }

            camera.backgroundColor = new Color(.95f, .97f, 1);
            Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "presenter-bright.png"));
            camera.backgroundColor = new Color(.045f, .055f, .07f);
            Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "presenter-dark.png"));
            backdrop = GameObject.CreatePrimitive(PrimitiveType.Quad);
            backdrop.name = "Presenter UI contrast backdrop";
            backdrop.layer = 31;
            backdrop.transform.SetPositionAndRotation(camera.transform.position + camera.transform.forward * 2, camera.transform.rotation);
            backdrop.transform.localScale = new Vector3(7, 5, 1);
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit");
            Assert.That(shader, Is.Not.Null);
            backdropMaterial = new Material(shader);
            backdropTexture = new Texture2D(128, 128, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point };
            var backdropPixels = new Color[128 * 128];
            for (int y = 0; y < 128; y++)
                for (int x = 0; x < 128; x++)
                    backdropPixels[y * 128 + x] = ((x / 8 + y / 8) % 2) == 0
                        ? new Color(.96f, .95f, .9f) : new Color(.12f, .17f, .23f);
            backdropTexture.SetPixels(backdropPixels);
            backdropTexture.Apply();
            backdropMaterial.SetTexture("_BaseMap", backdropTexture);
            backdrop.GetComponent<MeshRenderer>().sharedMaterial = backdropMaterial;
            Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "presenter-busy.png"));

            backdrop.SetActive(false);
            camera.transform.SetPositionAndRotation(new Vector3(1, 1.6f, -2), Quaternion.Euler(-10, 35, 8));
            PlaceAssistance();
            foreach (Transform panel in new[] { hudVisuals.transform, instructionPanel })
                Assert.That(Vector3.Dot(panel.forward, (panel.position - camera.transform.position).normalized), Is.GreaterThan(.999f));
            Capture(camera, target, pixels, Path.Combine(assistanceDirectory, "presenter-turned.png"));

        }
        finally
        {
            RenderTexture.active = originalActive;
            if (target != null) { target.Release(); Object.DestroyImmediate(target); }
            if (pixels != null) Object.DestroyImmediate(pixels);
            if (backdrop != null) Object.DestroyImmediate(backdrop);
            if (backdropMaterial != null) Object.DestroyImmediate(backdropMaterial);
            if (backdropTexture != null) Object.DestroyImmediate(backdropTexture);
            if (host != null) Object.DestroyImmediate(host);
            if (cameraHost != null) Object.DestroyImmediate(cameraHost);
            GraphicsSettings.defaultRenderPipeline = originalDefault;
            QualitySettings.renderPipeline = originalQuality;
            if (originalScene.IsValid() && originalScene.isLoaded)
                UnityEngine.SceneManagement.SceneManager.SetActiveScene(originalScene);
            if (scene.IsValid() && scene.isLoaded) UnityEngine.SceneManagement.SceneManager.UnloadSceneAsync(scene);
        }
    }

    private static void AssertArmMeshVisible(Camera camera, SkinnedMeshRenderer skin, Unframe.Presentation.GestureKind gesture, float phase)
    {
        var mesh = new Mesh();
        try
        {
            skin.BakeMesh(mesh);
            Assert.That(mesh.vertexCount, Is.GreaterThan(0));
            Vector3 minimum = Vector3.one * float.PositiveInfinity;
            Vector3 maximum = Vector3.one * float.NegativeInfinity;
            foreach (Vector3 vertex in mesh.vertices)
            {
                Vector3 viewport = camera.WorldToViewportPoint(skin.transform.TransformPoint(vertex));
                minimum = Vector3.Min(minimum, viewport);
                maximum = Vector3.Max(maximum, viewport);
            }
            string context = gesture + " " + skin.name + " phase " + phase + " FOV " + camera.fieldOfView;
            Assert.That(minimum.z, Is.GreaterThan(camera.nearClipPlane), context + " intersects the near clip plane.");
            Assert.That(minimum.x, Is.GreaterThanOrEqualTo(.02f), context + " is clipped at the left edge.");
            Assert.That(maximum.x, Is.LessThanOrEqualTo(.98f), context + " is clipped at the right edge.");
            Assert.That(minimum.y, Is.GreaterThanOrEqualTo(.02f), context + " is clipped at the lower edge.");
            Assert.That(maximum.y, Is.LessThanOrEqualTo(.98f), context + " is clipped at the upper edge.");
        }
        finally { Object.DestroyImmediate(mesh); }
    }

    private static void AssertPanelVisible(Camera camera, RectTransform panel, string name)
    {
        var corners = new Vector3[4];
        panel.GetWorldCorners(corners);
        foreach (Vector3 corner in corners)
        {
            Vector3 viewport = camera.WorldToViewportPoint(corner);
            Assert.That(viewport.z, Is.GreaterThan(camera.nearClipPlane), name);
            Assert.That(viewport.x, Is.InRange(.02f, .98f), name + " is horizontally clipped at FOV " + camera.fieldOfView);
            Assert.That(viewport.y, Is.InRange(.02f, .98f), name + " is vertically clipped at FOV " + camera.fieldOfView);
        }
        Vector3 center = camera.WorldToViewportPoint(panel.position);
        Assert.That(center.y, Is.LessThan(.4f), name + " occupies the central sightline.");
    }

    private static void Capture(Camera camera, RenderTexture target, Texture2D pixels, string path)
    {
        Canvas.ForceUpdateCanvases();
        RenderPipeline.SubmitRenderRequest(camera,
            new UniversalRenderPipeline.SingleCameraRequest { destination = target });
        RenderTexture.active = target;
        pixels.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
        pixels.Apply();
        File.WriteAllBytes(path, pixels.EncodeToPNG());
    }

    [UnityTearDown]
    public IEnumerator LeavePlayMode()
    {
        if (Application.isPlaying) yield return new ExitPlayMode();
    }
}

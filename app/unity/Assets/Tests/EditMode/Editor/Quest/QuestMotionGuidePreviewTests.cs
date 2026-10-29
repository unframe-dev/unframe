using NUnit.Framework;
using Unframe.Unity.PresentationRuntime.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

public sealed class QuestMotionGuidePreviewTests
{
    private RenderPipelineAsset originalDefault;
    private RenderPipelineAsset originalQuality;

    [SetUp]
    public void UseTheApplicationRenderPipeline()
    {
        originalDefault = GraphicsSettings.defaultRenderPipeline;
        originalQuality = QualitySettings.renderPipeline;
        var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/PC_RPAsset.asset");
        Assert.That(pipeline, Is.Not.Null);
        GraphicsSettings.defaultRenderPipeline = pipeline;
        QualitySettings.renderPipeline = pipeline;
    }

    [TearDown]
    public void RestoreRenderPipeline()
    {
        GraphicsSettings.defaultRenderPipeline = originalDefault;
        QualitySettings.renderPipeline = originalQuality;
    }

    [Test]
    public void PreviewRendersVisibleArmsAndInstructionsWithoutPlayMode()
    {
        using (var preview = new QuestMotionGuidePreview())
        {
            preview.Update(7, true, .5f);
            preview.Render();
            RenderTexture previous = RenderTexture.active;
            var pixels = new Texture2D(preview.Target.width, preview.Target.height, TextureFormat.RGBA32, false);
            try
            {
                RenderTexture.active = preview.Target;
                pixels.ReadPixels(new Rect(0, 0, pixels.width, pixels.height), 0, 0);
                pixels.Apply();
                int visible = 0;
                foreach (Color32 pixel in pixels.GetPixels32())
                    if (pixel.g > 150 && pixel.b > 110 && pixel.g > pixel.r * 1.3f) visible++;
                Assert.That(visible, Is.GreaterThan(1000), "Preview must contain accent-colored arm geometry, not only white instruction text.");
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "unframe-editor-motion-guide.png"), pixels.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                Object.DestroyImmediate(pixels);
            }
        }
    }

    [Test]
    public void PreviewIsIsolatedFromTheActiveSceneAndReleasesItsResources()
    {
        Scene active = SceneManager.GetActiveScene();
        int roots = active.rootCount;
        var preview = new QuestMotionGuidePreview();
        Scene scene = preview.Scene;
        GameObject host = preview.Root;
        Camera camera = preview.Camera;
        RenderTexture target = preview.Target;
        try
        {
            Assert.That(EditorSceneManager.IsPreviewScene(scene), Is.True);
            Assert.That(SceneManager.GetActiveScene(), Is.EqualTo(active));
            Assert.That(active.rootCount, Is.EqualTo(roots));
            Assert.That(camera.scene, Is.EqualTo(scene));
            Assert.That(camera.enabled, Is.False);
            Assert.That(target.IsCreated(), Is.True);
        }
        finally { preview.Dispose(); }
        Assert.That(scene.IsValid(), Is.False);
        Assert.That(host == null, Is.True);
        Assert.That(camera == null, Is.True);
        Assert.That(target == null, Is.True);
        Assert.DoesNotThrow(preview.Dispose);
    }

    [Test]
    public void PreviewUsesTheSameBriefAndDetailedInstructionsAsTheApplication()
    {
        using (var preview = new QuestMotionGuidePreview())
            foreach (bool detailed in new[] { false, true })
            {
                preview.Update(7, true, .4f, detailed);
                var labels = preview.Root.GetComponentsInChildren<UnityEngine.UI.Text>();
                Assert.That(labels[0].text, Is.EqualTo("両手を広げる"));
                Assert.That(labels[1].text, Does.Contain("X：操作・設定・退出"));
                Assert.That(labels[1].text.Contains("25cm"), Is.EqualTo(detailed));
            }
    }

    [Test]
    public void AllPresetsShowOnlyTheirSelectedArmsAndAnimateWithoutPlayMode()
    {
        using (var preview = new QuestMotionGuidePreview())
            for (int preset = 1; preset <= 8; preset++)
                for (int side = 0; side < 2; side++)
                {
                    bool left = side == 0;
                    preview.Update(preset, left, .2f);
                    Transform guide = preview.Root.transform.Find("Presenter motion guide");
                    Transform leftArm = guide.Find("Left demonstration arm");
                    Transform rightArm = guide.Find("Right demonstration arm");
                    Assert.That(leftArm.gameObject.activeSelf, Is.EqualTo(preset >= 7 || left));
                    Assert.That(rightArm.gameObject.activeSelf, Is.EqualTo(preset >= 7 || !left));
                    Transform wrist = (left ? leftArm : rightArm).Find("Hand");
                    Vector3 start = wrist.position;
                    preview.Update(preset, left, .75f);
                    Assert.That(Vector3.Distance(start, wrist.position), Is.GreaterThan(.01f));
                }
    }

}

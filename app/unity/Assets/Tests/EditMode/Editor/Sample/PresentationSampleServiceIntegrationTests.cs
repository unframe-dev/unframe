using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using Unframe.Unity.PresentationRuntime.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;

public sealed class PresentationSampleServiceIntegrationTests
{
    private PresentationSamplePreviewDriver driver;
    private GameObject host;

    [UnityTest]
    public IEnumerator CompiledReferenceUsesRealDeliveryAndRealtimeToRenderAndPause()
    {
        string connectionFile = Environment.GetEnvironmentVariable("UNFRAME_SAMPLE_CONNECTION_FILE");
        if (String.IsNullOrEmpty(connectionFile)) Assert.Ignore("A running presentation-sample service is required.");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        AssetDatabase.DeleteAsset("Assets/SampleIntegrationSettings");
        Directory.CreateDirectory("Assets/SampleIntegrationSettings");
        var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
        var pipeline = UniversalRenderPipelineAsset.Create(rendererData);
        AssetDatabase.CreateAsset(rendererData, "Assets/SampleIntegrationSettings/Renderer.asset");
        AssetDatabase.CreateAsset(pipeline, "Assets/SampleIntegrationSettings/Pipeline.asset");
        typeof(UniversalRenderPipelineAsset).Assembly.GetType("UnityEngine.Rendering.Universal.UniversalRenderPipelineGlobalSettings", true)
            .GetMethod("Ensure", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, new object[] { true });
        GraphicsSettings.defaultRenderPipeline = pipeline;
        QualitySettings.renderPipeline = pipeline;
        AssetDatabase.SaveAssets();
        yield return new EnterPlayMode();
        yield return VerifyLiveService();
    }

    private IEnumerator VerifyLiveService()
    {
        string connectionFile = Environment.GetEnvironmentVariable("UNFRAME_SAMPLE_CONNECTION_FILE");
        var settings = PresentationSampleConnectionSettings.Load(connectionFile, DateTimeOffset.UtcNow);
        host = new GameObject("Sample service integration");
        driver = host.AddComponent<PresentationSamplePreviewDriver>();
        driver.StartPreview(settings);
        float deadline = Time.realtimeSinceStartup + 90;
        while ((driver.Runtime == null || !driver.Runtime.SessionReady)
            && String.IsNullOrEmpty(driver.ErrorCode) && Time.realtimeSinceStartup < deadline) yield return null;
        Assert.That(driver.ErrorCode, Is.Null.Or.Empty, "Sample connection failed; inspect private service logs.");
        Assert.That(driver.Runtime, Is.Not.Null);
        Assert.That(driver.Runtime.SessionReady, Is.True, "Sample did not synchronize before the deadline.");
        var runtime = driver.Runtime;
        Assert.That(runtime.Delivery.Publication.PresentationId, Is.EqualTo("reference-presentation"));
        Assert.That(runtime.DownloadReady && runtime.ResidentReady && runtime.CalibrationReady, Is.True);
        Assert.That(driver.ConnectionStage, Is.EqualTo(PresentationConnectionStage.Ready));
        Assert.That(runtime.TryGetLastConnectionSnapshot(out var snapshot), Is.True);
        Assert.That(snapshot.Fence.Publication, Is.EqualTo(runtime.Delivery.Publication));
        Assert.That(runtime.PlaybackStatus, Is.EqualTo("Running"));
        Assert.That(runtime.PresentationSpace.GetComponentsInChildren<MeshRenderer>().Count(r => r.enabled), Is.GreaterThan(0));

        for (int frame = 0; frame < 3; frame++) yield return null;
        Assert.That(driver.PreviewCamera, Is.Not.Null);
        string screenshot = Environment.GetEnvironmentVariable("UNFRAME_SAMPLE_SCREENSHOT");
        var target = new RenderTexture(960, 540, 24, RenderTextureFormat.ARGB32);
        var pixels = new Texture2D(960, 540, TextureFormat.RGBA32, false);
        RenderTexture previous = RenderTexture.active;
        try
        {
            target.Create();
            RenderPipeline.SubmitRenderRequest(driver.PreviewCamera,
                new UniversalRenderPipeline.SingleCameraRequest { destination = target });
            RenderTexture.active = target;
            pixels.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
            pixels.Apply();
            int visiblePixels = pixels.GetPixels32().Count(p => p.r > 50 || p.g > 50 || p.b > 50);
            Assert.That(visiblePixels, Is.GreaterThan(1000), "Sample surfaces did not produce visible pixels.");
            int cardPixels = pixels.GetPixels32().Count(p => p.b > 120 && p.b > p.r + 40 && p.b > p.g + 40);
            Assert.That(cardPixels, Is.GreaterThan(50), "Foreground card partitions were hidden by the background.");
            if (!String.IsNullOrEmpty(screenshot))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(screenshot));
                File.WriteAllBytes(screenshot, pixels.EncodeToPNG());
            }
        }
        finally
        {
            RenderTexture.active = previous;
            target.Release();
            UnityEngine.Object.Destroy(target);
            UnityEngine.Object.Destroy(pixels);
        }

        Task pause = runtime.SendAsync(QuestPresentationInput.CreateControl(RuntimeControlKind.Pause,
            runtime.PresentationOriginVersion, runtime.InputSynchronization.CommandEpoch), default);
        while (!pause.IsCompleted) yield return null;
        Assert.That(pause.IsFaulted, Is.False);
        deadline = Time.realtimeSinceStartup + 10;
        while ((runtime.PlaybackStatus != "Paused" || runtime.LastCommandOutcomeCode != "accepted")
            && Time.realtimeSinceStartup < deadline) yield return null;
        Assert.That(runtime.PlaybackStatus, Is.EqualTo("Paused"));
        Assert.That(runtime.LastCommandOutcomeCode, Is.EqualTo("accepted"));

        Task resume = runtime.SendAsync(QuestPresentationInput.CreateControl(RuntimeControlKind.Resume,
            runtime.PresentationOriginVersion, runtime.InputSynchronization.CommandEpoch), default);
        while (!resume.IsCompleted) yield return null;
        Assert.That(resume.IsFaulted, Is.False);
        deadline = Time.realtimeSinceStartup + 10;
        while ((runtime.PlaybackStatus != "Running" || !runtime.CanSendInput)
            && Time.realtimeSinceStartup < deadline) yield return null;
        Assert.That(runtime.PlaybackStatus, Is.EqualTo("Running"));
        Assert.That(runtime.CanSendInput, Is.True, "Input did not resume after the fresh state keyframe.");
        yield return null;
        yield return null;
        var buttonSurface = runtime.Delivery.ProjectionProfile.RenderSurfaces.OrderByDescending(s => s.Layer).First();
        var button = runtime.PresentationSpace.GetComponentsInChildren<MeshRenderer>().Single(r => r.name == buttonSurface.RenderSurfaceId);
        var ray = new Ray(driver.PreviewCamera.transform.position, button.transform.position - driver.PreviewCamera.transform.position);
        Assert.That(runtime.TryPickInteraction(ray, out string surfaceId, out string interactionId), Is.True);
        var properties = new MaterialPropertyBlock();
        button.GetPropertyBlock(properties);
        Texture beforeInteraction = properties.GetTexture("_FromTex");
        Task interaction = runtime.SendAsync(QuestPresentationInput.CreateSurfaceInteraction(surfaceId, interactionId,
            runtime.PresentationOriginVersion, runtime.InputSynchronization.Context, runtime.InputSynchronization.CommandEpoch), default);
        while (!interaction.IsCompleted) yield return null;
        Assert.That(interaction.IsFaulted, Is.False);
        deadline = Time.realtimeSinceStartup + 10;
        while (Time.realtimeSinceStartup < deadline)
        {
            button.GetPropertyBlock(properties);
            if (runtime.LastCommandOutcomeCode == "accepted" && properties.GetTexture("_FromTex") != beforeInteraction) break;
            yield return null;
        }
        Assert.That(runtime.LastCommandOutcomeCode, Is.EqualTo("accepted"));
        Assert.That(properties.GetTexture("_FromTex"), Is.Not.SameAs(beforeInteraction), "Continue did not update the rendered state.");
    }

    [UnityTearDown]
    public IEnumerator ReleasePreview()
    {
        if (driver != null)
        {
            Task stop = driver.StopAsync();
            float deadline = Time.realtimeSinceStartup + 10;
            while (!stop.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.That(stop.IsCompleted, Is.True, "Sample preview did not stop after cancellation.");
        }
        if (host != null) UnityEngine.Object.Destroy(host);
        if (Application.isPlaying) yield return new ExitPlayMode();
        GraphicsSettings.defaultRenderPipeline = null;
        QualitySettings.renderPipeline = null;
        AssetDatabase.DeleteAsset("Assets/SampleIntegrationSettings");
    }
}

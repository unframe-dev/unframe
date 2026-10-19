using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class ModelSpikeEditor
{
    static void Configure()
    {
        var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/SpikePipeline.asset");
        if (pipeline == null)
        {
            var renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
            AssetDatabase.CreateAsset(renderer, "Assets/SpikeRenderer.asset");
            pipeline = UniversalRenderPipelineAsset.Create(renderer);
            AssetDatabase.CreateAsset(pipeline, "Assets/SpikePipeline.asset");
        }
        var shader = Shader.Find("Shader Graphs/glTF-pbrMetallicRoughness");
        ModelSpike.Check(shader != null, "runtime shader available for build inclusion");
        if (AssetDatabase.LoadAssetAtPath<Material>("Assets/Resources/SpikeMaterial.mat") == null)
            AssetDatabase.CreateAsset(new Material(shader), "Assets/Resources/SpikeMaterial.mat");
        if (AssetDatabase.LoadAssetAtPath<Material>("Assets/Resources/SpikeTransparent.mat") == null)
        {
            var transparent = new Material(shader);
            transparent.SetFloat("_Surface", 1);
            transparent.SetFloat("_SrcBlend", (int)BlendMode.SrcAlpha);
            transparent.SetFloat("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
            transparent.SetFloat("_ZWrite", 0);
            transparent.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            transparent.renderQueue = (int)RenderQueue.Transparent;
            AssetDatabase.CreateAsset(transparent, "Assets/Resources/SpikeTransparent.mat");
        }
        GraphicsSettings.defaultRenderPipeline = pipeline;
        QualitySettings.renderPipeline = pipeline;
        AssetDatabase.SaveAssets();
    }

    public static async void Probe()
    {
        try
        {
            Configure();
            Debug.Log("MODEL_SPIKE_ENV Unity=" + Application.unityVersion + " platform=" + Application.platform + " graphics=" + SystemInfo.graphicsDeviceType);
            await ModelSpike.Run();
            Debug.Log("MODEL_SPIKE_ALL_PASS");
            EditorApplication.Exit(0);
        }
        catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
    }

    public static void Build()
    {
        Configure();
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("Spike").AddComponent<ModelSpike>();
        EditorSceneManager.SaveScene(scene, "Assets/Spike.unity");
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        var output = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "../../webgl"));
        var report = BuildPipeline.BuildPlayer(new[] { "Assets/Spike.unity" }, output, BuildTarget.WebGL, BuildOptions.Development);
        ModelSpike.Check(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded, "WebGL build");
    }
}

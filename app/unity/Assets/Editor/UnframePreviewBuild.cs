using System;
using System.IO;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class UnframePreviewBuild
{
    public static void Build()
    {
        if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL))
            throw new InvalidOperationException("Unity WebGL Build Support is required.");
        const string scenePath = "Assets/Scenes/UnframePreview.unity";
        Directory.CreateDirectory("Assets/Scenes");
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("UnframePreview").AddComponent<UnframePreview>();
        var cameraObject = new GameObject("Preview Camera");
        cameraObject.tag = "MainCamera";
        Camera camera = cameraObject.AddComponent<Camera>();
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.035f, 0.045f, 0.065f, 1);
        camera.nearClipPlane = 0.01f;
        camera.farClipPlane = 20000;
        cameraObject.AddComponent<PresentationPreviewCamera>().Frame(null);
        var renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
        var pipeline = UniversalRenderPipelineAsset.Create(renderer);
        Directory.CreateDirectory("Assets/PreviewSettings");
        AssetDatabase.DeleteAsset("Assets/PreviewSettings/PreviewRenderer.asset");
        AssetDatabase.DeleteAsset("Assets/PreviewSettings/PreviewPipeline.asset");
        AssetDatabase.CreateAsset(renderer, "Assets/PreviewSettings/PreviewRenderer.asset");
        AssetDatabase.CreateAsset(pipeline, "Assets/PreviewSettings/PreviewPipeline.asset");
        GraphicsSettings.defaultRenderPipeline = pipeline;
        QualitySettings.renderPipeline = pipeline;
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.nameFilesAsHashes = false;
        PlayerSettings.companyName = "Unframe";
        PlayerSettings.productName = "UnframePreview";
        EditorSceneManager.SaveScene(scene, scenePath);
        string output = null;
        string[] arguments = Environment.GetCommandLineArgs();
        for (int i = 0; i + 1 < arguments.Length; i++)
            if (arguments[i] == "-unframePreviewOutput") output = arguments[i + 1];
        if (String.IsNullOrEmpty(output)) output = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Builds", "UnframePreview");
        BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { scenePath },
            locationPathName = output,
            target = BuildTarget.WebGL,
            options = BuildOptions.None,
        });
        if (report.summary.result != BuildResult.Succeeded)
            throw new InvalidOperationException("Preview WebGL build failed: " + report.summary.result);
    }
}

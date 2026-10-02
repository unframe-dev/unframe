using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class UnframeWebPreviewBuild
{
    public static Scene CreatePreviewScene()
    {
        Scene original = SceneManager.GetActiveScene();
        if (string.IsNullOrEmpty(original.path))
            throw new InvalidOperationException("Save the active scene before creating the preview scene.");
        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
        try
        {
            SceneManager.SetActiveScene(scene);
            GameObject cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.025f, 0.035f, 0.06f, 1f);
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 1000f;
            new GameObject("PreviewBridge").AddComponent<PreviewBridge>();
            return scene;
        }
        catch
        {
            EditorSceneManager.CloseScene(scene, true);
            throw;
        }
        finally
        {
            if (original.IsValid()) SceneManager.SetActiveScene(original);
        }
    }

    public static void Build()
    {
        if (!Application.isBatchMode)
            throw new InvalidOperationException("Web preview builds must run in batch mode.");
        if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL)
            throw new InvalidOperationException("Start Unity with -buildTarget WebGL.");
        string projectPath = Directory.GetParent(Application.dataPath).FullName;
        string outputPath = Path.Combine(projectPath, "Builds", "WebPreview");
        string temporaryScene = $"Assets/PreviewBuild_{Guid.NewGuid():N}.unity";
        string baselineScene = $"Assets/PreviewBaseline_{Guid.NewGuid():N}.unity";
        WebGLCompressionFormat compression = PlayerSettings.WebGL.compressionFormat;
        string template = PlayerSettings.WebGL.template;
        Scene scene = default;
        bool succeeded = false;
        try
        {
            Scene baseline = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            if (!EditorSceneManager.SaveScene(baseline, baselineScene))
                throw new InvalidOperationException("Could not save preview baseline scene.");
            scene = CreatePreviewScene();
            if (!EditorSceneManager.SaveScene(scene, temporaryScene))
                throw new InvalidOperationException("Could not save preview scene.");
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.template = "PROJECT:UnframePreview";
            if (Directory.Exists(outputPath)) Directory.Delete(outputPath, true);
            Directory.CreateDirectory(outputPath);
            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { temporaryScene },
                locationPathName = outputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            });
            if (report == null || report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException($"WebGL build failed: {report?.summary.result.ToString() ?? "no report"}.");
            Debug.Log($"Preview built at {outputPath}");
            succeeded = true;
        }
        finally
        {
            PlayerSettings.WebGL.compressionFormat = compression;
            PlayerSettings.WebGL.template = template;
            if (scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true);
            AssetDatabase.DeleteAsset(temporaryScene);
            AssetDatabase.DeleteAsset(baselineScene);
            if (!succeeded && Directory.Exists(outputPath)) Directory.Delete(outputPath, true);
        }
    }
}

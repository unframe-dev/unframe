using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class VideoSpikeBuild
{
    public static void Build()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("VideoSpike").AddComponent<VideoSpike>();
        var camera = new GameObject("Camera").AddComponent<Camera>();
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = Color.black;
        EditorSceneManager.SaveScene(scene, "Assets/VideoSpike.unity");
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.nameFilesAsHashes = false;
        PlayerSettings.companyName = "Unframe";
        PlayerSettings.productName = "VideoSpike";
        PlayerSettings.WebGL.initialMemorySize = 64;
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { "Assets/VideoSpike.unity" },
            locationPathName = Path.GetFullPath("../player"),
            target = BuildTarget.WebGL,
            options = BuildOptions.None
        });
        if (report.summary.result != BuildResult.Succeeded) throw new Exception(report.summary.result.ToString());
    }
}

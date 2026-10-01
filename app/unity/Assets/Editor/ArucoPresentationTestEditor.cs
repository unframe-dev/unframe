using System;
using System.IO;
using System.Linq;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class ArucoPresentationTestEditor
{
    public const string ScenePath = "Assets/Scenes/ArucoPresentationTest.unity";
    public const string ApplicationId = "dev.unframe.pca.presentation";

    [MenuItem("Unframe/ArUco/Open Presentation Test Scene")]
    public static void PrepareScene()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            throw new OperationCanceledException("Presentation scene preparation was cancelled.");
        if (!File.Exists(ScenePath))
        {
            PassthroughCameraDeviceTestEditor.PrepareScene();
            var cameraScene = SceneManager.GetActiveScene();
            if (!EditorSceneManager.SaveScene(cameraScene, ScenePath, true))
                throw new IOException("Could not copy the PCA scene for the presentation test.");
        }
        var scene = EditorSceneManager.OpenScene(ScenePath);
        var alignment = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<ArucoOriginAlignment>(true)).Single();
        var runner = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<LocalPresentationFixtureRunner>(true)).SingleOrDefault();
        if (runner == null)
        {
            var controller = new GameObject("Marker Presentation Controller");
            runner = controller.AddComponent<LocalPresentationFixtureRunner>();
            var space = new GameObject("Presentation Space (device calibration)");
            space.SetActive(false);
            var stage = new GameObject("Stage (Runtime origin)");
            stage.transform.SetParent(space.transform, false);
            var binding = controller.AddComponent<ArucoPresentationOriginBinding>();
            binding.Configure(alignment, runner, space.transform, stage.transform);
        }
        var settings = new SerializedObject(runner);
        settings.FindProperty("startOnPlay").boolValue = true;
        settings.ApplyModifiedPropertiesWithoutUndo();
        EditorSceneManager.MarkSceneDirty(scene);
        if (!EditorSceneManager.SaveScene(scene)) throw new IOException("Could not save the presentation test scene.");
    }

    [MenuItem("Unframe/ArUco/Build Presentation Test APK")]
    public static void BuildApk()
    {
        PrepareScene();
        PassthroughCameraDeviceTestEditor.BuildScene(ScenePath, ApplicationId, "unframe-aruco-presentation.apk", false);
    }

    [MenuItem("Unframe/ArUco/Build and Run Presentation on Quest")]
    public static void BuildAndRun()
    {
        PrepareScene();
        PassthroughCameraDeviceTestEditor.BuildScene(ScenePath, ApplicationId, "unframe-aruco-presentation.apk", true);
    }
}

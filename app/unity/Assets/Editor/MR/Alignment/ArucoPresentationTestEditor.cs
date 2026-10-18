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
            QuestMrSceneBuild.CreateCalibrationScene(ScenePath);
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
            controller.AddComponent<ArucoPresentationOriginBinding>();
        }
        var binding = runner.GetComponent<ArucoPresentationOriginBinding>();
        if (binding == null) binding = runner.gameObject.AddComponent<ArucoPresentationOriginBinding>();
        var calibration = runner.GetComponent<ArucoPresentationCalibration>();
        if (calibration == null) calibration = runner.gameObject.AddComponent<ArucoPresentationCalibration>();
        var rig = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<OVRCameraRig>(true)).Single();
        calibration.Configure(alignment, rig.trackingSpace);
        var presentationSpace = scene.GetRootGameObjects().Single(root => root.name == "Presentation Space (device calibration)");
        var stageRoot = presentationSpace.transform.GetChild(0);
        binding.Configure(calibration, runner, presentationSpace.transform, stageRoot);
        var controls = runner.GetComponent<QuestLocalPresentationControls>();
        if (controls == null) controls = runner.gameObject.AddComponent<QuestLocalPresentationControls>();
        controls.Configure(calibration, runner);
        var preview = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Single();
        var previewSettings = new SerializedObject(preview);
        previewSettings.FindProperty("handleRemeasurementInput").boolValue = false;
        previewSettings.ApplyModifiedPropertiesWithoutUndo();
        var statusView = runner.GetComponent<QuestLocalPresentationStatusView>();
        if (statusView == null) statusView = runner.gameObject.AddComponent<QuestLocalPresentationStatusView>();
        statusView.Configure(controls, rig.centerEyeAnchor);
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
        QuestMrSceneBuild.BuildScene(ScenePath, ApplicationId, "unframe-aruco-presentation.apk", false);
    }

    [MenuItem("Unframe/ArUco/Build and Run Presentation on Quest")]
    public static void BuildAndRun()
    {
        PrepareScene();
        QuestMrSceneBuild.BuildScene(ScenePath, ApplicationId, "unframe-aruco-presentation.apk", true);
    }
}

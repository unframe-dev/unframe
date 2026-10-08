using System;
using System.IO;
using System.Linq;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class QuestPresentationUiSceneEditor
{
    public const string ScenePath = "Assets/Scenes/QuestPresentationUiPreview.unity";
    public const string ApplicationId = "dev.unframe.ui.preview";

    [MenuItem("Unframe/UI/Open Presentation UI Preview")]
    public static void PrepareScene()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            throw new OperationCanceledException("UI preview preparation was cancelled.");
        if (!File.Exists(ScenePath))
        {
            QuestMrSceneBuild.CreateCalibrationScene(ScenePath);
        }
        var scene = EditorSceneManager.OpenScene(ScenePath);
        var components = scene.GetRootGameObjects();
        var rig = components.SelectMany(root => root.GetComponentsInChildren<OVRCameraRig>(true)).Single();
        var preview = components.SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Single();
        var runner = components.SelectMany(root => root.GetComponentsInChildren<LocalPresentationFixtureRunner>(true)).SingleOrDefault();
        if (runner == null) runner = new GameObject("Marker Presentation Controller").AddComponent<LocalPresentationFixtureRunner>();
        var alignment = preview.GetComponent<ArucoOriginAlignment>();
        var binding = runner.GetComponent<ArucoPresentationOriginBinding>();
        if (binding == null) binding = runner.gameObject.AddComponent<ArucoPresentationOriginBinding>();
        var calibration = runner.GetComponent<ArucoPresentationCalibration>();
        if (calibration == null) calibration = runner.gameObject.AddComponent<ArucoPresentationCalibration>();
        calibration.Configure(alignment, rig.trackingSpace);
        var space = scene.GetRootGameObjects().SingleOrDefault(root => root.name == "Presentation Space (device calibration)");
        if (space == null)
        {
            space = new GameObject("Presentation Space (device calibration)");
            var stage = new GameObject("Stage (Runtime origin)");
            stage.transform.SetParent(space.transform, false);
        }
        space.SetActive(false);
        binding.Configure(calibration, runner, space.transform, space.transform.GetChild(0));
        var controls = runner.GetComponent<QuestLocalPresentationControls>();
        if (controls == null) controls = runner.gameObject.AddComponent<QuestLocalPresentationControls>();
        controls.Configure(calibration, runner);
        var motion = runner.GetComponent<QuestLocalArmMotionControls>();
        if (motion == null)
        {
            motion = runner.gameObject.AddComponent<QuestLocalArmMotionControls>();
            var presets = (ArmMotionPreset[])Enum.GetValues(typeof(ArmMotionPreset));
            var cues = Enumerable.Range(2, runner.ReliableEventCount - 1)
                .Select(number => new ArmMotionCue(number, presets[(number - 2) % presets.Length])).ToArray();
            motion.Configure(controls, runner, cues);
        }
        foreach (var status in components.SelectMany(root => root.GetComponentsInChildren<QuestLocalPresentationStatusView>(true)))
            UnityEngine.Object.DestroyImmediate(status);
        preview.DiagnosticUiVisible = false;
        preview.DiagnosticInputEnabled = false;
        preview.enabled = false;
        alignment.GetComponent<ArucoOriginVisualizer>().Visible = false;
        runner.KeyboardAdvanceEnabled = false;
        runner.enabled = false;
        controls.PresentationInputEnabled = false;
        binding.PresentationVisible = false;
        var settings = new SerializedObject(runner);
        settings.FindProperty("startOnPlay").boolValue = false;
        settings.ApplyModifiedPropertiesWithoutUndo();
        var controller = runner.GetComponent<QuestPresentationUiController>();
        if (controller == null) controller = runner.gameObject.AddComponent<QuestPresentationUiController>();
        var view = runner.GetComponent<QuestPresentationFlowView>();
        if (view == null) view = runner.gameObject.AddComponent<QuestPresentationFlowView>();
        controller.Configure(rig.centerEyeAnchor, rig.rightControllerAnchor, preview, alignment,
            calibration, runner, controls, binding);
        EditorSceneManager.MarkSceneDirty(scene);
        if (!EditorSceneManager.SaveScene(scene)) throw new IOException("Could not save UI preview scene.");
    }

    [MenuItem("Unframe/UI/Build Presentation UI Preview APK")]
    public static void BuildApk()
    {
        PrepareScene();
        QuestMrSceneBuild.BuildScene(ScenePath, ApplicationId, "unframe-presentation-ui-preview.apk", false);
    }

    [MenuItem("Unframe/UI/Build and Run UI Preview on Quest")]
    public static void BuildAndRun()
    {
        PrepareScene();
        QuestMrSceneBuild.BuildScene(ScenePath, ApplicationId, "unframe-presentation-ui-preview.apk", true);
    }
}

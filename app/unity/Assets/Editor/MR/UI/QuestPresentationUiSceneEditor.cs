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
        var delivery = Resources.Load<TextAsset>("MotionPresentation/LocalDelivery");
        var snapshot = Resources.Load<TextAsset>("MotionPresentation/LocalSnapshot");
        var events = Resources.LoadAll<TextAsset>("MotionPresentation/Control");
        var plan = Resources.Load<TextAsset>("MotionPresentation/LocalMotionPlan");
        if (delivery == null || snapshot == null || events.Length != 25 || plan == null)
            throw new InvalidOperationException("The generated rehearsal presentation fixtures are required.");
        Array.Sort(events, (left, right) => String.CompareOrdinal(left.name, right.name));
        runner.SetDeliveryFixture(delivery);
        runner.SetSnapshotFixture(snapshot);
        runner.SetReliableEventFixtures(events);
        var motion = runner.GetComponent<QuestLocalArmMotionControls>();
        if (motion == null) motion = runner.gameObject.AddComponent<QuestLocalArmMotionControls>();
        motion.ConfigurePlan(controls, runner, plan);
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
        var motionDebug = runner.GetComponent<QuestArmMotionDebugView>();
        if (motionDebug == null) motionDebug = runner.gameObject.AddComponent<QuestArmMotionDebugView>();
        motionDebug.Configure(rig.centerEyeAnchor, controller, motion);
        var debugSettings = new SerializedObject(motionDebug);
        debugSettings.FindProperty("diagnosticVisible").boolValue = false;
        debugSettings.ApplyModifiedPropertiesWithoutUndo();
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

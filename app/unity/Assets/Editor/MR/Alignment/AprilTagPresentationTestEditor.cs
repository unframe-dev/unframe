using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class AprilTagPresentationTestEditor
{
    public const string ScenePath = "Assets/Scenes/AprilTagPresentationTest.unity";
    public const string ApplicationId = "dev.unframe.pca.presentation";

    [MenuItem("Unframe/Diagnostics/AprilTag/Open Presentation Test Scene")]
    public static void PrepareScene()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            throw new OperationCanceledException("Presentation scene preparation was cancelled.");
        if (!File.Exists(ScenePath))
        {
            QuestMrSceneBuild.CreateCalibrationScene(ScenePath);
        }
        var scene = EditorSceneManager.OpenScene(ScenePath);
        var alignment = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<AprilTagOriginAlignment>(true)).Single();
        var calibration = scene.GetRootGameObjects()
            .SelectMany(root => root.GetComponentsInChildren<AprilTagPresentationCalibration>(true)).SingleOrDefault();
        if (calibration == null)
            calibration = new GameObject("Marker Presentation Calibration").AddComponent<AprilTagPresentationCalibration>();
        var rig = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<OVRCameraRig>(true)).Single();
        calibration.Configure(alignment, rig.trackingSpace);
        var preview = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Single();
        var previewSettings = new SerializedObject(preview);
        previewSettings.FindProperty("handleRemeasurementInput").boolValue = true;
        previewSettings.ApplyModifiedPropertiesWithoutUndo();
        EditorSceneManager.MarkSceneDirty(scene);
        if (!EditorSceneManager.SaveScene(scene)) throw new IOException("Could not save the presentation test scene.");
    }

    [MenuItem("Unframe/Diagnostics/AprilTag/Build Presentation Test APK")]
    public static void BuildApk()
    {
        PrepareScene();
        QuestMrSceneBuild.BuildScene(ScenePath, ApplicationId, "unframe-apriltag-presentation.apk", false);
    }

    [MenuItem("Unframe/Diagnostics/AprilTag/Build and Run Presentation on Quest")]
    public static void BuildAndRun()
    {
        PrepareScene();
        QuestMrSceneBuild.BuildScene(ScenePath, ApplicationId, "unframe-apriltag-presentation.apk", true);
    }
}

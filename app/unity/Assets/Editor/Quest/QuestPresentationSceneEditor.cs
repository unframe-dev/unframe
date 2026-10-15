using System;
using System.IO;
using System.Linq;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class QuestPresentationSceneEditor
{
    public const string ScenePath = "Assets/Scenes/QuestPresentationScene.unity";

    [MenuItem("Unframe/Open Quest Presentation Scene")]
    public static void PrepareScene()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            throw new OperationCanceledException("Quest presentation scene preparation was cancelled.");
        if (File.Exists(ScenePath))
        {
            var existing = EditorSceneManager.OpenScene(ScenePath);
            if (existing.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<QuestPresentationSession>(true)).Any())
            {
                ConfigurePreviewInput(existing);
                if (!EditorSceneManager.SaveScene(existing, ScenePath))
                    throw new IOException("Could not save the Quest presentation scene.");
                return;
            }
        }
        QuestMrSceneBuild.CreateCalibrationScene(ScenePath);
        Scene scene = SceneManager.GetActiveScene();
        var roots = scene.GetRootGameObjects();
        var rig = roots.SelectMany(root => root.GetComponentsInChildren<OVRCameraRig>(true)).Single();
        var preview = roots.SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Single();
        ConfigurePreviewInput(scene);

        var host = new GameObject("Quest Presentation Session");
        var runtime = host.AddComponent<PresentationBakedRuntime>();
        host.AddComponent<QuestBodyTrackingSource>();
        var calibration = host.AddComponent<ArucoPresentationCalibration>();
        calibration.Configure(preview.GetComponent<ArucoOriginAlignment>(), rig.trackingSpace);
        var entry = host.AddComponent<QuestPresentationEntry>();
        SetReference(entry, "runtime", runtime);
        SetReference(entry, "questTrackingOrigin", rig.trackingSpace);
        var session = host.AddComponent<QuestPresentationSession>();
        SetReference(session, "entry", entry);
        SetReference(session, "calibrationSource", calibration);
        var status = host.AddComponent<QuestPresentationStatusView>();
        SetReference(status, "entry", entry);
        SetReference(status, "calibrationSource", calibration);
        SetReference(status, "head", rig.centerEyeAnchor);

        if (!EditorSceneManager.SaveScene(scene, ScenePath))
            throw new IOException("Could not save the Quest presentation scene.");
        AssetDatabase.SaveAssets();
    }

    private static void ConfigurePreviewInput(Scene scene)
    {
        var preview = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Single();
        var settings = new SerializedObject(preview);
        settings.FindProperty("handleRemeasurementInput").boolValue = false;
        settings.ApplyModifiedPropertiesWithoutUndo();
        EditorSceneManager.MarkSceneDirty(scene);
    }

    private static void SetReference(UnityEngine.Object component, string propertyName, UnityEngine.Object value)
    {
        var settings = new SerializedObject(component);
        var property = settings.FindProperty(propertyName);
        if (property == null) throw new InvalidOperationException(component.GetType().Name + " is missing " + propertyName + ".");
        property.objectReferenceValue = value;
        settings.ApplyModifiedPropertiesWithoutUndo();
    }
}

using System;
using System.IO;
using System.Linq;
using Meta.XR;
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
                return;
        }
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Packages/com.meta.xr.sdk.core/Prefabs/OVRCameraRig.prefab");
        if (prefab == null) throw new InvalidOperationException("Meta XR Core SDK Camera Rig prefab is missing.");

        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var rigObject = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
        rigObject.transform.localScale = Vector3.one;
        var rig = rigObject.GetComponent<OVRCameraRig>();
        rig.EnsureGameObjectIntegrity();
        var manager = rigObject.GetComponent<OVRManager>();
        manager.isInsightPassthroughEnabled = true;
        var managerSettings = new SerializedObject(manager);
        managerSettings.FindProperty("requestPassthroughCameraAccessPermissionOnStartup").boolValue = false;
        managerSettings.ApplyModifiedPropertiesWithoutUndo();
        foreach (var camera in rigObject.GetComponentsInChildren<Camera>(true))
        {
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.clear;
            camera.nearClipPlane = 0.05f;
            PrefabUtility.RecordPrefabInstancePropertyModifications(camera);
        }
        PrefabUtility.RecordPrefabInstancePropertyModifications(manager);
        new GameObject("Passthrough Background").AddComponent<OVRPassthroughLayer>();

        var cameraAccess = new GameObject("Left Passthrough Camera").AddComponent<PassthroughCameraAccess>();
        cameraAccess.enabled = false;
        cameraAccess.CameraPosition = PassthroughCameraAccess.CameraPositionType.Left;
        cameraAccess.RequestedResolution = new Vector2Int(1280, 960);
        cameraAccess.MaxFramerate = 30;
        var preview = new GameObject("Marker Calibration Camera").AddComponent<PassthroughCameraDevicePreview>();
        SetReference(preview, "cameraAccess", cameraAccess);
        SetReference(preview, "head", rig.centerEyeAnchor);

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

    private static void SetReference(UnityEngine.Object component, string propertyName, UnityEngine.Object value)
    {
        var settings = new SerializedObject(component);
        var property = settings.FindProperty(propertyName);
        if (property == null) throw new InvalidOperationException(component.GetType().Name + " is missing " + propertyName + ".");
        property.objectReferenceValue = value;
        settings.ApplyModifiedPropertiesWithoutUndo();
    }
}

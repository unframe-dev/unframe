using System;
using System.IO;
using System.Linq;
using Meta.XR;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class PassthroughCameraDeviceTestEditor
{
    public const string ScenePath = "Assets/Scenes/PassthroughCameraDeviceTest.unity";
    public const string ApplicationId = "dev.unframe.pca.preview";

    [MenuItem("Unframe/PCA/Open Device Test Scene")]
    public static void OpenScene()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
        PrepareScene();
        EditorSceneManager.OpenScene(ScenePath);
    }

    public static void PrepareScene()
    {
        ConfigureProject();
        PrepareDiagnosticMaterial();
        if (File.Exists(ScenePath))
        {
            var existing = SceneManager.GetActiveScene();
            if (existing.path != ScenePath)
            {
                if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                    throw new OperationCanceledException("Device scene preparation was cancelled.");
                existing = EditorSceneManager.OpenScene(ScenePath);
            }
            var existingPreview = existing.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Single();
            if (existingPreview.GetComponent<ArucoOriginVisualizer>() == null)
            {
                existingPreview.gameObject.AddComponent<ArucoOriginVisualizer>();
            }
            if (existingPreview.GetComponent<ArucoOriginAlignment>() == null)
            {
                existingPreview.gameObject.AddComponent<ArucoOriginAlignment>();
            }
            if (existingPreview.GetComponent<ArucoCameraMarkerDetection>() == null)
            {
                existingPreview.gameObject.AddComponent<ArucoCameraMarkerDetection>();
            }
            // RequireComponent may already have added these while loading; persist them for the player scene.
            EditorSceneManager.MarkSceneDirty(existing);
            EditorSceneManager.SaveScene(existing);
            return;
        }
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Packages/com.meta.xr.sdk.core/Prefabs/OVRCameraRig.prefab");
        if (prefab == null) throw new InvalidOperationException("Meta XR Core SDK Camera Rig prefab is missing.");
        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var rigObject = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
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
        var source = new GameObject("Left Passthrough Camera").AddComponent<PassthroughCameraAccess>();
        source.enabled = false;
        source.CameraPosition = PassthroughCameraAccess.CameraPositionType.Left;
        source.RequestedResolution = new Vector2Int(1280, 960);
        source.MaxFramerate = 30;
        var preview = new GameObject("PCA Device Preview").AddComponent<PassthroughCameraDevicePreview>();
        var settings = new SerializedObject(preview);
        settings.FindProperty("cameraAccess").objectReferenceValue = source;
        settings.FindProperty("head").objectReferenceValue = rig.centerEyeAnchor;
        settings.ApplyModifiedPropertiesWithoutUndo();
        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.SaveAssets();
        Debug.Log($"[PCA Preview] Scene created: {ScenePath}");
    }

    private static void PrepareDiagnosticMaterial()
    {
        const string path = "Assets/Resources/ArucoDiagnosticUnlit.mat";
        if (AssetDatabase.LoadAssetAtPath<Material>(path) != null) return;
        var shader = Shader.Find("Universal Render Pipeline/Unlit");
        if (shader == null) throw new InvalidOperationException("URP Unlit shader is required for the ArUco origin visualization.");
        var material = new Material(shader);
        AssetDatabase.CreateAsset(material, path);
        AssetDatabase.SaveAssets();
    }

    private static void ConfigureProject()
    {
        var config = OVRProjectConfig.CachedProjectConfig;
        if (config == null) throw new InvalidOperationException("Meta XR project configuration is not ready.");
        config.insightPassthroughSupport = OVRProjectConfig.FeatureSupport.Supported;
        config.isPassthroughCameraAccessEnabled = true;
        config.minHorizonOsSdkVersion = Math.Max(config.minHorizonOsSdkVersion, 74);
        config.systemLoadingScreenBackground = OVRProjectConfig.SystemLoadingScreenBackground.ContextualPassthrough;
        OVRProjectConfig.CommitProjectConfig(config);
    }

    [MenuItem("Unframe/PCA/Build Device Test APK")]
    public static void BuildApk() => Build(false);

    [MenuItem("Unframe/PCA/Build and Run on Quest")]
    public static void BuildAndRun() => Build(true);

    private static void Build(bool run)
    {
        PrepareScene();
        BuildScene(ScenePath, ApplicationId, "unframe-pca-preview.apk", run);
    }

    internal static void BuildScene(string scenePath, string applicationId, string fileName, bool run)
    {
        OpenCvSampleBuildPreparation.ValidateSamplesExcluded(Path.GetDirectoryName(Application.dataPath));
        if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android, BuildTarget.Android))
        {
            throw new InvalidOperationException("Install Unity Android Build Support, SDK/NDK and OpenJDK from Unity Hub.");
        }
        if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android)
        {
            throw new InvalidOperationException("Switch the active Build Profile to Android before building the PCA test.");
        }
        if (PlayerSettings.GetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android) != ScriptingImplementation.IL2CPP
            || PlayerSettings.Android.targetArchitectures != AndroidArchitecture.ARM64)
        {
            throw new InvalidOperationException("The PCA test requires Android IL2CPP and ARM64 only.");
        }
        if (!File.Exists(scenePath))
        {
            throw new InvalidOperationException("Prepare the device test scene before building.");
        }
        string output = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "PCA", fileName));
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        using (new PassthroughCameraDiagnosticBuildSettings(applicationId))
        {
            BuildReport report = PassthroughCameraBuildAssetExclusion.BuildWithoutLocalSettings(() =>
                BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { scenePath },
                    locationPathName = output,
                    target = BuildTarget.Android,
                    options = BuildOptions.Development | (run ? BuildOptions.AutoRunPlayer : BuildOptions.None)
                }));
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new InvalidOperationException($"PCA build {report.summary.result}: {report.summary.totalErrors} errors. See Console.");
            }
            Debug.Log($"[PCA Preview] APK: {output} | Application: {applicationId}");
        }
    }
}

using System;
using System.IO;
using Meta.XR;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class QuestMrSceneBuild
{
    public static void ValidateMarkerDetection(string symbols, bool installed)
    {
        if (!installed)
            throw new InvalidOperationException("Install OpenCV for Unity before building marker calibration.");
        if (string.IsNullOrEmpty(symbols) || !Array.Exists(symbols.Split(';'), symbol => symbol.Trim() == "UNFRAME_OPENCV_FOR_UNITY"))
            throw new InvalidOperationException("Marker detection is disabled. Add UNFRAME_OPENCV_FOR_UNITY to Android Player Settings > Scripting Define Symbols and wait for compilation before building.");
    }

    public static void ValidateAndroidMarkerDetection() => ValidateMarkerDetection(
        PlayerSettings.GetScriptingDefineSymbols(UnityEditor.Build.NamedBuildTarget.Android),
        Directory.Exists(Path.Combine(Application.dataPath, "OpenCVForUnity")));

    public static void CreateCalibrationScene(string scenePath)
    {
        if (string.IsNullOrWhiteSpace(scenePath)) throw new ArgumentException("A scene path is required.", nameof(scenePath));
        ConfigureProject();
        PrepareDiagnosticMaterial();
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
        var preview = new GameObject("Marker Calibration Camera").AddComponent<PassthroughCameraDevicePreview>();
        var settings = new SerializedObject(preview);
        settings.FindProperty("cameraAccess").objectReferenceValue = source;
        settings.FindProperty("head").objectReferenceValue = rig.centerEyeAnchor;
        settings.ApplyModifiedPropertiesWithoutUndo();
        if (!EditorSceneManager.SaveScene(scene, scenePath)) throw new IOException("Could not save the calibration scene.");
        AssetDatabase.SaveAssets();
        Debug.Log($"[MR Presentation] Calibration scene created: {scenePath}");
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

    internal static void BuildScene(string scenePath, string applicationId, string fileName, bool run)
    {
        ValidateAndroidMarkerDetection();
        OpenCvSampleBuildPreparation.ValidateSamplesExcluded(Path.GetDirectoryName(Application.dataPath));
        if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android, BuildTarget.Android))
        {
            throw new InvalidOperationException("Install Unity Android Build Support, SDK/NDK and OpenJDK from Unity Hub.");
        }
        if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android)
        {
            throw new InvalidOperationException("Switch the active Build Profile to Android before building the MR presentation.");
        }
        if (PlayerSettings.GetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android) != ScriptingImplementation.IL2CPP
            || PlayerSettings.Android.targetArchitectures != AndroidArchitecture.ARM64)
        {
            throw new InvalidOperationException("The MR presentation requires Android IL2CPP and ARM64 only.");
        }
        if (!File.Exists(scenePath))
        {
            throw new InvalidOperationException("Prepare the presentation scene before building.");
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
                throw new InvalidOperationException($"MR presentation build {report.summary.result}: {report.summary.totalErrors} errors. See Console.");
            }
            Debug.Log($"[MR Presentation] APK: {output} | Application: {applicationId}");
        }
    }
}

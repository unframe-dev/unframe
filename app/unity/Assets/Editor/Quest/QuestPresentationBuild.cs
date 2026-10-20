using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class QuestPresentationBuild
{
    [MenuItem("Unframe/Presentation/Build Quest Presentation APK")]
    public static void BuildAndroid() => BuildAndroid(BuildOptions.None, "QuestPresentation.apk");

    [MenuItem("Unframe/Presentation/Build Quest Development APK")]
    public static void BuildDevelopment() => BuildAndroid(BuildOptions.Development, "QuestPresentation-Development.apk");

    [MenuItem("Unframe/Presentation/Build And Run Quest Development")]
    public static void BuildDevelopmentAndRun() => BuildAndroid(
        BuildOptions.Development | BuildOptions.AutoRunPlayer, "QuestPresentation-Development.apk");

    private static void BuildAndroid(BuildOptions options, string fileName)
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
        QuestMrSceneBuild.ValidateAndroidMarkerDetection();
        if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android, BuildTarget.Android))
            throw new InvalidOperationException("Unity Android Build Support is required to build the Quest Presentation scene.");
        if (PlayerSettings.GetScriptingBackend(NamedBuildTarget.Android) != ScriptingImplementation.IL2CPP
            || (PlayerSettings.Android.targetArchitectures & AndroidArchitecture.ARM64) == 0)
            throw new InvalidOperationException("Quest Presentation requires Android IL2CPP and ARM64 Player Settings.");
        string projectRoot = Path.GetDirectoryName(Application.dataPath);
        OpenCvSampleBuildPreparation.ValidateSamplesExcluded(projectRoot);
        if (!File.Exists(Path.Combine(projectRoot, QuestPresentationSceneEditor.ScenePath))) throw new FileNotFoundException("Quest Presentation scene is missing.", QuestPresentationSceneEditor.ScenePath);
        string output = Path.Combine(projectRoot, "Builds", fileName);
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        BuildReport report = PassthroughCameraBuildAssetExclusion.BuildWithoutLocalSettings(() => BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { QuestPresentationSceneEditor.ScenePath },
            locationPathName = output,
            target = BuildTarget.Android,
            options = options,
        }));
        if (report.summary.result != BuildResult.Succeeded)
            throw new InvalidOperationException("Quest Presentation Android build failed: " + report.summary.result);
    }
}

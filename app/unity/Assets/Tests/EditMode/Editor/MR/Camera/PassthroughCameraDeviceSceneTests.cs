using System.IO;
using System.Linq;
using System.Xml;
using Meta.XR;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class PassthroughCameraDeviceSceneTests
{
    [Test]
    public void SavedLocalPresentationSceneIncludesDetectionAndAlignmentComponents()
    {
        string serialized = File.ReadAllText(ArucoPresentationTestEditor.ScenePath);
        foreach (string script in new[] { "MarkerDetection/ArucoCameraMarkerDetection", "Alignment/ArucoOriginAlignment", "Alignment/ArucoOriginVisualizer" })
        {
            string guid = AssetDatabase.AssetPathToGUID("Assets/Scripts/MR/" + script + ".cs");
            Assert.That(guid.Length, Is.EqualTo(32), script + " must be imported before preparing the scene.");
            Assert.That(serialized, Does.Contain("guid: " + guid), script + " must be saved for the Android scene.");
        }
    }

    [Test]
    public void LocalPresentationSceneHasAPermissionGatedCameraAndTransparentXrBackground()
    {
        var scene = EditorSceneManager.OpenScene(ArucoPresentationTestEditor.ScenePath, OpenSceneMode.Additive);
        try
        {
            var roots = scene.GetRootGameObjects();
            var sources = roots.SelectMany(root => root.GetComponentsInChildren<PassthroughCameraAccess>(true)).ToArray();
            Assert.That(sources, Has.Length.EqualTo(1));
            Assert.That(sources[0].enabled, Is.False, "The preview owns camera permission and startup.");
            Assert.That(sources[0].CameraPosition, Is.EqualTo(PassthroughCameraAccess.CameraPositionType.Left));
            Assert.That(sources[0].RequestedResolution, Is.EqualTo(new Vector2Int(1280, 960)));
            Assert.That(sources[0].MaxFramerate, Is.EqualTo(30));
            var preview = roots.SelectMany(root => root.GetComponentsInChildren<PassthroughCameraDevicePreview>(true)).Single();
            var settings = new SerializedObject(preview);
            Assert.That(settings.FindProperty("cameraAccess").objectReferenceValue, Is.EqualTo(sources[0]));
            var head = (Transform)settings.FindProperty("head").objectReferenceValue;
            Assert.That(head, Is.Not.Null);
            Assert.That(head.GetComponent<Camera>().backgroundColor.a, Is.Zero);
            Assert.That(head.GetComponent<Camera>().clearFlags, Is.EqualTo(CameraClearFlags.SolidColor));
            Assert.That(preview.GetComponent<ArucoTrackingDiagnosticSession>(), Is.Not.Null);
            Assert.That(preview.GetComponent<ArucoCameraMarkerDetection>(), Is.Not.Null);
            var manager = roots.SelectMany(root => root.GetComponentsInChildren<OVRManager>(true)).Single();
            Assert.That(manager.isInsightPassthroughEnabled, Is.True);
            Assert.That(new SerializedObject(manager).FindProperty("requestPassthroughCameraAccessPermissionOnStartup").boolValue, Is.False);
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<OVRPassthroughLayer>(true)).Count(), Is.EqualTo(1));
        }
        finally
        {
            EditorSceneManager.CloseScene(scene, true);
        }
    }

    [Test]
    public void HeadsetCameraPermissionIsEnabledAtBothManifestAndSdkBoundaries()
    {
        var config = OVRProjectConfig.CachedProjectConfig;
        Assert.That(config.isPassthroughCameraAccessEnabled, Is.True);
        Assert.That(config.insightPassthroughSupport, Is.Not.EqualTo(OVRProjectConfig.FeatureSupport.None));
        Assert.That(config.minHorizonOsSdkVersion, Is.GreaterThanOrEqualTo(74));
        var manifest = new XmlDocument();
        manifest.Load(Path.Combine(Application.dataPath, "Plugins/Android/AndroidManifest.xml"));
        bool cameraPermission = manifest.GetElementsByTagName("uses-permission").Cast<XmlElement>()
            .Any(element => element.GetAttribute("name", "http://schemas.android.com/apk/res/android")
                == OVRPermissionsRequester.PassthroughCameraAccessPermission);
        Assert.That(cameraPermission, Is.True);
    }

    [Test]
    public void DiagnosticBuildRestoresTheConfiguredApplicationIdentifier()
    {
        string applicationId = PlayerSettings.GetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android);

        using (new PassthroughCameraDiagnosticBuildSettings("dev.unframe.test.scope"))
            Assert.That(PlayerSettings.GetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android),
                Is.EqualTo("dev.unframe.test.scope"));
        Assert.That(PlayerSettings.GetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android),
            Is.EqualTo(applicationId));
    }
}

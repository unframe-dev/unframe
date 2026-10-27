using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class ArucoPresentationSceneTests
{
    [Test]
    public void NetworkSceneAssignsRemeasurementInputToItsPresentationStatus()
    {
        var scene = EditorSceneManager.NewPreviewScene();
        var host = new GameObject("Network Preview Input Test");
        UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(host, scene);
        try
        {
            var preview = host.AddComponent<PassthroughCameraDevicePreview>();
            typeof(QuestPresentationSceneEditor).GetMethod("ConfigurePreviewInput",
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic).Invoke(null, new object[] { scene });
            Assert.That(new SerializedObject(preview).FindProperty("handleRemeasurementInput").boolValue, Is.False);
        }
        finally { EditorSceneManager.ClosePreviewScene(scene); }
    }

    [Test]
    public void DefaultBuildUsesTheProductionPresentationScene()
    {
        Assert.That(EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path),
            Is.EqualTo(new[] { QuestPresentationSceneEditor.ScenePath }));
    }

    [Test]
    public void DiagnosticSceneKeepsMarkerCalibrationAndCameraWithoutLocalPlayback()
    {
        var scene = EditorSceneManager.OpenScene(ArucoPresentationTestEditor.ScenePath, OpenSceneMode.Additive);
        try
        {
            var components = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Component>(true)).ToArray();
            var alignment = components.OfType<ArucoOriginAlignment>().Single();
            var calibration = components.OfType<ArucoPresentationCalibration>().Single();
            var settings = new SerializedObject(calibration);
            var rig = components.OfType<OVRCameraRig>().Single();
            Assert.That(settings.FindProperty("alignment").objectReferenceValue, Is.EqualTo(alignment));
            Assert.That(settings.FindProperty("questTrackingOrigin").objectReferenceValue, Is.EqualTo(rig.trackingSpace));
            var preview = components.OfType<PassthroughCameraDevicePreview>().Single();
            Assert.That(new SerializedObject(preview).FindProperty("handleRemeasurementInput").boolValue, Is.True);
            Assert.That(components.All(component => component != null), Is.True, "Every serialized script must remain available.");
            Assert.That(scene.GetRootGameObjects().Select(root => root.name),
                Does.Not.Contain("Presentation Space (device calibration)"));
        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }
}

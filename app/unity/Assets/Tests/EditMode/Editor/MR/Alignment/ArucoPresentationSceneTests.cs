using System.Linq;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class ArucoPresentationSceneTests
{
    [Test]
    public void DeviceSceneKeepsControllersOutsideHiddenContentAndUsesDeliveryFixture()
    {
        var scene = EditorSceneManager.OpenScene(ArucoPresentationTestEditor.ScenePath, OpenSceneMode.Additive);
        try
        {
            var roots = scene.GetRootGameObjects();
            var runner = roots.SelectMany(root => root.GetComponentsInChildren<LocalPresentationFixtureRunner>(true)).Single();
            var binding = roots.SelectMany(root => root.GetComponentsInChildren<ArucoPresentationOriginBinding>(true)).Single();
            var alignment = roots.SelectMany(root => root.GetComponentsInChildren<ArucoOriginAlignment>(true)).Single();
            var calibration = roots.SelectMany(root => root.GetComponentsInChildren<ArucoPresentationCalibration>(true)).Single();
            var calibrationSettings = new SerializedObject(calibration);
            Assert.That(calibrationSettings.FindProperty("alignment").objectReferenceValue, Is.EqualTo(alignment));
            Assert.That(calibrationSettings.FindProperty("questTrackingOrigin").objectReferenceValue, Is.Not.Null);
            var settings = new SerializedObject(binding);
            var space = (Transform)settings.FindProperty("presentationSpace").objectReferenceValue;
            var stage = (Transform)settings.FindProperty("stageRoot").objectReferenceValue;
            Assert.That(settings.FindProperty("calibrationSource").objectReferenceValue, Is.EqualTo(calibration));
            Assert.That(settings.FindProperty("runner").objectReferenceValue, Is.EqualTo(runner));
            Assert.That(space.gameObject.activeSelf, Is.False);
            Assert.That(space.parent, Is.Null);
            Assert.That(stage.parent, Is.EqualTo(space));
            Assert.That(runner.transform.IsChildOf(space), Is.False);
            Assert.That(binding.transform.IsChildOf(space), Is.False);
            Assert.That(alignment.transform.IsChildOf(space), Is.False);
            var runnerSettings = new SerializedObject(runner);
            Assert.That(runnerSettings.FindProperty("hierarchyRoot").objectReferenceValue, Is.EqualTo(stage));
            Assert.That(runnerSettings.FindProperty("startOnPlay").boolValue, Is.True);
        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }
}

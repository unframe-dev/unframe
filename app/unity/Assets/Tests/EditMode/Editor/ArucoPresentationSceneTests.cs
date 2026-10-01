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
            var settings = new SerializedObject(binding);
            var space = (Transform)settings.FindProperty("presentationSpace").objectReferenceValue;
            var stage = (Transform)settings.FindProperty("stageRoot").objectReferenceValue;
            Assert.That(settings.FindProperty("alignment").objectReferenceValue, Is.EqualTo(alignment));
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
            Assert.That(roots.SelectMany(root => root.GetComponentsInChildren<PresentationSourceRunner>(true)), Is.Empty);
        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }
}

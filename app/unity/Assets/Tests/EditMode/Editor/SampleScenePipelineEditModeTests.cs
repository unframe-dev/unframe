using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public sealed class SampleScenePipelineEditModeTests
{
    [Test]
    public void SampleSceneUsesOnlyTheDeliveryFixtureDisplayPath()
    {
        Scene scene = EditorSceneManager.OpenScene("Assets/Scenes/SampleScene.unity", OpenSceneMode.Additive);
        try
        {
            LocalPresentationFixtureRunner runner = null;
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                Assert.That(root.GetComponentsInChildren<MonoBehaviour>(true), Has.None.Null);
                LocalPresentationFixtureRunner candidate = root.GetComponentInChildren<LocalPresentationFixtureRunner>(true);
                if (candidate != null)
                {
                    Assert.That(runner, Is.Null);
                    runner = candidate;
                }
            }

            Assert.That(runner, Is.Not.Null);
            Assert.That(new SerializedObject(runner).FindProperty("startOnPlay").boolValue, Is.True);
            Assert.That(runner.TryLoad(out string error), Is.True, error);
            Assert.That(runner.Store.Nodes, Is.Not.Empty);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:text-greeting", out GameObject node), Is.True);
            Assert.That(node.GetComponentInChildren<TextMesh>(true), Is.Not.Null);
            Assert.That(runner.TryAdvance(out error), Is.True, error);
            Assert.That(runner.AppliedEventCount, Is.EqualTo(1));
        }
        finally
        {
            EditorSceneManager.CloseScene(scene, true);
        }
    }
}

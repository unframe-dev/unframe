using NUnit.Framework;
using Unframe.Unity.VisualEffects;
using UnityEngine;

public sealed class VisualEffectsPreviewTests
{
    [Test]
    public void PreviewBuildsTargetsAndResetRestoresModel()
    {
        var host = new GameObject("Preview test");
        try
        {
            var preview = host.AddComponent<VisualEffectsPreview>();
            preview.Initialize();
            Assert.IsNotNull(preview.Model);
            preview.PlayWave();
            preview.PlayDissolve();
            preview.Advance(5000);
            Assert.IsFalse(preview.Model.enabled);
            preview.ResetPreview();
            Assert.IsTrue(preview.Model.enabled);
            Assert.AreEqual(0, preview.ActiveCount);
            preview.BeginHand();
            preview.Advance(100);
            preview.EndHand();
            preview.Advance(1000);
            Assert.AreEqual(0, preview.ActiveCount);
        }
        finally { Object.DestroyImmediate(host); }
    }

    [Test]
    public void SceneContainsPreviewComponent()
    {
        var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
            "Assets/Scenes/VisualEffectsPreview.unity", UnityEditor.SceneManagement.OpenSceneMode.Additive);
        try
        {
            Assert.IsNotNull(scene.GetRootGameObjects()[0].GetComponent<VisualEffectsPreview>());
        }
        finally { UnityEditor.SceneManagement.EditorSceneManager.CloseScene(scene, true); }
    }

    [Test]
    public void PauseFreezesExternalPreviewClock()
    {
        var host = new GameObject("Preview test");
        try
        {
            var preview = host.AddComponent<VisualEffectsPreview>();
            preview.Initialize();
            preview.Paused = true;
            preview.Advance(200);
            Assert.AreEqual(0, preview.RuntimeMs);
            preview.Paused = false;
            preview.Advance(200);
            Assert.AreEqual(200, preview.RuntimeMs);
            preview.BeginHand();
            preview.Advance(0);
            preview.ReleasePreview();
            Assert.AreEqual(0, preview.ActiveCount);
            Assert.IsNull(preview.Model);
            preview.Initialize();
            Assert.IsNotNull(preview.Model);
        }
        finally { Object.DestroyImmediate(host); }
    }
}

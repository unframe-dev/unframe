using NUnit.Framework;
using Unframe.Unity.VisualEffects;
using UnityEngine;

public sealed class VisualEffectsPreviewTests
{
    [Test]
    public void PreviewFloorAndCameraAreRecreatedWithoutLeakingResources()
    {
        var host = new GameObject("Preview test");
        try
        {
            var preview = host.AddComponent<VisualEffectsPreview>();
            preview.Initialize();
            preview.Initialize();
            var floor = host.transform.Find("Preview stage/Preview floor");
            Assert.IsNotNull(floor);
            Assert.That(floor.localPosition.y, Is.EqualTo(0).Within(0.001f));
            var material = floor.GetComponent<MeshRenderer>().sharedMaterial;
            var texture = material.mainTexture;
            Assert.IsNotNull(texture);
            var camera = host.GetComponentInChildren<Camera>();
            Assert.That(camera.transform.localPosition, Is.EqualTo(new Vector3(0, 1, -13)));
            Assert.That(camera.transform.localRotation, Is.EqualTo(Quaternion.identity));
            Assert.That(camera.fieldOfView, Is.EqualTo(45));
            preview.ReleasePreview();
            Assert.IsTrue(material == null);
            Assert.IsTrue(texture == null);
            Assert.IsNull(host.transform.Find("Preview stage"));
            preview.Initialize();
            Assert.IsNotNull(host.transform.Find("Preview stage/Preview floor"));
            Assert.AreEqual(1, host.GetComponentsInChildren<Camera>().Length);
        }
        finally { Object.DestroyImmediate(host); }
    }

    [Test]
    public void PreviewWavesStartAndStopIndependently()
    {
        var host = new GameObject("Preview test");
        try
        {
            var preview = host.AddComponent<VisualEffectsPreview>();
            preview.PlayWave();
            preview.PlaySecondWave();
            preview.Advance(5000);
            Assert.AreEqual(2, preview.ActiveCount);
            preview.CancelWave();
            Assert.AreEqual(1, preview.ActiveCount);
            Assert.AreEqual(12, host.GetComponentsInChildren<LineRenderer>().Length);
            preview.CancelSecondWave();
            Assert.AreEqual(0, preview.ActiveCount);
        }
        finally { Object.DestroyImmediate(host); }
    }

    [Test]
    public void ResetRemovesHeldWave()
    {
        var host = new GameObject("Preview test");
        try
        {
            var preview = host.AddComponent<VisualEffectsPreview>();
            preview.PlayWave();
            preview.Advance(10000);
            Assert.AreEqual(1, preview.ActiveCount);
            Assert.AreEqual(12, host.GetComponentsInChildren<LineRenderer>().Length);
            preview.ResetPreview();
            Assert.AreEqual(0, preview.ActiveCount);
            Assert.AreEqual(0, host.GetComponentsInChildren<LineRenderer>().Length);
        }
        finally { Object.DestroyImmediate(host); }
    }

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

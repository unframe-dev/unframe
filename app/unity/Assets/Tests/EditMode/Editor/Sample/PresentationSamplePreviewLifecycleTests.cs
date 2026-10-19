using System;
using System.Collections;
using System.IO;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using Unframe.Unity.PresentationRuntime.Editor;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationSamplePreviewLifecycleTests
{
    [Test]
    public void MissingSettingsCannotCreateRuntimeOrCamera()
    {
        var owner = new GameObject("Preview lifecycle test");
        try
        {
            var driver = owner.AddComponent<PresentationSamplePreviewDriver>();
            Assert.Throws<InvalidOperationException>(() => driver.StartPreview(null));
            Assert.That(driver.Runtime, Is.Null);
            Assert.That(driver.PreviewCamera, Is.Null);
        }
        finally { UnityEngine.Object.DestroyImmediate(owner); }
    }

    [Test]
    public void InvalidCoordinateOriginRollsBackCreatedRuntime()
    {
        var owner = new GameObject("Preview lifecycle test");
        owner.transform.localScale = Vector3.one * 2;
        try
        {
            var driver = owner.AddComponent<PresentationSamplePreviewDriver>();
            var failure = Assert.Throws<InvalidOperationException>(() => driver.StartPreview(new PresentationSampleConnectionSettings()));
            Assert.That(failure.Message, Is.EqualTo("sample-preview-start-failed"));
            Assert.That(owner.GetComponent<PresentationBakedRuntime>(), Is.Null);
            Assert.That(driver.PreviewCamera, Is.Null);
            Assert.That(driver.Running.IsCompleted, Is.True);
            Assert.That(driver.StopAsync().IsCompleted, Is.True);
        }
        finally { UnityEngine.Object.DestroyImmediate(owner); }
    }

    [UnityTest]
    public IEnumerator ExpiredSettingsFailSafelyAndStopClearsCredential()
    {
        string directory = Path.Combine(Path.GetTempPath(), "unframe-sample-lifecycle-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string caFile = Path.Combine(directory, "ca.pem");
        File.WriteAllText(caFile, "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----");
        string path = Path.Combine(directory, "connection.json");
        File.WriteAllText(path, JsonUtility.ToJson(new Descriptor
        {
            version = 1, controlPlaneOrigin = "https://localhost:18443", sessionId = "sample-session",
            credential = "never-show-this-token", caFile = caFile,
            expiresAt = DateTimeOffset.UtcNow.AddHours(-1).ToString("O"), presentationId = "presentation", buildId = "build",
        }));
        var settings = PresentationSampleConnectionSettings.Load(path, DateTimeOffset.UtcNow.AddHours(-2));
        var owner = new GameObject("Preview lifecycle test");
        try
        {
            var driver = owner.AddComponent<PresentationSamplePreviewDriver>();
            driver.StartPreview(settings);
            Assert.That(driver.Runtime.CalibrationReady, Is.True);
            Assert.That(driver.PreviewCamera.GetComponent<PresentationPreviewCamera>().enabled, Is.False);
            Assert.Throws<InvalidOperationException>(() => driver.StartPreview(settings));
            var stopped = driver.StopAsync();
            Assert.That(settings.Credential, Is.Null);
            float deadline = Time.realtimeSinceStartup + 5;
            while (!stopped.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.That(stopped.IsCompleted, Is.True);
            Assert.That(stopped.IsFaulted, Is.False);
            Assert.That(driver.ErrorCode, Is.EqualTo("sample-connection-expired"));
            Assert.That(driver.ErrorCode, Does.Not.Contain("never-show-this-token"));
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(owner);
            Directory.Delete(directory, true);
        }
    }

    [Serializable]
    private sealed class Descriptor
    {
        public int version;
        public string controlPlaneOrigin, sessionId, credential, caFile, expiresAt, presentationId, buildId;
    }
}

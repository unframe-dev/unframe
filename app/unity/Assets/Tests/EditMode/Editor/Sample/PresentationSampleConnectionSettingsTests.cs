using System;
using System.IO;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime.Editor;
using UnityEngine;

public sealed class PresentationSampleConnectionSettingsTests
{
    private string directory;
    private string caFile;
    private readonly DateTimeOffset now = DateTimeOffset.Parse("2026-10-19T00:00:00Z");

    [SetUp]
    public void SetUp()
    {
        directory = Path.Combine(Path.GetTempPath(), "unframe-sample-settings-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        caFile = Path.Combine(directory, "ca.pem");
        File.WriteAllText(caFile, "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----");
    }

    [TearDown]
    public void TearDown() => Directory.Delete(directory, true);

    [Test]
    public void ReadsPrivateConnectionAndCertificateWithoutPersistingThem()
    {
        var settings = Load();
        Assert.That(settings.Origin, Is.EqualTo(new Uri("https://localhost:18443")));
        Assert.That(settings.SessionId, Is.EqualTo("sample-session"));
        Assert.That(settings.Credential, Is.EqualTo("private-credential"));
        Assert.That(settings.RootCertificates, Does.StartWith("-----BEGIN CERTIFICATE-----"));
        settings.ClearCredential();
        Assert.That(settings.Credential, Is.Null);
    }

    [TestCase("http://localhost:18443")]
    [TestCase("https://example.com")]
    [TestCase("https://name:secret@localhost:18443")]
    [TestCase("https://localhost:18443/path")]
    [TestCase("https://localhost:18443/?secret=value")]
    [TestCase("https://localhost:18443/#fragment")]
    public void RejectsNonLocalOrNonOriginEndpoints(string origin)
    {
        Assert.That(Assert.Throws<InvalidOperationException>(() => Load(origin)).Message, Is.EqualTo("sample-connection-invalid"));
    }

    [Test]
    public void RejectsExpiredCredentialWithSafeError()
    {
        Assert.That(Assert.Throws<InvalidOperationException>(() => Load(expires: "2026-10-18T00:00:00Z")).Message, Is.EqualTo("sample-connection-expired"));
    }

    [Test]
    public void RejectsOversizeDocumentBeforeDeserializing()
    {
        string path = Path.Combine(directory, "connection.json");
        File.WriteAllText(path, new string('x', 65537));
        Assert.That(Assert.Throws<InvalidOperationException>(() => PresentationSampleConnectionSettings.Load(path, now)).Message, Is.EqualTo("sample-connection-invalid"));
    }

    [Test]
    public void RejectsUnsupportedVersionAndMissingCredential()
    {
        Assert.Throws<InvalidOperationException>(() => Load(version: 2));
        Assert.Throws<InvalidOperationException>(() => Load(credential: ""));
    }

    private PresentationSampleConnectionSettings Load(string origin = "https://localhost:18443", string expires = "2026-10-19T01:00:00Z", int version = 1, string credential = "private-credential")
    {
        string path = Path.Combine(directory, "connection.json");
        File.WriteAllText(path, JsonUtility.ToJson(new Descriptor { version = version, controlPlaneOrigin = origin, sessionId = "sample-session", credential = credential, caFile = caFile, expiresAt = expires, presentationId = "presentation", buildId = "build" }));
        return PresentationSampleConnectionSettings.Load(path, now);
    }

    [Serializable]
    private sealed class Descriptor
    {
        public int version;
        public string controlPlaneOrigin, sessionId, credential, caFile, expiresAt, presentationId, buildId;
    }
}

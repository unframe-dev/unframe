using System;
using System.Collections;
using System.IO;
using System.Security.Cryptography;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationRuntimeAssetFilesTests
{
    [UnityTearDown]
    public IEnumerator ExitPlayModeAfterTest()
    {
        if (Application.isPlaying) yield return new ExitPlayMode();
    }

    [UnityTest]
    public IEnumerator ReadinessChecksFileChangesOncePerPlayModeFrame()
    {
        yield return new EnterPlayMode();
        byte[] bytes = { 1, 2, 3 };
        using (var files = new PresentationRuntimeAssetFiles())
        {
            string path = files.Add(Asset(bytes), bytes);
            Assert.That(files.IsReady, Is.True);
            File.WriteAllBytes(path, new byte[] { 1 });
            Assert.That(files.IsReady, Is.True, "The completed file check is reused during the same frame.");
            yield return null;
            Assert.That(files.IsReady, Is.False, "A changed file length must be detected on the following frame.");
            File.WriteAllBytes(path, bytes);
            Assert.That(files.IsReady, Is.False);
            yield return null;
            Assert.That(files.IsReady, Is.True, "A repaired file must be rechecked on the following frame.");
            File.Delete(path);
            yield return null;
            Assert.That(files.IsReady, Is.False, "A missing file must still invalidate residency.");
        }
    }

    [UnityTest]
    public IEnumerator AddingAnAssetInvalidatesTheCurrentFrameReadiness()
    {
        yield return new EnterPlayMode();
        byte[] bytes = { 1, 2, 3 };
        using (var files = new PresentationRuntimeAssetFiles())
        {
            string path = files.Add(Asset(bytes), bytes);
            Assert.That(files.IsReady, Is.True);
            File.Delete(path);
            byte[] otherBytes = { 4, 5, 6 };
            AssetAccessBinding other = Asset(otherBytes);
            other.AssetId = "other-video";
            files.Add(other, otherBytes);
            Assert.That(files.IsReady, Is.False, "Adding an asset requires a fresh check of all resident files.");
        }
    }

    [UnityTest]
    public IEnumerator DisposingInvalidatesTheCurrentFrameReadiness()
    {
        yield return new EnterPlayMode();
        byte[] bytes = { 1, 2, 3 };
        using (var files = new PresentationRuntimeAssetFiles())
        {
            files.Add(Asset(bytes), bytes);
            Assert.That(files.IsReady, Is.True);
            files.Dispose();
            Assert.That(files.IsReady, Is.False);
        }
    }

    [Test]
    public void VerifiedAssetUsesChecksumPathAndIsRemovedOnDispose()
    {
        byte[] bytes = { 1, 2, 3 };
        AssetAccessBinding asset = Asset(bytes);
        string path;
        using (var files = new PresentationRuntimeAssetFiles())
        {
            path = files.Add(asset, bytes);
            Assert.That(Path.GetFileName(path), Is.EqualTo(asset.Checksum.Substring(7) + ".mp4"));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(bytes));
            Assert.That(files.Paths[asset.AssetId], Is.EqualTo(path));
            Assert.That(files.IsReady, Is.True);
            File.Delete(path);
            Assert.That(files.IsReady, Is.False);
        }
        Assert.That(Directory.Exists(Path.GetDirectoryName(path)), Is.False);
    }

    [Test]
    public void AssetFileRejectsMismatchedBytesAndUnknownMediaType()
    {
        byte[] bytes = { 1, 2, 3 };
        AssetAccessBinding asset = Asset(bytes);
        using (var files = new PresentationRuntimeAssetFiles())
        {
            Assert.Throws<InvalidOperationException>(() => files.Add(asset, new byte[] { 3, 2, 1 }));
            asset.MediaType = "application/octet-stream";
            Assert.Throws<InvalidOperationException>(() => files.Add(asset, bytes));
            Assert.That(files.Paths, Is.Empty);
        }
    }

    private static AssetAccessBinding Asset(byte[] bytes)
    {
        using (SHA256 hash = SHA256.Create())
            return new AssetAccessBinding
            {
                AssetId = "../../video",
                MediaType = "video/mp4",
                EncodedSizeBytes = (ulong)bytes.Length,
                Checksum = "sha256:" + BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(),
            };
    }
}

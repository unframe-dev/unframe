using System;
using System.IO;
using System.Security.Cryptography;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationRuntimeAssetFilesTests
{
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

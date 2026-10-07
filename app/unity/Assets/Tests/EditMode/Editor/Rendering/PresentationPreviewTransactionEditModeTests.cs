using System;
using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationPreviewTransactionEditModeTests
{
    private static Task<PresentationPreviewAssetData> Asset(string request, string reference, CancellationToken token)
    {
        Assert.That(reference, Is.EqualTo("opaque-asset-one"));
        return Task.FromResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png"));
    }

    [UnityTest]
    public IEnumerator PreparedSceneRemainsHiddenUntilMatchingCommitAndSharesTextureOnSwap()
    {
        var root = new GameObject("preview test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var envelope = PresentationPreviewTestFixture.Create(texture: true);
                Task<string> prepare = transaction.PrepareAsync(envelope, Asset, CancellationToken.None);
                while (!prepare.IsCompleted) yield return null;
                Assert.That(prepare.GetAwaiter().GetResult(), Is.EqualTo(envelope.RequestId));
                Assert.That(transaction.LoadedBuildIdentity, Is.Null);
                Assert.That(root.transform.GetChild(0).gameObject.activeSelf, Is.False);
                Assert.Throws<InvalidOperationException>(() => transaction.Commit(new string('b', 32)));
                Assert.That(transaction.Commit(envelope.RequestId), Is.EqualTo("build:a"));
                Assert.That(transaction.ResidentGpuBytes, Is.EqualTo(4));
                GameObject oldRoot = root.transform.GetChild(0).gameObject;
                Texture oldTexture = TextureOn(oldRoot);
                Assert.That(oldTexture, Is.Not.Null);
                var next = PresentationPreviewTestFixture.Create('b', texture: true);
                int loads = 0;
                prepare = transaction.PrepareAsync(next, (request, reference, token) => { loads++; return Asset(request, reference, token); }, CancellationToken.None);
                while (!prepare.IsCompleted) yield return null;
                prepare.GetAwaiter().GetResult();
                Assert.That(loads, Is.Zero, "shared checksums must retain GPU residency without loading bytes");
                Assert.That(oldRoot.activeSelf, Is.True);
                Assert.That(transaction.LoadedBuildIdentity, Is.EqualTo("build:a"));
                Assert.That(transaction.Commit(next.RequestId), Is.EqualTo("build:b"));
                Assert.That(oldRoot == null, Is.True);
                Assert.That(TextureOn(root.transform.GetChild(0).gameObject), Is.SameAs(oldTexture));
                GameObject other = root.transform.GetChild(0).Find("Presentation Nodes/node:other").gameObject;
                Assert.That(other.activeSelf, Is.False);
                transaction.Dispose();
                Assert.That(oldTexture == null, Is.True);
                Assert.That(root.transform.childCount, Is.Zero);
            }
            finally { transaction.Dispose(); UnityEngine.Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator AssetFailureAndDiscardKeepTheCurrentScene()
    {
        var root = new GameObject("preview failure test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var initial = PresentationPreviewTestFixture.Create();
                Task<string> prepare = transaction.PrepareAsync(initial, Asset, CancellationToken.None);
                while (!prepare.IsCompleted) yield return null;
                prepare.GetAwaiter().GetResult();
                transaction.Commit(initial.RequestId);
                GameObject old = root.transform.GetChild(0).gameObject;
                var next = PresentationPreviewTestFixture.Create('b', texture: true);
                prepare = transaction.PrepareAsync(next, (request, reference, token) =>
                    Task.FromResult(new PresentationPreviewAssetData(new byte[86], "image/png")), CancellationToken.None);
                while (!prepare.IsCompleted) yield return null;
                Assert.That(prepare.IsFaulted, Is.True);
                Assert.That(transaction.LoadedBuildIdentity, Is.EqualTo("build:a"));
                Assert.That(old.activeSelf, Is.True);
                Assert.That(root.transform.childCount, Is.EqualTo(1));
                next = PresentationPreviewTestFixture.Create('c', texture: true);
                prepare = transaction.PrepareAsync(next, Asset, CancellationToken.None);
                while (!prepare.IsCompleted) yield return null;
                prepare.GetAwaiter().GetResult();
                Assert.That(transaction.Discard(next.RequestId), Is.True);
                Assert.That(transaction.PreparedRequestId, Is.Null);
                Assert.That(old.activeSelf, Is.True);
                Assert.That(root.transform.childCount, Is.EqualTo(1));
            }
            finally { transaction.Dispose(); UnityEngine.Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator CancelledSlowAssetCannotReplaceTheLatestPreparedScene()
    {
        var root = new GameObject("preview stale test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var slow = new TaskCompletionSource<PresentationPreviewAssetData>();
                var initial = PresentationPreviewTestFixture.Create('a', texture: true);
                Task<string> old = transaction.PrepareAsync(initial, (request, reference, token) => slow.Task, CancellationToken.None);
                Assert.That(old.IsCompleted, Is.False);
                var next = PresentationPreviewTestFixture.Create('b');
                Task<string> latest = transaction.PrepareAsync(next, Asset, CancellationToken.None);
                Assert.That(latest.IsCompleted, Is.False, "new allocation must wait for the cancelled asset load to finish");
                slow.SetResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png"));
                while (!old.IsCompleted || !latest.IsCompleted) yield return null;
                Assert.That(old.IsCanceled || old.IsFaulted, Is.True);
                Assert.That(latest.GetAwaiter().GetResult(), Is.EqualTo(next.RequestId));
                Assert.Throws<InvalidOperationException>(() => transaction.Commit(initial.RequestId));
                Assert.That(transaction.Commit(next.RequestId), Is.EqualTo("build:b"));
                Assert.That(transaction.ResidentGpuBytes, Is.Zero);
                Assert.That(root.transform.childCount, Is.EqualTo(1));
            }
            finally { transaction.Dispose(); UnityEngine.Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator ExplicitCancellationReleasesTheCandidateWithoutChangingCurrentIdentity()
    {
        var root = new GameObject("preview cancellation test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        using (var cancellation = new CancellationTokenSource())
        {
            try
            {
                var slow = new TaskCompletionSource<PresentationPreviewAssetData>();
                Task<string> prepare = transaction.PrepareAsync(PresentationPreviewTestFixture.Create(texture: true),
                    (request, reference, token) => slow.Task, cancellation.Token);
                cancellation.Cancel();
                slow.SetResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png"));
                while (!prepare.IsCompleted) yield return null;
                Assert.That(prepare.IsCanceled || prepare.IsFaulted, Is.True);
                Assert.That(transaction.PreparedRequestId, Is.Null);
                Assert.That(transaction.LoadedBuildIdentity, Is.Null);
                Assert.That(root.transform.childCount, Is.Zero);
            }
            finally { transaction.Dispose(); UnityEngine.Object.DestroyImmediate(root); }
        }
    }

    private static Texture TextureOn(GameObject root)
    {
        var block = new MaterialPropertyBlock();
        root.GetComponentInChildren<MeshRenderer>().GetPropertyBlock(block);
        return block.GetTexture("_FromTex");
    }
}

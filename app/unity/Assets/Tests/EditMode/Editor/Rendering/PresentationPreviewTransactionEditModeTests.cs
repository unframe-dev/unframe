using System;
using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Google.Protobuf;
using Google.Protobuf.WellKnownTypes;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Preview;
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

    [TestCase("envelope", 0)]
    [TestCase("envelope", 1)]
    [TestCase("envelope", 3)]
    [TestCase("build", 0)]
    [TestCase("build", 2)]
    [TestCase("build", 3)]
    [TestCase("assets", 0)]
    [TestCase("assets", 2)]
    [TestCase("assets", 3)]
    public void PreviewRejectsUnsupportedSchemaVersions(string part, int version)
    {
        var envelope = PresentationPreviewTestFixture.Create();
        Assert.That(PresentationLocalPreviewAdapter.TryCreate(envelope, out _, out string error), Is.True, error);
        if (part == "envelope") envelope.SchemaVersion = (uint)version;
        else if (part == "build") envelope.BuildManifest = envelope.BuildManifest.Replace("\"schemaVersion\":1", "\"schemaVersion\":" + version);
        else envelope.AssetSet = envelope.AssetSet.Replace("\"schemaVersion\":1", "\"schemaVersion\":" + version);

        Assert.That(PresentationLocalPreviewAdapter.TryCreate(envelope, out _, out error), Is.False);
        Assert.That(error, Is.EqualTo("preview.envelope-invalid"));
    }

    [Test]
    public void PreviewAcceptsEffectPlaybackCapabilityFromTheWireEnvelope()
    {
        var envelope = PresentationPreviewTestFixture.Create();
        envelope.Projection.RequiredRuntimeCapabilities.Add(RuntimeCapability.EffectPlayback);
        var decoded = LocalPreviewEnvelope.Parser.ParseFrom(envelope.ToByteArray());
        Assert.That(PresentationLocalPreviewAdapter.TryCreate(decoded, out var input, out string error), Is.True, error);
        Assert.That(input, Is.Not.Null);
    }

    [Test]
    public void PreviewAcceptsPngsThatExceedFormerMemoryBudget()
    {
        const int textureCount = 13;
        const ulong gpuBytes = 16777216;
        const ulong encodedBytes = 16780625;
        var envelope = PresentationPreviewTestFixture.Create(texture: true);
        var projection = envelope.Projection;
        var plan = projection.TextureResidency;
        var artifact = projection.RenderSurfaces[0].Artifacts[0].BakedWeb;
        var texture = artifact.States[0].Texture.Clone();
        var assets = new Struct();
        projection.RuntimeCatalog.Surfaces[0].ReachableStateIds.Clear();
        projection.SemanticSurfaces[0].States.Clear();
        projection.RenderSurfaces[0].StateBindings.Clear();
        artifact.States.Clear();
        plan.Textures.Clear();
        plan.GroupWindows[0].AssetIds.Clear();
        envelope.Assets.Clear();
        for (int i = 0; i < textureCount; i++)
        {
            string stateId = i == 0 ? "state:first" : $"state:{i}";
            string assetId = $"asset:{i}";
            string checksum = $"sha256:{i:x64}";
            texture.AssetId = assetId;
            texture.Checksum = checksum;
            texture.PixelSize = new PixelSize { Width = 2048, Height = 2048 };
            texture.EncodedSizeBytes = encodedBytes;
            texture.DecodedGpuBytes = gpuBytes;
            projection.RuntimeCatalog.Surfaces[0].ReachableStateIds.Add(stateId);
            projection.SemanticSurfaces[0].States.Add(new SurfaceSemanticState { StateId = stateId });
            projection.RenderSurfaces[0].StateBindings.Add(new DeliveredStateBinding
            {
                StateId = stateId,
                Artifact = new ArtifactStateBinding { ArtifactId = artifact.ArtifactId },
            });
            artifact.States.Add(new BakedWebStateTexture { StateId = stateId, Texture = texture.Clone() });
            plan.Textures.Add(new TextureResidencyBinding
            {
                AssetId = assetId,
                Checksum = checksum,
                PixelSize = texture.PixelSize.Clone(),
                DecodedGpuBytes = gpuBytes,
                PeakLoadCpuBytes = encodedBytes + 2 * gpuBytes,
            });
            plan.GroupWindows[0].AssetIds.Add(assetId);
            envelope.Assets.Add(new LocalPreviewAsset { AssetId = assetId, Reference = $"asset-ref-{i}" });
            assets.Fields.Add(assetId, Value.ForStruct(new Struct
            {
                Fields =
                {
                    { "checksum", Value.ForString(checksum) },
                    { "mediaType", Value.ForString("image/png") },
                    { "encodedSizeBytes", Value.ForNumber(encodedBytes) },
                },
            }));
        }
        plan.TotalDecodedGpuBytes = plan.MaximumResidentGpuBytes = textureCount * gpuBytes;
        plan.MaximumResidentTextureBindings = textureCount;
        plan.MaximumPeakLoadCpuBytes = encodedBytes + 2 * gpuBytes;
        envelope.AssetSet = new Struct
        {
            Fields =
            {
                { "schemaVersion", Value.ForNumber(1) },
                { "assets", Value.ForStruct(assets) },
            },
        }.ToString();
        Assert.That(PresentationLocalPreviewAdapter.TryCreate(envelope, out _, out string error), Is.True, error);
    }

    [UnityTest]
    public IEnumerator PreparationReportsTheBlockedStageBeforeAcknowledgingReadiness()
    {
        var root = new GameObject("preview progress test");
        var asset = new TaskCompletionSource<PresentationPreviewAssetData>();
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var progress = new System.Collections.Generic.List<string>();
                var envelope = PresentationPreviewTestFixture.Create(texture: true);
                var prepare = transaction.PrepareAsync(envelope, (request, reference, token) => asset.Task,
                    CancellationToken.None, progress.Add);
                yield return null;
                Assert.That(progress, Does.Contain("texture-assets"));
                Assert.That(prepare.IsCompleted, Is.False);
                asset.SetResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png"));
                while (!prepare.IsCompleted) yield return null;
                prepare.GetAwaiter().GetResult();
                Assert.That(progress[progress.Count - 1], Is.EqualTo("prepared"));
                Assert.That(transaction.PreparedRequestId, Is.EqualTo(envelope.RequestId));
            }
            finally
            {
                asset.TrySetResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png"));
                transaction.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }
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

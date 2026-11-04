using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationTextureResidencyEditModeTests
{
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAABBJREFUeAEBBQD6/wD/AAD/BQAB//pciNEAAAAASUVORK5CYII=");

    [TestCase(29)]
    [TestCase(42)]
    [TestCase(70)]
    [TestCase(82)]
    public void MalformedPngChunkChecksumsAreRejectedEvenWhenTheAssetHashMatches(int offset)
    {
        byte[] changed = (byte[])Png.Clone();
        changed[offset] ^= 1;
        TextureResidencyBinding binding = Binding("asset:a");
        AssetAccessBinding access = Access("asset:a");
        binding.Checksum = Hash(changed);
        access.Checksum = binding.Checksum;
        using (PresentationTextureResidency textures = new PresentationTextureResidency())
        {
            Assert.That(textures.TryLoad(binding, access, changed, out _), Is.False);
            Assert.That(textures.ResidentGpuBytes, Is.Zero);
        }
    }

    [Test]
    public void SessionsShareGpuTextureUntilTheLastOwnerReleasesIt()
    {
        var first = new PresentationTextureResidency();
        var second = new PresentationTextureResidency();
        try
        {
            TextureResidencyBinding binding = Binding("asset:a");
            Assert.That(first.TryLoad(binding, Access("asset:a"), Png, out string error), Is.True, error);
            Assert.That(second.TryLoad(binding, Access("asset:a"), Png, out error), Is.True, error);
            Assert.That(first.TryGet(binding.Checksum, out Texture2D texture), Is.True);
            Assert.That(second.TryGet(binding.Checksum, out Texture2D shared), Is.True);
            Assert.That(shared, Is.SameAs(texture));
            first.Dispose();
            Assert.That(second.TryGet(binding.Checksum, out shared), Is.True);
            Assert.That(shared, Is.SameAs(texture));
            second.Dispose();
            Assert.That(texture == null, Is.True);
        }
        finally { first.Dispose(); second.Dispose(); }
    }

    [Test]
    public void ReleasingUnusedTexturesPreservesOtherOwnersAndAllowsReload()
    {
        using (var first = new PresentationTextureResidency())
        using (var second = new PresentationTextureResidency())
        {
            var binding = Binding("asset:a");
            Assert.That(first.TryLoad(binding, Access("asset:a"), Png, out string error), Is.True, error);
            Assert.That(second.TryRetain(binding, out error), Is.True, error);
            Assert.That(first.TryGet(binding.Checksum, out var shared), Is.True);
            first.RetainOnly(Array.Empty<string>());
            Assert.That(first.ResidentGpuBytes, Is.Zero);
            Assert.That(first.TryGet(binding.Checksum, out _), Is.False);
            Assert.That(second.TryGet(binding.Checksum, out var remaining), Is.True);
            Assert.That(remaining, Is.SameAs(shared));
            second.RetainOnly(Array.Empty<string>());
            Assert.That(shared == null, Is.True);
            Assert.That(first.TryLoad(binding, Access("asset:a"), Png, out error), Is.True, error);
            Assert.That(first.ResidentGpuBytes, Is.EqualTo(4));
        }
    }

    [Test]
    public void WindowSelectionPinsAllStatesAndDirectSuccessorsByDeclaredAssetId()
    {
        var first = Binding("asset:first");
        var second = Binding("asset:second");
        second.Checksum = "sha256:" + new string('b', 64);
        var plan = new TextureResidencyPlan
        {
            InitialGroupId = "group:first",
            Textures = { first, second },
            GroupWindows = {
                new TextureResidencyWindow { GroupId = "group:first", AssetIds = { "asset:first", "asset:second" } },
                new TextureResidencyWindow { GroupId = "group:last", AssetIds = { "asset:second" } },
            },
        };
        CollectionAssert.AreEquivalent(new[] { first, second }, PresentationTextureWindow.Select(plan, null));
        CollectionAssert.AreEqual(new[] { second }, PresentationTextureWindow.Select(plan, "group:last"));
        Assert.Throws<InvalidOperationException>(() => PresentationTextureWindow.Select(plan, "group:unknown"));
    }

    [Test]
    public void WindowPreparationPreservesResidentTextureWhenLoadingFailsWithinBudget()
    {
        using (var textures = new PresentationTextureResidency())
        {
            var first = Binding("asset:first");
            var second = Binding("asset:second");
            second.Checksum = "sha256:" + new string('b', 64);
            Assert.That(textures.TryLoad(first, Access("asset:first"), Png, out _), Is.True);
            Assert.That(textures.TryGet(first.Checksum, out var original), Is.True);
            var limits = new TextureLimits { MaxGpuBytes = 8, MaxTextureBindings = 2 };
            Assert.Throws<InvalidOperationException>(() => PresentationTextureWindow.Prepare(textures,
                new[] { second }, limits, 0, 0, () => Assert.Fail("No eviction is required"), _ => false));
            Assert.That(textures.TryGet(first.Checksum, out var remaining), Is.True);
            Assert.That(remaining, Is.SameAs(original));
        }
    }

    [Test]
    public void WindowPreparationDetachesBeforeEvictionAndAccountsForModelTextures()
    {
        using (var textures = new PresentationTextureResidency())
        {
            var first = Binding("asset:first");
            var second = Binding("asset:second");
            second.Checksum = "sha256:" + new string('b', 64);
            Assert.That(textures.TryLoad(first, Access("asset:first"), Png, out _), Is.True);
            var limits = new TextureLimits { MaxGpuBytes = 8, MaxTextureBindings = 2 };
            bool detached = false;
            Assert.Throws<InvalidOperationException>(() => PresentationTextureWindow.Prepare(textures,
                new[] { second }, limits, 4, 1, () =>
                {
                    Assert.That(textures.TryGet(first.Checksum, out _), Is.True);
                    detached = true;
                }, binding =>
                {
                    Assert.That(detached, Is.True);
                    Assert.That(textures.ResidentGpuBytes, Is.Zero);
                    return false;
                }));
            Assert.That(detached, Is.True);
            Assert.That(textures.ResidentGpuBytes, Is.Zero);
        }
    }

    [Test]
    public void AllSelectedTexturesAreUploadedWithoutCpuCopiesAndSharedByChecksum()
    {
        using (PresentationTextureResidency textures = new PresentationTextureResidency())
        {
            TextureResidencyBinding binding = Binding("asset:a");
            Assert.That(textures.TryLoad(binding, Access("asset:a"), Png, out string error), Is.True, error);
            Assert.That(textures.TryLoad(Binding("asset:b"), Access("asset:b"), Png, out error), Is.True, error);
            Assert.That(textures.TryGet(binding.Checksum, out Texture2D loaded), Is.True);
            Assert.That(loaded.isReadable, Is.False);
            Assert.That(loaded.format, Is.EqualTo(TextureFormat.RGBA32));
            Assert.That(loaded.mipmapCount, Is.EqualTo(1));
            Assert.That(textures.ResidentGpuBytes, Is.EqualTo(4));
            Assert.That(textures.TryGet(Binding("asset:b").Checksum, out Texture2D same), Is.True);
            Assert.That(same, Is.SameAs(loaded));
        }
    }

    internal static TextureResidencyBinding Binding(string id)
    {
        return new TextureResidencyBinding { AssetId = id, Checksum = Hash(Png), PixelSize = new PixelSize { Width = 1, Height = 1 }, DecodedGpuBytes = 4, PeakLoadCpuBytes = 94 };
    }

    [Test]
    public void BakedDeliveryIsAcceptedOnlyWithCompleteResidencyAndVerifiedAssetMetadata()
    {
        DeliveryManifest manifest = BakedDelivery();
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out string error), Is.True, error);
        manifest.Residency.Textures.TotalDecodedGpuBytes = 3;
        Assert.That(store.TryReceiveDelivery(manifest, out error), Is.False);
    }

    [Test]
    public void BakedDeliveryAcceptsTheRuntimeTransportCapability()
    {
        DeliveryManifest manifest = BakedDelivery();
        manifest.ProjectionProfile.RequiredRuntimeCapabilities.Insert(0, Unframe.Presentation.RuntimeCapability.RuntimeTransport);
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out string error), Is.True, error);
    }

    [Test]
    public void CorruptBytesAndConflictingMetadataDoNotBecomeResident()
    {
        using (PresentationTextureResidency textures = new PresentationTextureResidency())
        {
            byte[] changed = (byte[])Png.Clone();
            changed[60] ^= 1;
            Assert.That(textures.TryLoad(Binding("asset:a"), Access("asset:a"), changed, out _), Is.False);
            Assert.That(textures.ResidentGpuBytes, Is.Zero);
            TextureResidencyBinding wrong = Binding("asset:a");
            wrong.PixelSize.Width = 2;
            Assert.That(textures.TryLoad(wrong, Access("asset:a"), Png, out _), Is.False);
            Assert.That(textures.ResidentGpuBytes, Is.Zero);
        }
    }

    [Test]
    public void ResidencyReadinessFallsWhenAnUploadedTextureIsLost()
    {
        using (PresentationTextureResidency textures = new PresentationTextureResidency())
        {
            Assert.That(textures.TryLoad(Binding("asset:a"), Access("asset:a"), Png, out string error), Is.True, error);
            Assert.That(textures.IsReady(new[] { Binding("asset:a") }), Is.True);
            Assert.That(textures.TryGet(Binding("asset:a").Checksum, out Texture2D texture), Is.True);
            UnityEngine.Object.DestroyImmediate(texture);
            Assert.That(textures.IsReady(new[] { Binding("asset:a") }), Is.False);
        }
    }

    internal static DeliveryManifest BakedDelivery()
    {
        DeliveryManifest manifest = JsonParser.Default.Parse<DeliveryManifest>(PresentationTestFixtures.Load("LocalDelivery").text);
        DeliveredRenderSurface surface = manifest.ProjectionProfile.RenderSurfaces[0];
        foreach (var semantic in manifest.ProjectionProfile.RuntimeCatalog.Surfaces)
            if (semantic.SurfaceId == surface.SemanticSurfaceId)
                semantic.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        surface.RendererKind = RendererKind.BakedWeb;
        surface.LogicalBounds = new LogicalBounds { Width = 1, Height = 1 };
        surface.ArtifactContractVersion = 1;
        BakedWebArtifact baked = new BakedWebArtifact { ArtifactId = surface.Artifacts[0].NativeUi.ArtifactId, ContractVersion = 1 };
        baked.RequiredFeatures.Add(new[] { BakedWebFeature.Png, BakedWebFeature.Srgb, BakedWebFeature.AlphaStraight });
        foreach (DeliveredStateBinding state in surface.StateBindings)
            baked.States.Add(new BakedWebStateTexture { StateId = state.StateId, Texture = new TextureArtifact { AssetId = "asset:texture", Checksum = Hash(Png), EncodedSizeBytes = 86, PixelSize = new PixelSize { Width = 1, Height = 1 }, AlphaMode = TextureAlphaMode.Straight, MipCount = 1, DecodedGpuBytes = 4 } });
        surface.Artifacts.Clear();
        surface.Artifacts.Add(new DeliveredArtifact { BakedWeb = baked });
        manifest.CapabilityProfile.Renderers.BakedWeb = new TextureCapability { Supported = true, ContractVersion = 1 };
        manifest.CapabilityProfile.Renderers.BakedWeb.Features.Add(baked.RequiredFeatures);
        manifest.CapabilityProfile.Limits = new CapabilityLimits { Texture = new TextureLimits { TierId = "test", MaxTextureWidth = 2048, MaxTextureHeight = 2048, MaxTexturePixels = 4194304, MaxTextureBindings = 256, MaxGpuBytes = 67108864, MaxSerialLoadCpuBytes = 67108864, MaxEncodedCacheBytes = 67108864, EncodedCacheReserveBytes = 1024 } };
        foreach (AssetAccessBinding asset in manifest.AssetAccess)
        {
            asset.Checksum = "sha256:" + new string('a', 64);
            asset.EncodedSizeBytes = 1;
            asset.MediaType = "model/gltf-binary";
        }
        manifest.AssetAccess.Add(Access("asset:texture"));
        manifest.Residency.Textures = new TextureResidencyPlan { BudgetTierId = "test", TotalDecodedGpuBytes = 4, MaximumPeakLoadCpuBytes = 94, InitialGroupId = "group:local", MaximumResidentGpuBytes = 4, MaximumResidentTextureBindings = 1, GroupWindows = { new TextureResidencyWindow { GroupId = "group:local", AssetIds = { "asset:texture" } } } };
        manifest.Residency.Textures.Textures.Add(Binding("asset:texture"));
        manifest.Residency.TotalSelectedEncodedBytes += 86;
        return manifest;
    }

    internal static AssetAccessBinding Access(string id)
    {
        return new AssetAccessBinding { AssetId = id, Checksum = Hash(Png), MediaType = "image/png", EncodedSizeBytes = 86 };
    }

    private static string Hash(byte[] bytes)
    {
        using (SHA256 hash = SHA256.Create()) return "sha256:" + BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }
}

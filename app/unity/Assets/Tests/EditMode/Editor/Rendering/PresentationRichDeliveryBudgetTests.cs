using System.Reflection;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationRichDeliveryBudgetTests
{
    [Test]
    public void VideoBudgetCountsConcurrentSurfacesEvenWhenAssetsAreShared()
    {
        DeliveryManifest manifest = VideoManifest();
        Assert.That(Validate(manifest), Is.True);
        manifest.CapabilityProfile.Limits.Video.MaxConcurrentDecoders = 1;
        Assert.That(Validate(manifest), Is.False);
    }

    [Test]
    public void VideoStateAlternativesShareOneDecoderAndFrameBudget()
    {
        DeliveryManifest manifest = VideoManifest();
        var first = manifest.ProjectionProfile.RenderSurfaces[0];
        first.Artifacts.Add(manifest.ProjectionProfile.RenderSurfaces[1].Artifacts[0].Clone());
        manifest.ProjectionProfile.RenderSurfaces.RemoveAt(1);
        manifest.Residency.Video.MaximumConcurrentDecoders = 1;
        manifest.Residency.Video.MaximumDecodedFrameBytes = 4;
        manifest.CapabilityProfile.Limits.Video.MaxConcurrentDecoders = 1;
        Assert.That(Validate(manifest), Is.True);
    }

    [Test]
    public void MutuallyExclusiveGroupsShareOneDecoderAndFrameBudget()
    {
        DeliveryManifest manifest = VideoManifest();
        manifest.ProjectionProfile.RuntimeCatalog.Nodes[0].Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:a" } };
        manifest.ProjectionProfile.RuntimeCatalog.Nodes[1].Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:b" } };
        manifest.Residency.Video.MaximumConcurrentDecoders = 1;
        manifest.Residency.Video.MaximumDecodedFrameBytes = 4;
        manifest.CapabilityProfile.Limits.Video.MaxConcurrentDecoders = 1;
        Assert.That(Validate(manifest), Is.True);
        manifest.ProjectionProfile.RuntimeCatalog.Nodes[1].Owner.Group.GroupId = "group:a";
        Assert.That(Validate(manifest), Is.False);
    }

    [Test]
    public void VideoBudgetRejectsUnderstatedDecodedFramesAndEncodedBytes()
    {
        DeliveryManifest manifest = VideoManifest();
        manifest.Residency.Video.MaximumDecodedFrameBytes = 4;
        Assert.That(Validate(manifest), Is.False);
        manifest = VideoManifest();
        manifest.Residency.Video.TotalEncodedBytes = 1;
        Assert.That(Validate(manifest), Is.False);
    }

    [Test]
    public void VideoBudgetChecksPixelsBeforePreparingDecoder()
    {
        DeliveryManifest manifest = VideoManifest();
        manifest.CapabilityProfile.Limits.Video.MaxPixels = 1;
        Assert.That(Validate(manifest), Is.True);
        manifest.CapabilityProfile.Limits.Video.MaxWidth = 0;
        Assert.That(Validate(manifest), Is.False);
    }

    [Test]
    public void NativeBudgetChecksTextCountDepthAndRequiredFonts()
    {
        DeliveryManifest manifest = NativeManifest();
        Assert.That(Validate(manifest), Is.True);
        manifest.CapabilityProfile.Limits.NativeUi.MaxTreeDepth = 1;
        Assert.That(Validate(manifest), Is.False);
        manifest = NativeManifest();
        manifest.Residency.NativeUi.MaximumTextNodesPerArtifact = 0;
        Assert.That(Validate(manifest), Is.False);
        manifest = NativeManifest();
        manifest.Residency.NativeUi.FontAssetIds.Clear();
        Assert.That(Validate(manifest), Is.False);
    }

    [Test]
    public void NativeBudgetRejectsUndeclaredClipCapabilityAndWrongVariableType()
    {
        DeliveryManifest manifest = NativeManifest();
        manifest.CapabilityProfile.Renderers.NativeUi.Features.Clear();
        Assert.That(Validate(manifest), Is.False);
        manifest = NativeManifest();
        NativeUiText text = manifest.ProjectionProfile.RenderSurfaces[0].Artifacts[0].NativeUi.Nodes[1].Text;
        text.Value = new NativeTextValue { NumberVariable = new NumberVariableText { VariableId = "value" } };
        manifest.ProjectionProfile.RuntimeCatalog.Variables.Add(new ProjectedVariableDefinition { VariableId = "value", Type = ScalarType.String });
        Assert.That(Validate(manifest), Is.False);
    }

    private static DeliveryManifest NativeManifest()
    {
        DeliveryManifest manifest = VideoManifest();
        manifest.ProjectionProfile.RenderSurfaces.Clear();
        manifest.Residency.Video = new VideoResidencyPlan();
        manifest.AssetAccess.Clear();
        manifest.AssetAccess.Add(new AssetAccessBinding { AssetId = "font", Checksum = "font-checksum", MediaType = "font/ttf", EncodedSizeBytes = 10 });
        manifest.CapabilityProfile.Renderers.NativeUi = new NativeUiCapability { Supported = true, ContractVersion = 1, Features = { NativeUiFeature.Clip } };
        manifest.CapabilityProfile.Limits.NativeUi = new NativeUiLimits
        {
            TierId = "native",
            MaxNodesPerArtifact = 2,
            MaxTextNodesPerArtifact = 1,
            MaxTreeDepth = 2,
            MaxCodePointsPerText = 16,
            MaxFontAssets = 1,
            MaxGlyphs = 16
        };
        manifest.Residency.NativeUi = new NativeUiResidencyPlan
        {
            BudgetTierId = "native",
            MaximumNodesPerArtifact = 2,
            MaximumTextNodesPerArtifact = 1,
            MaximumTreeDepth = 2,
            MaximumCodePointsPerText = 16,
            FontAssetCount = 1,
            FontAssetIds = { "font" }
        };
        manifest.ProjectionProfile.RenderSurfaces.Add(new DeliveredRenderSurface
        {
            RendererKind = RendererKind.NativeUi,
            ArtifactContractVersion = 1,
            Artifacts = { new DeliveredArtifact { NativeUi = new NativeUiArtifact
            {
                ContractVersion = 1, RootNodeId = "root", RequiredFeatures = { NativeUiFeature.Clip },
                Nodes =
                {
                    new NativeUiNode { Group = new NativeUiGroup { NodeId = "root", Clip = true,
                        Bounds = new LogicalBounds { Width = 100, Height = 100 }, ChildNodeIds = { "text" } } },
                    new NativeUiNode { Text = new NativeUiText { NodeId = "text", Bounds = new LogicalBounds { Width = 100, Height = 100 },
                        Value = new NativeTextValue { Literal = new LiteralText { Value = "value" } },
                        Font = new ResolvedFont { Primary = new FontFace { AssetId = "font" } }, Color = new Unframe.Delivery.SrgbaColor { Alpha = 1 },
                        FontSize = 20, LineHeight = 24, Align = NativeTextAlign.Start, Overflow = NativeTextOverflow.Clip, MaxCodePoints = 16 } },
                },
            } } },
        });
        return manifest;
    }

    private static bool Validate(DeliveryManifest manifest)
    {
        var type = typeof(PresentationNativeSurfaceRenderer).Assembly.GetType("Unframe.Unity.PresentationRuntime.PresentationRichDeliveryValidation");
        object[] arguments = { manifest, null };
        return (bool)type.GetMethod("TryValidateRuntime", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, arguments);
    }

    private static DeliveryManifest VideoManifest()
    {
        var artifact = new VideoArtifact
        {
            ArtifactId = "video:one",
            ContractVersion = 1,
            VideoAssetId = "video",
            Checksum = "sha256:" + new string('a', 64),
            EncodedSizeBytes = 10,
            PixelSize = new PixelSize { Width = 1, Height = 1 },
            Codec = VideoCodec.H264,
            DurationMs = 1000,
        };
        var second = artifact.Clone();
        second.ArtifactId = "video:two";
        return new DeliveryManifest
        {
            ProjectionProfile = new ProjectionProfileDescriptor
            {
                RuntimeCatalog = new ProjectedRuntimeCatalog
                {
                    Nodes =
                    {
                        new ProjectedNodeDefinition { NodeId = "node:one", Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() } },
                        new ProjectedNodeDefinition { NodeId = "node:two", Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() } },
                    },
                    Surfaces =
                    {
                        new ProjectedSurfaceDefinition { SurfaceId = "surface:one", HostNodeId = "node:one" },
                        new ProjectedSurfaceDefinition { SurfaceId = "surface:two", HostNodeId = "node:two" },
                    },
                },
                RenderSurfaces =
                {
                    new DeliveredRenderSurface { SemanticSurfaceId = "surface:one", RendererKind = RendererKind.Video, ArtifactContractVersion = 1, Artifacts = { new DeliveredArtifact { Video = artifact } } },
                    new DeliveredRenderSurface { SemanticSurfaceId = "surface:two", RendererKind = RendererKind.Video, ArtifactContractVersion = 1, Artifacts = { new DeliveredArtifact { Video = second } } },
                },
            },
            CapabilityProfile = new CapabilityProfile
            {
                Renderers = new RendererCapabilities { Video = new VideoCapability { Supported = true, ContractVersion = 1, Features = { VideoFeature.H264 } } },
                Limits = new CapabilityLimits
                {
                    Video = new VideoLimits
                    { TierId = "video-test", MaxWidth = 1, MaxHeight = 1, MaxPixels = 1, MaxConcurrentDecoders = 2, MaxDecodedFrameBytes = 8, MaxEncodedBytes = 10 }
                }
            },
            AssetAccess = { new AssetAccessBinding { AssetId = "video", Checksum = "sha256:" + new string('a', 64), MediaType = "video/mp4", EncodedSizeBytes = 10 } },
            Residency = new ResidencyPlan
            {
                Video = new VideoResidencyPlan
                {
                    BudgetTierId = "video-test",
                    MaximumConcurrentDecoders = 2,
                    MaximumDecodedFrameBytes = 8,
                    TotalEncodedBytes = 10,
                    Videos = { new VideoResidencyBinding { AssetId = "video", Checksum = "sha256:" + new string('a', 64), EncodedSizeBytes = 10, DecodedFrameBytes = 4 } },
                }
            },
        };
    }
}

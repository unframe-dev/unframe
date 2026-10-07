using System;
using System.Security.Cryptography;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Preview;
using Unframe.Realtime;

public static class PresentationPreviewTestFixture
{
    public static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAABBJREFUeAEBBQD6/wD/AAD/BQAB//pciNEAAAAASUVORK5CYII=");

    public static LocalPreviewEnvelope Create(char request = 'a', bool texture = false)
    {
        var owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        var group = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:first" } };
        var catalog = new ProjectedRuntimeCatalog
        {
            CatalogContractVersion = 2,
            Nodes =
            {
                new ProjectedNodeDefinition { NodeId = "node:stage", Owner = owner, Parent = new SpatialParent { Stage = new StageParent() }, Container = new ContainerNode() },
                new ProjectedNodeDefinition { NodeId = "node:surface", Owner = group, Parent = new SpatialParent { Node = new NodeParent { NodeId = "node:stage" } }, Surface = new SurfaceNode { SemanticSurfaceId = "surface:one" } },
                new ProjectedNodeDefinition { NodeId = "node:other", Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:second" } }, Parent = new SpatialParent { Stage = new StageParent() }, Container = new ContainerNode() },
            },
            Surfaces = { new ProjectedSurfaceDefinition { SurfaceId = "surface:one", Owner = group, HostNodeId = "node:surface", LogicalSize = new Vector2 { X = 1, Y = 1 }, PhysicalSizeMeters = new Vector2 { X = 1, Y = 1 }, Fit = SurfaceFit.Contain, ReachableStateIds = { "state:first" } } },
        };
        var render = new DeliveredRenderSurface
        {
            RenderSurfaceId = "render:one",
            SemanticSurfaceId = "surface:one",
            RendererKind = RendererKind.BakedWeb,
            ArtifactContractVersion = 1,
            LogicalBounds = new LogicalBounds { Width = 1, Height = 1 },
            StateBindings = { new DeliveredStateBinding { StateId = "state:first", Empty = new EmptyStateBinding() } },
        };
        var envelope = new LocalPreviewEnvelope
        {
            SchemaVersion = 1,
            RequestId = new string(request, 32),
            BuildManifest = "{\"schemaVersion\":2,\"buildId\":\"build:" + request + "\"}",
            AssetSet = "{\"schemaVersion\":2,\"assets\":{}}",
            Projection = new LocalPreviewProjection
            {
                RuntimeCatalog = catalog,
                VisibleNodeIds = { "node:stage", "node:surface", "node:other" },
                VisibleSurfaceIds = { "surface:one" },
                RenderSurfaces = { render },
                SemanticSurfaces = { new ProjectedSemanticSurface { SemanticSurfaceId = "surface:one", RenderSurfaceIds = { "render:one" }, States = { new SurfaceSemanticState { StateId = "state:first" } } } },
                TextureResidency = new TextureResidencyPlan { BudgetTierId = "local-web-preview" },
            },
            InitialState = new LocalPreviewInitialState
            {
                NodeStates = { Node("node:stage"), Node("node:surface") },
                SurfaceStates = { new SurfaceRuntimeState { SurfaceId = "surface:one", StateId = "state:first" } },
            },
        };
        if (texture)
        {
            string hash;
            using (SHA256 sha = SHA256.Create()) hash = "sha256:" + BitConverter.ToString(sha.ComputeHash(Png)).Replace("-", "").ToLowerInvariant();
            var binding = new TextureResidencyBinding { AssetId = "asset:one", Checksum = hash, PixelSize = new PixelSize { Width = 1, Height = 1 }, DecodedGpuBytes = 4, PeakLoadCpuBytes = 94 };
            render.StateBindings[0].Artifact = new ArtifactStateBinding { ArtifactId = "artifact:one" };
            render.Artifacts.Add(new DeliveredArtifact
            {
                BakedWeb = new BakedWebArtifact
                {
                    ArtifactId = "artifact:one",
                    ContractVersion = 1,
                    RequiredFeatures = { BakedWebFeature.Png, BakedWebFeature.Srgb, BakedWebFeature.AlphaStraight },
                    States = { new BakedWebStateTexture { StateId = "state:first", Texture = new TextureArtifact { AssetId = "asset:one", Checksum = hash, EncodedSizeBytes = 86, PixelSize = binding.PixelSize.Clone(), DecodedGpuBytes = 4, MipCount = 1, AlphaMode = TextureAlphaMode.Straight } } },
                }
            });
            envelope.Projection.TextureResidency.Textures.Add(binding);
            envelope.Projection.TextureResidency.TotalDecodedGpuBytes = 4;
            envelope.Projection.TextureResidency.MaximumPeakLoadCpuBytes = 94;
            envelope.AssetSet = "{\"schemaVersion\":2,\"assets\":{\"asset:one\":{\"checksum\":\"" + hash + "\",\"mediaType\":\"image/png\",\"encodedSizeBytes\":86}}}";
            envelope.Assets.Add(new LocalPreviewAsset { AssetId = "asset:one", Reference = "opaque-asset-one" });
        }
        return envelope;
    }

    public static NodeRuntimeState Node(string id)
    {
        return new NodeRuntimeState
        {
            NodeId = id,
            Active = true,
            Visible = true,
            Opacity = 1,
            Transform = new Transform { Position = new Vector3(), Rotation = new Quaternion { W = 1 }, Scale = new Vector3 { X = 1, Y = 1, Z = 1 } },
        };
    }
}

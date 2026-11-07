using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationScenePlaybackEditModeTests
{
    [UnityTest]
    public IEnumerator ProductionScenePlaybackPausesAndRetainsTimelineTerminalPose()
    {
        CreateAssetFreeFixture(out DeliveryManifest manifest, out ControlServerItem snapshot);
        manifest.ProjectionProfile.RuntimeCatalog.Timelines.Add(new ProjectedTimelineDefinition
        {
            TimelineId = "timeline:production-move",
            DurationMs = 1000,
            Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
            Tracks =
            {
                new ProjectedTimelineTrack
                {
                    Target = new TimelineTrackTarget { NodeId = "node:opening-panel", Property = TimelineProperty.TransformPosition },
                    Keyframes =
                    {
                        new TimelineKeyframe { TimeMs = 0, EasingToNext = Easing.Linear, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3() } },
                        new TimelineKeyframe { TimeMs = 1000, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = 2 } } },
                    },
                },
            },
        });
        var view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        view.SurfaceStates.Clear();
        view.ActiveRuns.Clear();
        view.ActiveRuns.Add(new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:production-move", CauseEventId = "event:production-move" },
            Completion = RunCompletion.NonBlocking,
            Timeline = new TimelineRunSnapshot { TimelineId = "timeline:production-move" },
        });
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var root = new GameObject("production playback test");
        var hierarchy = new PresentationNodeHierarchy();
        var playback = new PresentationPlaybackPlayer();
        using (var renderer = new PresentationSceneRenderer())
        {
            try
            {
                Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
                Task load = renderer.LoadAsync(store, hierarchy,
                    (_, __) => Task.FromException<byte[]>(new AssertionException("The playback fixture has no external assets.")), CancellationToken.None);
                while (!load.IsCompleted) yield return null;
                load.GetAwaiter().GetResult();
                PresentationPlaybackPlayer.RendererRefresh refreshRenderer =
                    (double runtimeTime, out string renderError) => renderer.TryRefresh(store, runtimeTime, out renderError);
                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, 0, out error), Is.True, error);
                Assert.That(hierarchy.Registry.TryGet("node:opening-panel", out GameObject host), Is.True);
                var clock = new RuntimeClockSnapshot { RuntimeTimeMs = 0, Running = new Running() };
                double time = PresentationPlaybackPlayer.SampleRuntimeTimeMs(clock, 10, 10.5);
                Assert.That(playback.TryUpdate(store, hierarchy, refreshRenderer, time, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(1).Within(0.001));

                clock.RuntimeTimeMs = 500;
                clock.Paused = new Paused();
                time = PresentationPlaybackPlayer.SampleRuntimeTimeMs(clock, 11, 30);
                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, time, out error), Is.True, error);
                Assert.That(playback.TryUpdate(store, hierarchy, refreshRenderer, time, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(1).Within(0.001));

                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, 1000, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(2).Within(0.001));
                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, 1000, out error), Is.True, error);
                Assert.That(playback.TryUpdate(store, hierarchy, refreshRenderer, 3000, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(2).Within(0.001),
                    "Repeated authoritative snapshots must not restore the pre-animation pose while the completed run remains active.");
            }
            finally
            {
                playback.Clear();
                hierarchy.Clear();
                Object.DestroyImmediate(root);
            }
        }
    }
    [UnityTest]
    public IEnumerator GroupExitDefersRenderingUntilTheNextGroupEnters()
    {
        CreateAssetFreeFixture(out DeliveryManifest manifest, out ControlServerItem snapshot);
        manifest.Residency.Textures.GroupWindows.Add(new TextureResidencyWindow { GroupId = "group:next" });
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.SurfaceStates.Clear();
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ActiveRuns.Clear();
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var root = new GameObject("group transition playback test");
        var hierarchy = new PresentationNodeHierarchy();
        using (var renderer = new PresentationSceneRenderer())
        {
            try
            {
                Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
                Task load = renderer.LoadAsync(store, hierarchy,
                    (_, __) => Task.FromException<byte[]>(new AssertionException("The playback fixture has no external assets.")), CancellationToken.None);
                while (!load.IsCompleted) yield return null;
                load.GetAwaiter().GetResult();
                Assert.That(renderer.TryRefresh(store, 0, out error), Is.True, error);

                Assert.That(store.TryReceiveControl(new ControlServerItem
                {
                    ReliableEvent = new ProjectedReliableEvent
                    {
                        Sequence = 1,
                        Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                        GroupExited = new GroupExited { GroupId = "group:local", GroupEntryEpoch = 1 },
                    },
                }, out error), Is.True, error);
                Assert.That(store.Progression.CurrentGroupId, Is.Empty);
                Assert.That(renderer.TryRefresh(store, 0, out error), Is.True, error);
                Assert.That(error, Is.Null);
                Assert.That(renderer.HasResidentAssets(store), Is.True);
                yield return null;
                Assert.That(renderer.TryRefresh(store, 1, out error), Is.True, error);

                Assert.That(store.TryReceiveControl(new ControlServerItem
                {
                    ReliableEvent = new ProjectedReliableEvent
                    {
                        Sequence = 2,
                        Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                        GroupEntered = new GroupEntered
                        {
                            GroupId = "group:next",
                            GroupEntryEpoch = 2,
                            Initialization = new GroupRuntimeInitialization(),
                        },
                    },
                }, out error), Is.True, error);
                Assert.That(renderer.TryRefresh(store, 1, out error), Is.True, error);
                Assert.That(error, Is.Null);
                Assert.That(renderer.IsReady(store), Is.True);
            }
            finally
            {
                hierarchy.Clear();
                Object.DestroyImmediate(root);
            }
        }
    }

    [UnityTest]
    public IEnumerator SceneRefreshReusesPreparedPngAndReleasesTheCompletedGroupTexture()
    {
        CreateAssetFreeFixture(out DeliveryManifest manifest, out ControlServerItem snapshot);
        var bakedDelivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var render = bakedDelivery.ProjectionProfile.RenderSurfaces[0].Clone();
        string surfaceId = render.SemanticSurfaceId;
        foreach (var sourceSurface in bakedDelivery.ProjectionProfile.RuntimeCatalog.Surfaces)
            if (sourceSurface.SurfaceId == surfaceId)
            {
                manifest.ProjectionProfile.RuntimeCatalog.Surfaces.Add(sourceSurface.Clone());
                foreach (var source in bakedDelivery.ProjectionProfile.RuntimeCatalog.Nodes)
                    if (source.NodeId == sourceSurface.HostNodeId)
                        foreach (var target in manifest.ProjectionProfile.RuntimeCatalog.Nodes)
                            if (target.NodeId == source.NodeId) target.Surface = source.Surface.Clone();
            }
        foreach (var projection in bakedDelivery.ProjectionProfile.SemanticSurfaces)
            if (projection.SemanticSurfaceId == surfaceId) manifest.ProjectionProfile.SemanticSurfaces.Add(projection.Clone());
        manifest.ProjectionProfile.RenderSurfaces.Add(render);
        manifest.CapabilityProfile = bakedDelivery.CapabilityProfile.Clone();
        manifest.Residency.Textures = bakedDelivery.Residency.Textures.Clone();
        manifest.AssetAccess.Add(PresentationTextureResidencyEditModeTests.Access("asset:texture"));
        manifest.Residency.TotalSelectedEncodedBytes = 172;
        byte[] firstPng = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic).GetValue(null);
        byte[] nextPng = PresentationTexturePreloaderEditModeTests.PngVariant(180, out var nextBinding, out var nextAccess);
        manifest.AssetAccess.Add(nextAccess);
        var artifact = render.Artifacts[0].BakedWeb;
        var nextState = artifact.States[0].Clone(); nextState.StateId = "state:next";
        nextState.Texture.AssetId = nextBinding.AssetId; nextState.Texture.Checksum = nextBinding.Checksum;
        var nextRender = render.Clone(); nextRender.RenderSurfaceId = "render:next"; nextRender.SemanticSurfaceId = "surface:next";
        nextRender.Artifacts[0].BakedWeb.States.Clear(); nextRender.Artifacts[0].BakedWeb.States.Add(nextState);
        var nextStateBinding = render.StateBindings[0].Clone(); nextStateBinding.StateId = nextState.StateId;
        nextRender.StateBindings.Clear(); nextRender.StateBindings.Add(nextStateBinding);
        manifest.ProjectionProfile.RenderSurfaces.Add(nextRender);
        var semantic = manifest.ProjectionProfile.RuntimeCatalog.Surfaces[0];
        semantic.LogicalSize = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        semantic.PhysicalSizeMeters = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        semantic.Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:local" } };
        var nextSemantic = semantic.Clone(); nextSemantic.SurfaceId = nextRender.SemanticSurfaceId; nextSemantic.HostNodeId = "node:next";
        nextSemantic.Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:next" } };
        nextSemantic.ReachableStateIds.Clear(); nextSemantic.ReachableStateIds.Add(nextState.StateId);
        manifest.ProjectionProfile.RuntimeCatalog.Surfaces.Add(nextSemantic);
        ProjectedNodeDefinition nextHost = null;
        foreach (var node in manifest.ProjectionProfile.RuntimeCatalog.Nodes)
            if (node.NodeId == semantic.HostNodeId) { nextHost = node.Clone(); break; }
        Assert.That(nextHost, Is.Not.Null);
        nextHost.NodeId = nextSemantic.HostNodeId; nextHost.Surface.SemanticSurfaceId = nextSemantic.SurfaceId;
        nextHost.Owner = nextSemantic.Owner.Clone();
        manifest.ProjectionProfile.RuntimeCatalog.Nodes.Add(nextHost);
        var nextProjection = manifest.ProjectionProfile.SemanticSurfaces[0].Clone(); nextProjection.SemanticSurfaceId = nextSemantic.SurfaceId;
        nextProjection.RenderSurfaceIds.Clear(); nextProjection.RenderSurfaceIds.Add(nextRender.RenderSurfaceId);
        var semanticState = nextProjection.States[0].Clone(); semanticState.StateId = nextState.StateId;
        nextProjection.States.Clear(); nextProjection.States.Add(semanticState);
        manifest.ProjectionProfile.SemanticSurfaces.Add(nextProjection);
        manifest.Residency.Textures.Textures.Add(nextBinding);
        manifest.Residency.Textures.TotalDecodedGpuBytes = 8;
        manifest.Residency.Textures.GroupWindows.Add(new TextureResidencyWindow { GroupId = "group:next", AssetIds = { nextBinding.AssetId } });
        var initial = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        initial.ActiveRuns.Clear(); initial.SurfaceStates.Clear();
        initial.SurfaceStates.Add(new SurfaceRuntimeState { SurfaceId = surfaceId, StateId = artifact.States[0].StateId });
        NodeRuntimeState nextHostState = null;
        foreach (var node in initial.NodeStates) if (node.NodeId == semantic.HostNodeId) { nextHostState = node.Clone(); break; }
        Assert.That(nextHostState, Is.Not.Null); nextHostState.NodeId = nextHost.NodeId;
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var root = new GameObject("PNG forward preload scene");
        var hierarchy = new PresentationNodeHierarchy();
        using (var renderer = new PresentationSceneRenderer())
        {
            try
            {
                Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
                Task load = renderer.LoadAsync(store, hierarchy, (asset, _) => Task.FromResult(asset.AssetId == nextBinding.AssetId ? nextPng : firstPng), CancellationToken.None);
                while (!load.IsCompleted) yield return null;
                load.GetAwaiter().GetResult();
                Assert.That(renderer.TryRefresh(store, 0, out error), Is.True, error);
                Assert.That(renderer.Textures.TryGet(manifest.Residency.Textures.Textures[0].Checksum, out Texture2D previous), Is.True);
                var wait = System.Diagnostics.Stopwatch.StartNew();
                while (wait.Elapsed.TotalSeconds < 5 && !renderer.Textures.TryGet(nextBinding.Checksum, out _)) yield return null;
                Assert.That(renderer.Textures.TryGet(nextBinding.Checksum, out Texture2D prepared), Is.True);
                Assert.That(store.TryReceiveControl(new ControlServerItem
                {
                    ReliableEvent = new ProjectedReliableEvent
                    {
                        Sequence = 1,
                        Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                        GroupExited = new GroupExited { GroupId = "group:local", GroupEntryEpoch = 1 },
                    }
                }, out error), Is.True, error);
                Assert.That(store.TryReceiveControl(new ControlServerItem
                {
                    ReliableEvent = new ProjectedReliableEvent
                    {
                        Sequence = 2,
                        Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                        GroupEntered = new GroupEntered
                        {
                            GroupId = "group:next",
                            GroupEntryEpoch = 2,
                            Initialization = new GroupRuntimeInitialization
                            {
                                NodeStates = { nextHostState },
                                SurfaceStates = { new SurfaceRuntimeState { SurfaceId = nextSemantic.SurfaceId, StateId = nextState.StateId } },
                            },
                        },
                    }
                }, out error), Is.True, error);
                Assert.That(renderer.TryRefresh(store, 1, out error), Is.True, error);
                Assert.That(renderer.Textures.TryGet(nextBinding.Checksum, out Texture2D current), Is.True);
                Assert.That(current, Is.SameAs(prepared));
                Assert.That(previous == null, Is.True);
                Assert.That(renderer.Textures.ResidentGpuBytes, Is.EqualTo(4));
            }
            finally { hierarchy.Clear(); Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator VideoReservationsDoNotConsumeThePngTextureWindowBudget()
    {
        CreateAssetFreeFixture(out DeliveryManifest manifest, out ControlServerItem snapshot);
        var bakedDelivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var render = bakedDelivery.ProjectionProfile.RenderSurfaces[0].Clone();
        foreach (var surface in bakedDelivery.ProjectionProfile.RuntimeCatalog.Surfaces)
            if (surface.SurfaceId == render.SemanticSurfaceId)
            {
                manifest.ProjectionProfile.RuntimeCatalog.Surfaces.Add(surface.Clone());
                foreach (var source in bakedDelivery.ProjectionProfile.RuntimeCatalog.Nodes)
                    if (source.NodeId == surface.HostNodeId)
                        foreach (var target in manifest.ProjectionProfile.RuntimeCatalog.Nodes)
                            if (target.NodeId == source.NodeId) target.Surface = source.Surface.Clone();
            }
        foreach (var projection in bakedDelivery.ProjectionProfile.SemanticSurfaces)
            if (projection.SemanticSurfaceId == render.SemanticSurfaceId)
                manifest.ProjectionProfile.SemanticSurfaces.Add(projection.Clone());
        manifest.ProjectionProfile.RenderSurfaces.Add(render);
        manifest.CapabilityProfile = bakedDelivery.CapabilityProfile.Clone();
        manifest.CapabilityProfile.Limits.Texture.MaxGpuBytes = 4;
        manifest.CapabilityProfile.Limits.Texture.MaxTextureBindings = 1;
        manifest.Residency.Textures = bakedDelivery.Residency.Textures.Clone();
        manifest.AssetAccess.Add(PresentationTextureResidencyEditModeTests.Access("asset:texture"));
        byte[] png = (byte[])typeof(PresentationTextureResidencyEditModeTests).GetField("Png", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic).GetValue(null);
        byte[] video = PresentationTestFixtures.Load("Video").bytes;
        string checksum;
        using (var hash = System.Security.Cryptography.SHA256.Create())
            checksum = "sha256:" + System.BitConverter.ToString(hash.ComputeHash(video)).Replace("-", "").ToLowerInvariant();
        var artifact = new VideoArtifact
        {
            ArtifactId = "artifact:video",
            ContractVersion = 1,
            VideoAssetId = "asset:video",
            Checksum = checksum,
            EncodedSizeBytes = (ulong)video.Length,
            Codec = VideoCodec.H264,
            PixelSize = new PixelSize { Width = 320, Height = 180 },
            DurationMs = 6000,
            HasAudio = true,
            Fit = SurfaceFit.Contain,
            RequiredFeatures = { VideoFeature.H264, VideoFeature.Audio },
        };
        var videoRender = render.Clone();
        videoRender.RenderSurfaceId = "render:video";
        videoRender.SemanticSurfaceId = "surface:video";
        videoRender.RendererKind = RendererKind.Video;
        videoRender.Artifacts.Clear(); videoRender.Artifacts.Add(new DeliveredArtifact { Video = artifact });
        foreach (var binding in videoRender.StateBindings) binding.Artifact.ArtifactId = artifact.ArtifactId;
        manifest.ProjectionProfile.RenderSurfaces.Add(videoRender);
        var pngSemantic = manifest.ProjectionProfile.RuntimeCatalog.Surfaces[0];
        pngSemantic.LogicalSize = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        pngSemantic.PhysicalSizeMeters = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        var semantic = pngSemantic.Clone();
        string pngHost = semantic.HostNodeId;
        semantic.SurfaceId = videoRender.SemanticSurfaceId; semantic.HostNodeId = "node:video";
        semantic.Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:video" } };
        manifest.ProjectionProfile.RuntimeCatalog.Surfaces.Add(semantic);
        foreach (var source in bakedDelivery.ProjectionProfile.RuntimeCatalog.Nodes)
            if (source.NodeId == pngHost)
            {
                var host = source.Clone(); host.NodeId = semantic.HostNodeId; host.Owner = semantic.Owner.Clone();
                host.Surface.SemanticSurfaceId = semantic.SurfaceId;
                manifest.ProjectionProfile.RuntimeCatalog.Nodes.Add(host);
            }
        var videoProjection = manifest.ProjectionProfile.SemanticSurfaces[0].Clone();
        videoProjection.SemanticSurfaceId = semantic.SurfaceId;
        videoProjection.RenderSurfaceIds.Clear(); videoProjection.RenderSurfaceIds.Add(videoRender.RenderSurfaceId);
        manifest.ProjectionProfile.SemanticSurfaces.Add(videoProjection);
        manifest.CapabilityProfile.Renderers.Video = new VideoCapability
        { Supported = true, ContractVersion = 1, Features = { VideoFeature.H264, VideoFeature.Audio } };
        manifest.CapabilityProfile.Limits.Video = new VideoLimits
        {
            TierId = "video-test",
            MaxWidth = 320,
            MaxHeight = 180,
            MaxPixels = 320 * 180,
            MaxConcurrentDecoders = 1,
            MaxDecodedFrameBytes = 320 * 180 * 4,
            MaxEncodedBytes = (ulong)video.Length,
        };
        manifest.AssetAccess.Add(new AssetAccessBinding
        { AssetId = artifact.VideoAssetId, Checksum = checksum, EncodedSizeBytes = (ulong)video.Length, MediaType = "video/mp4" });
        manifest.Residency.Video = new VideoResidencyPlan
        {
            BudgetTierId = "video-test",
            MaximumConcurrentDecoders = 1,
            MaximumDecodedFrameBytes = 320 * 180 * 4,
            TotalEncodedBytes = (ulong)video.Length,
            Videos = { new VideoResidencyBinding { AssetId = artifact.VideoAssetId, Checksum = checksum,
                EncodedSizeBytes = (ulong)video.Length, DecodedFrameBytes = 320 * 180 * 4 } },
        };
        manifest.Residency.TotalSelectedEncodedBytes = (ulong)png.Length + (ulong)video.Length;
        var initial = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        initial.ActiveRuns.Clear(); initial.SurfaceStates.Clear();
        initial.SurfaceStates.Add(new SurfaceRuntimeState
        { SurfaceId = render.SemanticSurfaceId, StateId = render.Artifacts[0].BakedWeb.States[0].StateId });
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var root = new GameObject("independent video and PNG budgets");
        var hierarchy = new PresentationNodeHierarchy();
        using (var renderer = new PresentationSceneRenderer())
        {
            try
            {
                Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
                Task load = renderer.LoadAsync(store, hierarchy,
                    (asset, _) => Task.FromResult(asset.AssetId == artifact.VideoAssetId ? video : png), CancellationToken.None);
                while (!load.IsCompleted) yield return null;
                load.GetAwaiter().GetResult();
                Assert.That(renderer.TryRefresh(store, 0, out error), Is.True, error);
                Assert.That(renderer.Textures.ResidentGpuBytes, Is.EqualTo(4));
                Assert.That(renderer.IsReady(store), Is.True);
            }
            finally { hierarchy.Clear(); Object.DestroyImmediate(root); }
        }
    }

    private static void CreateAssetFreeFixture(out DeliveryManifest manifest, out ControlServerItem snapshot)
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out manifest, out string error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
            out snapshot, out error), Is.True, error);
        manifest.AssetAccess.Clear();
        manifest.CapabilityProfile.Limits = new CapabilityLimits();
        manifest.Residency.Models = new ModelResidencyPlan();
        manifest.Residency.Textures = new TextureResidencyPlan { InitialGroupId = "group:local", GroupWindows = { new TextureResidencyWindow { GroupId = "group:local" } } };
        manifest.ProjectionProfile.RenderSurfaces.Clear();
        manifest.ProjectionProfile.SemanticSurfaces.Clear();
        manifest.ProjectionProfile.RuntimeCatalog.Surfaces.Clear();
        foreach (ProjectedNodeDefinition node in manifest.ProjectionProfile.RuntimeCatalog.Nodes)
            if (node.Model != null || node.Surface != null) node.Container = new ContainerNode();
        manifest.ProjectionProfile.RuntimeCatalog.ModelClips.Clear();
        manifest.ProjectionProfile.RuntimeCatalog.Timelines.Clear();
    }

}

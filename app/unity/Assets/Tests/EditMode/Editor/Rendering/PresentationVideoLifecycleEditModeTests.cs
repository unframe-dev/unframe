using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Preview;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationVideoLifecycleEditModeTests
{
    private sealed class Decoder : IPresentationVideoDecoder
    {
        internal readonly TaskCompletionSource<bool> Gate = new TaskCompletionSource<bool>();
        internal bool Disposed, Fail, Playing;
        internal double Seconds;
        public Texture Texture => Texture2D.blackTexture;
        public bool IsPrepared => Gate.Task.IsCompleted && !Disposed;
        public async Task PrepareAsync(VideoArtifact artifact, string url, CancellationToken token) { await Gate.Task; if (Fail) throw new InvalidOperationException("test-decoder-failed"); }
        public bool TryApply(bool playing, double seconds, out string error) { Playing = playing; Seconds = seconds; error = null; return !Disposed; }
        public void Pause() { Playing = false; }
        public void Dispose() { Disposed = true; }
    }
    private sealed class View : IPresentationRenderView
    {
        internal int Current;
        internal bool MediaPlaying;
        internal readonly List<DeliveredRenderSurface> Renders = new List<DeliveredRenderSurface>();
        public ProjectedRuntimeCatalog Catalog { get; } = new ProjectedRuntimeCatalog();
        public IEnumerable<DeliveredRenderSurface> RenderSurfaces => Renders;
        public IEnumerable<ProjectedSemanticSurface> SemanticSurfaces => Array.Empty<ProjectedSemanticSurface>();
        public Unframe.Presentation.Pose StageOrigin => new Unframe.Presentation.Pose { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } };
        public IEnumerable<RuntimeRunSnapshot> ActiveRuns => Array.Empty<RuntimeRunSnapshot>();
        public bool TryGetSurface(string id, out ProjectedSurfaceDefinition value) { foreach (var s in Catalog.Surfaces) if (s.SurfaceId == id) { value = s; return true; } value = null; return false; }
        public bool TryGetNodeState(string id, out NodeRuntimeState value) { value = id == "node:" + Current ? PresentationPreviewTestFixture.Node(id) : null; return value != null; }
        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { value = id == "surface:" + Current ? new SurfaceRuntimeState { SurfaceId = id, StateId = "state:default" } : null; return value != null; }
        public bool TryGetAnchorSample(string id, out ProjectedAnchorBindingSample value) { value = null; return false; }
        public bool TryGetMediaState(string id, out MediaRuntimeState value) { value = new MediaRuntimeState { SurfaceId = id, Stopped = new MediaStoppedState() }; if (MediaPlaying) value.Active = new MediaActive { Playback = new PlaybackClock { Playing = new PlayingClock() } }; return true; }
        public bool TryGetModelClipState(string id, out ModelClipRuntimeState value) { value = null; return false; }
    }
    private static LocalPreviewEnvelope VideoEnvelope()
    {
        byte[] bytes = Resources.Load<TextAsset>("PresentationFixtures/Video").bytes;
        string checksum; using (var sha = SHA256.Create()) checksum = "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        var envelope = PresentationPreviewTestFixture.Create();
        var surface = envelope.Projection.RuntimeCatalog.Surfaces[0]; surface.ReachableStateIds.Add("state:loop"); surface.ReachableStateIds.Add("state:hidden");
        envelope.Projection.SemanticSurfaces[0].States.Add(new SurfaceSemanticState { StateId = "state:loop" });
        envelope.Projection.SemanticSurfaces[0].States.Add(new SurfaceSemanticState { StateId = "state:hidden" });
        var render = envelope.Projection.RenderSurfaces[0]; render.RendererKind = RendererKind.Video; render.Artifacts.Clear(); render.StateBindings.Clear();
        var artifact = new VideoArtifact
        {
            ArtifactId = "artifact:one",
            ContractVersion = 1,
            VideoAssetId = "video:one",
            Checksum = checksum,
            EncodedSizeBytes = (ulong)bytes.Length,
            Codec = VideoCodec.H264,
            PixelSize = new PixelSize { Width = 320, Height = 180 },
            DurationMs = 6000,
            HasAudio = true,
            Fit = SurfaceFit.Contain,
            RequiredFeatures = { VideoFeature.H264, VideoFeature.Audio }
        };
        render.Artifacts.Add(new DeliveredArtifact { Video = artifact }); var loop = artifact.Clone(); loop.ArtifactId = "artifact:loop"; loop.Loop = true; loop.Fit = SurfaceFit.Cover;
        render.Artifacts.Add(new DeliveredArtifact { Video = loop });
        render.StateBindings.Add(new DeliveredStateBinding { StateId = "state:first", Artifact = new ArtifactStateBinding { ArtifactId = artifact.ArtifactId } });
        render.StateBindings.Add(new DeliveredStateBinding { StateId = "state:loop", Artifact = new ArtifactStateBinding { ArtifactId = loop.ArtifactId } });
        render.StateBindings.Add(new DeliveredStateBinding { StateId = "state:hidden", Empty = new EmptyStateBinding() });
        envelope.AssetSet = "{\"schemaVersion\":2,\"assets\":{\"video:one\":{\"checksum\":\"" + checksum + "\",\"mediaType\":\"video/mp4\",\"encodedSizeBytes\":" + bytes.Length + "}}}";
        envelope.Assets.Add(new Unframe.Preview.LocalPreviewAsset { AssetId = "video:one", Reference = "video-reference" });
        envelope.Projection.VideoResidency = new VideoResidencyPlan
        {
            BudgetTierId = "local-web-preview",
            Videos = { new VideoResidencyBinding {
            AssetId = "video:one", Checksum = checksum, EncodedSizeBytes = (ulong)bytes.Length, DecodedFrameBytes = 320 * 180 * 4 } }
        };
        return envelope;
    }
    [Test]
    public void PreviewAcceptsMultipleVideoArtifactsAndEmptyStateBindings()
    {
        Assert.That(PresentationLocalPreviewAdapter.TryCreate(VideoEnvelope(), out _, out var error), Is.True, error);
    }
    [UnityTest]
    public IEnumerator InvalidationPausesTheCommittedDecoderWithoutDiscardingItsFrame()
    {
        var envelope = VideoEnvelope(); var decoder = new Decoder(); decoder.Gate.SetResult(true);
        var root = new GameObject("Video invalidation");
        using (var transaction = new PresentationPreviewTransaction(root.transform, () => decoder))
        {
            var bytes = Resources.Load<TextAsset>("PresentationFixtures/Video").bytes;
            var prepare = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(bytes, "video/mp4")), CancellationToken.None);
            while (!prepare.IsCompleted) yield return null;
            Assert.That(prepare.IsFaulted, Is.False, prepare.Exception?.ToString()); transaction.Commit(envelope.RequestId);
            var playback = new LocalPreviewPlaybackState
            {
                RequestId = envelope.RequestId,
                Sequence = 1,
                CurrentGroupId = "group:first",
                Clock = new RuntimeClockSnapshot { Running = new Running() },
                NodeStates = { envelope.InitialState.NodeStates },
                SurfaceStates = { envelope.InitialState.SurfaceStates }
            };
            var runId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 }; var clock = new PlaybackClock { Playing = new PlayingClock() };
            playback.MediaStates.Add(new MediaRuntimeState { SurfaceId = "surface:one", Active = new MediaActive { RunId = runId, Playback = clock } });
            playback.ActiveRuns.Add(new RuntimeRunSnapshot
            {
                RunId = runId,
                Owner = new RuntimeRunOwner { Group = new GroupRunOwner { GroupId = "group:first", GroupEntryEpoch = 1 } },
                Cause = new RuntimeRunCause { CueId = "cue:video", CauseEventId = "event:video" },
                Completion = RunCompletion.NonBlocking,
                Media = new MediaRunSnapshot { SurfaceId = "surface:one", Playback = clock.Clone() }
            });
            Assert.That(transaction.TryPlayback(playback, 0, out var error), Is.True, error);
            Assert.That(decoder.Playing, Is.True);
            var renderer = root.GetComponentInChildren<MeshRenderer>(); Assert.That(renderer, Is.Not.Null);
            transaction.Invalidate();
            Assert.That(decoder.Playing, Is.False, "invalidating playback must stop the independent decoder and audio immediately");
            Assert.That(decoder.Disposed, Is.False); Assert.That(renderer != null, Is.True); Assert.That(transaction.LoadedRequestId, Is.EqualTo(envelope.RequestId));
        }
        UnityEngine.Object.DestroyImmediate(root);
    }
    [UnityTest]
    public IEnumerator SeparateGroupsUseOneDecoderAndLatePreparationCannotCommitAfterCancellation()
    {
        byte[] bytes = Resources.Load<TextAsset>("PresentationFixtures/Video").bytes;
        string checksum; using (var sha = SHA256.Create()) checksum = "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        var view = new View();
        for (int i = 0; i < 3; i++)
        {
            var owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:" + i } };
            view.Catalog.Nodes.Add(new ProjectedNodeDefinition { NodeId = "node:" + i, Owner = owner, Parent = new SpatialParent { Stage = new StageParent() }, Surface = new SurfaceNode { SemanticSurfaceId = "surface:" + i } });
            view.Catalog.Surfaces.Add(new ProjectedSurfaceDefinition
            {
                SurfaceId = "surface:" + i,
                HostNodeId = "node:" + i,
                Owner = owner,
                LogicalSize = new Unframe.Presentation.Vector2 { X = 1, Y = 1 },
                PhysicalSizeMeters = new Unframe.Presentation.Vector2 { X = 1, Y = 1 },
                Fit = SurfaceFit.Contain
            });
            view.Renders.Add(new DeliveredRenderSurface
            {
                RenderSurfaceId = "render:" + i,
                SemanticSurfaceId = "surface:" + i,
                RendererKind = RendererKind.Video,
                LogicalBounds = new LogicalBounds { Width = 1, Height = 1 },
                StateBindings = { new DeliveredStateBinding { StateId = "state:default", Artifact = new ArtifactStateBinding { ArtifactId = "artifact:" + i } } },
                Artifacts = { new DeliveredArtifact { Video = new VideoArtifact {
                    ArtifactId = "artifact:" + i, VideoAssetId = "video:one", Checksum = checksum, EncodedSizeBytes = (ulong)bytes.Length,
                    Codec = VideoCodec.H264, PixelSize = new PixelSize { Width = 320, Height = 180 }, DurationMs = 6000, HasAudio = true, Fit = SurfaceFit.Contain } } }
            });
        }
        var root = new GameObject("Video groups"); var hierarchy = new PresentationNodeHierarchy();
        Assert.That(hierarchy.TryReplace(view, root.transform, out var error), Is.True, error);
        var decoders = new List<Decoder>();
        string[] before = Directory.GetFiles(Application.temporaryCachePath, "unframe-video-*.mp4");
        var videos = new PresentationVideoResidency(() => { var decoder = new Decoder(); decoders.Add(decoder); return decoder; });
        videos.Limits.MaxConcurrentDecoders = 1;
        videos.Limits.MaxEncodedBytes = (ulong)bytes.Length;
        Task build = videos.BuildAsync(view, hierarchy, (_, __) => Task.FromResult(new PresentationPreviewAssetData(bytes, "video/mp4")), CancellationToken.None);
        while (decoders.Count == 0) yield return null;
        Assert.That(decoders.Count, Is.EqualTo(1)); Assert.That(videos.IsReady(view), Is.False);
        view.Current = 1; Assert.That(videos.TryUpdate(view, 0, out error), Is.True, error);
        Assert.That(decoders[0].Disposed, Is.True);
        decoders[0].Gate.SetResult(true);
        while (decoders.Count < 2) yield return null;
        decoders[1].Gate.SetResult(true);
        while (!build.IsCompleted) yield return null;
        Assert.That(build.IsFaulted, Is.False, build.Exception?.ToString()); Assert.That(videos.IsReady(view), Is.True);
        using (var renderer = new PresentationBakedSurfaceRenderer())
        using (var textures = new PresentationTextureResidency())
        {
            Assert.That(renderer.TryBuild(view, hierarchy, out error), Is.True, error);
            var playback = new PresentationPlaybackPlayer { Videos = videos }; view.MediaPlaying = true;
            Assert.That(playback.TryUpdate(view, hierarchy, renderer, textures, 1000, out error, true), Is.True, error);
            Assert.That(decoders[1].Playing, Is.True); Assert.That(decoders[1].Seconds, Is.EqualTo(1));
            Assert.That(playback.TryUpdate(view, hierarchy, renderer, textures, 1250, out error, false), Is.True, error);
            Assert.That(decoders[1].Playing, Is.False, "session pause stops the physical decoder and audio even while the media clock is playing");
            Assert.That(decoders[1].Seconds, Is.EqualTo(1.25));
            Assert.That(playback.TryUpdate(view, hierarchy, renderer, textures, 1250, out error, false), Is.True, error);
            Assert.That(decoders[1].Playing, Is.False); Assert.That(decoders[1].Seconds, Is.EqualTo(1.25));
            Assert.That(playback.TryUpdate(view, hierarchy, renderer, textures, 1500, out error, true), Is.True, error);
            Assert.That(decoders[1].Playing, Is.True); Assert.That(decoders[1].Seconds, Is.EqualTo(1.5));
            view.MediaPlaying = false;
        }
        view.Current = 2; Assert.That(videos.TryUpdate(view, 0, out error), Is.True, error);
        while (decoders.Count < 3) yield return null;
        Assert.That(decoders[1].Disposed, Is.True); Assert.That(videos.IsReady(view), Is.False);
        decoders[2].Fail = true; decoders[2].Gate.SetResult(true); yield return null; yield return null;
        Assert.That(videos.TryUpdate(view, 0, out error), Is.False); Assert.That(error, Is.EqualTo("test-decoder-failed"));
        view.Current = 0; Assert.That(videos.TryUpdate(view, 0, out error), Is.True, error);
        while (decoders.Count < 4) yield return null;
        videos.Dispose(); decoders[3].Gate.SetResult(true); yield return null; yield return null;
        Assert.That(decoders.TrueForAll(decoder => decoder.Disposed), Is.True);
        Assert.That(root.GetComponentsInChildren<MeshRenderer>(true), Is.Empty);
        foreach (string file in Directory.GetFiles(Application.temporaryCachePath, "unframe-video-*.mp4")) Assert.That(before, Does.Contain(file), "owned temporary video files are removed");
        hierarchy.Clear(); UnityEngine.Object.DestroyImmediate(root);
    }
}

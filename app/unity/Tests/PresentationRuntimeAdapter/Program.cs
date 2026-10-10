using System;
using System.IO;
using Google.Protobuf;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1)
            {
                var store = new PresentationRuntimeDataStore();
                Require(store.TryReceiveDelivery(File.ReadAllBytes(args[0]), out string error), error);
                Console.WriteLine("External Delivery admission passed.");
                return 0;
            }
            Require(args.Length == 0, "Expected at most one Delivery protobuf path.");
            CheckPreviewAdmission();
            CheckPreviewAdapter();
            CheckRenderView();
            CheckBinaryDeliveryAndAssetDescriptor();
            CheckOriginFenceAndUnsupportedEvent();
            CheckFullSnapshotCut();
            CheckRunStateClosure();
            CheckLoopingModelPosition();
            Console.WriteLine("Presentation Runtime adapter checks passed.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception);
            return 1;
        }
    }

    private static void CheckPreviewAdmission()
    {
        const ulong mib = 1024 * 1024;
        TextureResidencyBinding a = PreviewTexture('a', 64 * mib, 64 * mib);
        Require(PresentationPreviewAdmission.TryAdmit(Array.Empty<TextureResidencyBinding>(), new[] { a }, out string error), error);
        Require(PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { a.Clone() }, out error), error);
        TextureResidencyBinding overGpu = a.Clone();
        overGpu.DecodedGpuBytes++;
        Require(!PresentationPreviewAdmission.TryAdmit(Array.Empty<TextureResidencyBinding>(), new[] { overGpu }, out _), "scene GPU +1 must fail");
        TextureResidencyBinding overCpu = a.Clone();
        overCpu.PeakLoadCpuBytes++;
        Require(!PresentationPreviewAdmission.TryAdmit(Array.Empty<TextureResidencyBinding>(), new[] { overCpu }, out _), "load CPU +1 must fail");
        TextureResidencyBinding b = PreviewTexture('b', 32 * mib, 48 * mib);
        Require(PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { b }, out error), error);
        b.DecodedGpuBytes++;
        Require(!PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { b }, out _), "overlap GPU +1 must fail although each scene fits");
        TextureResidencyBinding c = PreviewTexture('c', 32 * mib, 48 * mib);
        Require(PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { c, c.Clone() }, out error), error);
        TextureResidencyBinding conflict = a.Clone();
        conflict.PixelSize.Width++;
        Require(!PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { conflict }, out _), "shared checksum metadata conflict must fail");
        conflict = a.Clone();
        conflict.PeakLoadCpuBytes++;
        Require(!PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { conflict }, out _), "shared checksum CPU metadata conflict must fail");
        TextureResidencyBinding changedAssetId = a.Clone();
        changedAssetId.AssetId = "asset:another-reference";
        Require(PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { changedAssetId }, out error), error);
        Require(!PresentationPreviewAdmission.TryAdmit(Array.Empty<TextureResidencyBinding>(), new[] { a, conflict }, out _),
            "duplicate checksum metadata conflict within one scene must fail");
        TextureResidencyBinding huge = a.Clone();
        huge.DecodedGpuBytes = ulong.MaxValue;
        Require(!PresentationPreviewAdmission.TryAdmit(new[] { a }, new[] { huge }, out _), "budget accounting must reject overflow-sized costs");
        TextureResidencyBinding serialA = PreviewTexture('d', 16 * mib, 48 * mib);
        TextureResidencyBinding serialB = PreviewTexture('e', 16 * mib, 48 * mib);
        Require(PresentationPreviewAdmission.TryAdmit(Array.Empty<TextureResidencyBinding>(), new[] { serialA, serialB }, out error),
            "serial CPU accounting must use the maximum load peak, not their sum: " + error);
        var canonical = new TextureResidencyBinding[7];
        for (int i = 0; i < canonical.Length; i++)
            canonical[i] = PreviewTexture((char)('a' + i), 16777216, 50335057);
        Require(PresentationPreviewAdmission.TryAdmit(Array.Empty<TextureResidencyBinding>(),
            new[] { canonical[0], canonical[1], canonical[2], canonical[3] }, out error), error);
        Require(PresentationPreviewAdmission.TryAdmit(new[] { canonical[0], canonical[1], canonical[2], canonical[3] },
            new[] { canonical[2], canonical[3], canonical[4], canonical[5] }, out error), error);
        Require(!PresentationPreviewAdmission.TryAdmit(new[] { canonical[0], canonical[1], canonical[2], canonical[3] },
            new[] { canonical[3], canonical[4], canonical[5], canonical[6] }, out _), "seven canonical 2048 textures exceed the overlap budget");
    }

    private static TextureResidencyBinding PreviewTexture(char hash, ulong gpu, ulong cpu)
    {
        return new TextureResidencyBinding
        {
            AssetId = "asset:" + hash,
            Checksum = "sha256:" + new string(hash, 64),
            PixelSize = new Unframe.Delivery.PixelSize { Width = 2048, Height = 2048 },
            DecodedGpuBytes = gpu,
            PeakLoadCpuBytes = cpu,
        };
    }

    private static void CheckPreviewAdapter()
    {
        var envelope = PresentationPreviewTestFixture.Create(texture: true);
        Require(PresentationLocalPreviewAdapter.TryCreate(envelope, out PresentationLocalPreviewInput input, out string error), error);
        Require(input.BuildIdentity == "build:a" && input.SourceRevision == null, "Dist identity must not invent a Source revision.");
        Require(input.StageOrigin.Rotation.W == 1 && !input.TryGetNodeState("node:other", out _), "Other Group must remain inactive.");
        envelope.InitialState.NodeStates[0].Opacity = 0.2;
        Require(input.TryGetNodeState("node:stage", out NodeRuntimeState original) && original.Opacity == 1, "Input must own a fixed envelope snapshot.");
        var invalid = PresentationPreviewTestFixture.Create();
        invalid.InitialState.NodeStates.Add(PresentationPreviewTestFixture.Node("node:other"));
        Require(!PresentationLocalPreviewAdapter.TryCreate(invalid, out _, out _), "Initial state must not activate multiple Groups.");
        invalid = PresentationPreviewTestFixture.Create();
        invalid.InitialState.NodeStates.RemoveAt(0);
        Require(!PresentationLocalPreviewAdapter.TryCreate(invalid, out _, out _), "Presentation-owned node state must be complete.");
        invalid = PresentationPreviewTestFixture.Create();
        invalid.Projection.RuntimeCatalog.Nodes[0].Parent.Node = new NodeParent { NodeId = "node:surface" };
        Require(!PresentationLocalPreviewAdapter.TryCreate(invalid, out _, out _), "Spatial cycles must be rejected before creating objects.");
        invalid = PresentationPreviewTestFixture.Create(texture: true);
        invalid.Projection.TextureResidency.Textures[0].PeakLoadCpuBytes++;
        Require(!PresentationLocalPreviewAdapter.TryCreate(invalid, out _, out _), "Declared texture cost must match canonical metadata.");
        invalid = PresentationPreviewTestFixture.Create();
        invalid.Projection.RenderSurfaces[0].RendererKind = RendererKind.NativeUi;
        Require(!PresentationLocalPreviewAdapter.TryCreate(invalid, out _, out _), "Unsupported renderers must be rejected.");
        invalid = PresentationPreviewTestFixture.Create();
        invalid.AssetSet = "{";
        Require(!PresentationLocalPreviewAdapter.TryCreate(invalid, out _, out _), "Malformed canonical JSON must be rejected.");
    }

    private static void CheckRenderView()
    {
        var store = new PresentationRuntimeDataStore();
        Require(store.TryReceiveDelivery(LoadDelivery(), out string error), error);
        IPresentationRenderView view = store;
        Require(view.Catalog != null, "Accepted Delivery must expose a render catalog.");
        Require(view.StageOrigin == null, "Delivery alone must not synthesize an origin.");
        ControlServerItem snapshot = LoadSnapshot();
        snapshot.ConnectionSnapshot.Fence.PresentationOriginVersion = 1;
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin
        {
            Version = 1,
            Pose = new Pose
            {
                Position = new Unframe.Presentation.Vector3 { X = 2, Y = 3, Z = 4 },
                Rotation = new Unframe.Presentation.Quaternion { W = 1 },
            },
        };
        Require(store.TryReceiveControl(snapshot, out error), error);
        Require(Equals(view.StageOrigin, snapshot.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin?.Pose),
            "Render origin must preserve the accepted pose without a publication fence.");
        foreach (NodeRuntimeState expected in snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates)
            Require(view.TryGetNodeState(expected.NodeId, out NodeRuntimeState actual) && actual.Equals(expected),
                "Render view must expose the accepted node state.");
        Require(view.TryGetSurface(view.Catalog.Surfaces[0].SurfaceId, out ProjectedSurfaceDefinition surface)
            && surface.Equals(view.Catalog.Surfaces[0]), "Render catalog surface lookup must remain consistent.");
        ControlServerItem wrongFence = snapshot.Clone();
        wrongFence.ConnectionSnapshot.Fence.Publication.PublicationEpoch++;
        Require(!store.TryReceiveControl(wrongFence, out _), "Render view must not bypass production fence admission.");
    }

    private static void CheckBinaryDeliveryAndAssetDescriptor()
    {
        DeliveryManifest delivery = LoadDelivery();
        AssetAccessBinding expectedAsset = delivery.AssetAccess[0];
        expectedAsset.Checksum = "sha256:" + new string('e', 64);
        expectedAsset.MediaType = "image/png";
        expectedAsset.EncodedSizeBytes = 12345;
        expectedAsset.Url = "https://assets.example.test/texture.png";
        expectedAsset.ExpiresAtUnixMs = 67890;
        var store = new PresentationRuntimeDataStore();

        Require(store.TryReceiveDelivery(delivery.ToByteArray(), out string error), error);
        Require(store.Delivery.Publication.Equals(delivery.Publication), "publication fence was lost");
        Require(store.Delivery.ProjectionInstance.Equals(delivery.ProjectionInstance), "projection instance was lost");
        Require(store.Delivery.ProjectionProfile.Key.Equals(delivery.ProjectionProfile.Key), "projection key was lost");
        Require(store.TryGetAsset(expectedAsset.AssetId, out AssetAccessBinding asset) && asset.Equals(expectedAsset), "asset descriptor was lost");
    }

    private static void CheckOriginFenceAndUnsupportedEvent()
    {
        DeliveryManifest delivery = LoadDelivery();
        var store = new PresentationRuntimeDataStore();
        Require(store.TryReceiveDelivery(delivery, out string error), error);
        ControlServerItem snapshot = LoadSnapshot();
        ControlServerItem wrongSnapshot = snapshot.Clone();
        wrongSnapshot.ConnectionSnapshot.Fence.PresentationOriginVersion = 2;
        wrongSnapshot.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin { Version = 1 };
        Require(!store.TryReceiveControl(wrongSnapshot, out _), "mismatched snapshot origin was accepted");
        Require(store.TryReceiveControl(snapshot.ToByteArray(), out error), error);

        RuntimeProjectionFence foreignFence = snapshot.ConnectionSnapshot.Fence.Clone();
        foreignFence.PresentationOriginVersion++;
        var advance = new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance { Fence = foreignFence, FromExclusive = 0, ThroughSequence = 1 },
        };
        Require(!store.TryReceiveControl(advance.ToByteArray(), out _), "foreign origin advance was accepted");

        var originChanged = new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                EventId = "event:origin-change",
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                PresentationOriginChanged = new PresentationOriginChanged { Origin = new PresentationOrigin { Version = 1 } },
            },
        };
        Require(!store.TryReceiveControl(originChanged.ToByteArray(), out _), "origin event without a pose was accepted");
        Require(store.LastReliableSequence == 0, "reliable cursor advanced after rejected items");
    }

    private static void CheckFullSnapshotCut()
    {
        var store = new PresentationRuntimeDataStore();
        Require(store.TryReceiveDelivery(LoadDelivery(), out string error), error);
        ControlServerItem snapshot = LoadSnapshot();
        ParticipantRuntimeView view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        view.Clock = new RuntimeClockSnapshot { RuntimeTimeMs = 42, Running = new Running() };
        view.Progression = new ProgressionRuntimeState { CurrentGroupId = "group:local", GroupEntryEpoch = 1, CurrentStepId = "step:local", StepEntryEpoch = 1, Stable = new StableProgression() };
        view.PresentationOrigin = new PresentationOrigin { Version = 0, Pose = new Pose { Position = new Vector3(), Rotation = new Quaternion { W = 1 } } };
        view.MediaStates.Add(new MediaRuntimeState { SurfaceId = "semantic-surface:text-greeting", Stopped = new MediaStoppedState { HeldPositionMs = 12 } });
        view.ActiveRuns.Add(new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:local", CauseEventId = "event:local" },
            Completion = RunCompletion.NonBlocking,
            Timeline = new TimelineRunSnapshot { TimelineId = "timeline:story-01" },
        });

        Require(store.TryReceiveControl(snapshot.ToByteArray(), out error), error);
        Require(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope retained)
            && retained.Equals(snapshot.ConnectionSnapshot), "full snapshot cut was lost");
        retained.Snapshot.RuntimeView.Clock.RuntimeTimeMs = 99;
        Require(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope second)
            && second.Snapshot.RuntimeView.Clock.RuntimeTimeMs == 42, "snapshot cut leaked a mutable reference");

        ControlServerItem invalid = snapshot.Clone();
        invalid.ConnectionSnapshot.Snapshot.RuntimeView.ActiveRuns[0].Timeline.TimelineId = "timeline:missing";
        Require(!store.TryReceiveControl(invalid.ToByteArray(), out _), "unknown Run target was accepted");
        Require(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope after)
            && after.Equals(snapshot.ConnectionSnapshot), "rejected snapshot replaced the last cut");
    }

    private static void CheckRunStateClosure()
    {
        var store = new PresentationRuntimeDataStore();
        Require(store.TryReceiveDelivery(LoadDelivery(), out string error), error);
        ControlServerItem snapshot = LoadSnapshot();
        RuntimeRunId runId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 };
        var run = new RuntimeRunSnapshot
        {
            RunId = runId,
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:local", CauseEventId = "event:local" },
            Completion = RunCompletion.NonBlocking,
            Media = new MediaRunSnapshot
            {
                SurfaceId = "semantic-surface:text-greeting",
                Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 12 } },
            },
        };
        ParticipantRuntimeView view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        view.ActiveRuns.Add(run);
        view.MediaStates.Add(new MediaRuntimeState
        {
            SurfaceId = run.Media.SurfaceId,
            Stopped = new MediaStoppedState { HeldPositionMs = 12 },
        });
        Require(!store.TryReceiveControl(snapshot.ToByteArray(), out _), "stopped media state accepted an active Run");
        view.MediaStates[0].Active = new MediaActive { RunId = runId.Clone(), Playback = run.Media.Playback.Clone() };
        Require(store.TryReceiveControl(snapshot.ToByteArray(), out error), error);

        ControlServerItem missingClock = snapshot.Clone();
        missingClock.ConnectionSnapshot.Snapshot.RuntimeView.Clock = null;
        Require(!store.TryReceiveControl(missingClock.ToByteArray(), out _), "snapshot without clock was accepted");
        ControlServerItem missingProgression = snapshot.Clone();
        missingProgression.ConnectionSnapshot.Snapshot.RuntimeView.Progression = null;
        Require(!store.TryReceiveControl(missingProgression.ToByteArray(), out _), "snapshot without progression was accepted");
    }

    private static void CheckLoopingModelPosition()
    {
        DeliveryManifest delivery = LoadDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.ModelClips.Add(new ProjectedModelClipDefinition
        {
            ModelNodeId = "node:cube",
            ModelAssetId = "asset:storyboard-cube",
            ClipId = "clip:loop",
            DurationMs = 100,
        });
        var store = new PresentationRuntimeDataStore();
        Require(store.TryReceiveDelivery(delivery, out string error), error);
        ControlServerItem snapshot = LoadSnapshot();
        RuntimeRunId runId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 };
        var playback = new ClipPlayback
        {
            ClipId = "clip:loop",
            Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 101 } },
            Speed = 1,
        };
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ActiveRuns.Add(new RuntimeRunSnapshot
        {
            RunId = runId,
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:local", CauseEventId = "event:local" },
            Completion = RunCompletion.NonBlocking,
            ModelClip = new ModelClipRunSnapshot { ModelNodeId = "node:cube", Single = playback },
        });
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ModelClipStates.Add(new ModelClipRuntimeState
        {
            ModelNodeId = "node:cube",
            Active = new ModelClipActive { RunId = runId.Clone() },
        });
        Require(!store.TryReceiveControl(snapshot.ToByteArray(), out _), "non-loop raw position beyond duration was accepted");
        playback.Loop = true;
        Require(store.TryReceiveControl(snapshot.ToByteArray(), out error), error);
        playback.Playback = new PlaybackClock { Playing = new PlayingClock() };
        playback.Speed = 1e308;
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Clock.RuntimeTimeMs = 2;
        Require(!store.TryReceiveControl(snapshot.ToByteArray(), out _), "loop playback with an overflowing computed position was accepted");
        playback.Speed = 1;
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Clock.RuntimeTimeMs = 101;
        Require(store.TryReceiveControl(snapshot.ToByteArray(), out error), error);
        playback.Loop = false;
        Require(!store.TryReceiveControl(snapshot.ToByteArray(), out _), "non-loop playback with elapsed position beyond duration was accepted");
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Clock.RuntimeTimeMs = 100;
        Require(!store.TryReceiveControl(snapshot.ToByteArray(), out _), "single clip at its natural completion deadline was accepted");
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Clock.RuntimeTimeMs = 101;
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ActiveRuns[0].ModelClip.Crossfade = new ModelClipCrossfade
        {
            From = new ClipPlayback { ClipId = "clip:loop", Speed = 1, Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 100 } } },
            To = playback,
            FromIsHeld = true,
            DurationMs = 10,
            Easing = Easing.Linear,
            TransitionClock = new PlaybackClock { Playing = new PlayingClock { ReferenceRuntimeTimeMs = 100 } },
        };
        Require(store.TryReceiveControl(snapshot.ToByteArray(), out error), error);
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ActiveRuns[0].ModelClip.Crossfade.TransitionClock.Playing.ReferenceRuntimeTimeMs = 91;
        Require(!store.TryReceiveControl(snapshot.ToByteArray(), out _), "crossfade at its transition deadline was accepted");
    }

    private static DeliveryManifest LoadDelivery()
    {
        string json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "LocalDelivery.json"));
        Require(PresentationContractJsonFixtureLoader.TryParseDelivery(json, out DeliveryManifest delivery, out string error), error);
        return delivery;
    }

    private static ControlServerItem LoadSnapshot()
    {
        string json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "LocalSnapshot.json"));
        Require(PresentationContractJsonFixtureLoader.TryParseControlItem(json, out ControlServerItem snapshot, out string error), error);
        return snapshot;
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}

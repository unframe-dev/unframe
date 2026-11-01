using NUnit.Framework;
using Google.Protobuf;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationRuntimePlaybackStateEditModeTests
{
    [Test]
    public void ReliableModelClipLifecycleKeepsTheCanonicalRunAndHeldPose()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        RuntimeRunSnapshot run = PlaybackRun(delivery, true);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                ModelClipStarted = new ModelClipStarted { ModelNodeId = "node:model", RunId = run.RunId.Clone(), Playback = run.ModelClip.Single.Clone(), Run = run.Clone() }
            }
        }, out string error), Is.True, error);
        Assert.That(store.TryGetModelClipState("node:model", out ModelClipRuntimeState state), Is.True);
        Assert.That(state.Active.RunId, Is.EqualTo(run.RunId));
        run.ModelClip.Single.Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 25 } };
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 25,
                ModelClipPaused = new ModelClipPaused { ModelNodeId = "node:model", RunId = run.RunId.Clone(), Run = run.Clone() }
            }
        }, out error), Is.True, error);
        Assert.That(System.Linq.Enumerable.First(store.ActiveRuns).ModelClip.Single.Playback.Paused.PositionMs, Is.EqualTo(25));
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 3,
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 25,
                ModelClipStopped = new ModelClipStopped { ModelNodeId = "node:model", RunId = run.RunId.Clone(), Clip = new ClipHeldPose { ClipId = "clip:idle", PositionMs = 25 } }
            }
        }, out error), Is.True, error);
        Assert.That(store.TryGetModelClipState("node:model", out state), Is.True);
        Assert.That(state.HeldClip.PositionMs, Is.EqualTo(25));
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.Zero);
    }

    [Test]
    public void ReliableMediaEventsKeepPausedClockAndResetOnlyOnCompletion()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Surfaces[0].HasVideo = true;
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
        snapshot.Snapshot.RuntimeView.SurfaceStates.Add(new SurfaceRuntimeState { SurfaceId = "surface:main", StateId = "state:main" });
        snapshot.Snapshot.RuntimeView.MediaStates.Add(new MediaRuntimeState { SurfaceId = "surface:main", Stopped = new MediaStoppedState() });
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out string error), Is.True, error);
        RuntimeRunSnapshot run = PlaybackRun(delivery, false);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                MediaStarted = new MediaStarted { SurfaceId = "surface:main", RunId = run.RunId.Clone(), Playback = run.Media.Playback.Clone(), Run = run.Clone() }
            }
        }, out error), Is.True, error);
        run.Media.Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 25 } };
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 25,
                MediaPaused = new MediaPaused { SurfaceId = "surface:main", RunId = run.RunId.Clone(), PositionMs = 25, Run = run.Clone() }
            }
        }, out error), Is.True, error);
        Assert.That(store.TryGetMediaState("surface:main", out MediaRuntimeState state), Is.True);
        Assert.That(state.Active.Playback.Paused.PositionMs, Is.EqualTo(25));
        run.Media.Playback = new PlaybackClock { Playing = new PlayingClock { PositionAtReferenceMs = 25, ReferenceRuntimeTimeMs = 25 } };
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 3,
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 25,
                MediaResumed = new MediaResumed { SurfaceId = "surface:main", RunId = run.RunId.Clone(), Playback = run.Media.Playback.Playing.Clone(), Run = run.Clone() }
            }
        }, out error), Is.True, error);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 4,
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 100,
                MediaCompleted = new MediaCompleted { SurfaceId = "surface:main", RunId = run.RunId.Clone(), HeldPositionMs = 100 }
            }
        }, out error), Is.True, error);
        Assert.That(store.TryGetMediaState("surface:main", out state), Is.True);
        Assert.That(state.Stopped.HeldPositionMs, Is.Zero);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 5,
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 100,
                MediaStoppedSeeked = new MediaStoppedSeeked { SurfaceId = "surface:main", HeldPositionMs = 50 }
            }
        }, out error), Is.True, error);
        Assert.That(store.TryGetMediaState("surface:main", out state), Is.True);
        Assert.That(state.Stopped.HeldPositionMs, Is.EqualTo(50));
    }

    [Test]
    public void PlaybackEventRejectsMismatchedEmbeddedRunWithoutChangingReliableCut()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        RuntimeRunSnapshot run = PlaybackRun(delivery, true);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                ModelClipStarted = new ModelClipStarted { ModelNodeId = "node:model", RunId = new RuntimeRunId { AssignmentEpoch = 7, RunSequence = 2 }, Playback = run.ModelClip.Single.Clone(), Run = run }
            }
        }, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.Zero);
        Assert.That(store.TryGetModelClipState("node:model", out _), Is.False);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void SnapshotRejectsUnknownOrNonFiniteHeldModelPose(bool blend)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot);
        ModelClipRuntimeState state = new ModelClipRuntimeState { ModelNodeId = "node:model" };
        if (blend) state.HeldBlend = new BlendHeldPose { From = new ClipHeldPose { ClipId = "clip:idle" }, To = new ClipHeldPose { ClipId = "clip:idle" }, ToWeight = double.NaN };
        else state.HeldClip = new ClipHeldPose { ClipId = "missing", PositionMs = 2 };
        snapshot.Snapshot.RuntimeView.ModelClipStates.Add(state);
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out _), Is.False);
        Assert.That(store.TryGetModelClipState("node:model", out _), Is.False);
    }

    [Test]
    public void GroupInitializationAcceptsDefaultPlaybackStateAndExitRemovesIt()
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedRuntimeCatalog catalog = delivery.ProjectionProfile.RuntimeCatalog;
        catalog.Nodes[0].Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:next" } };
        catalog.Surfaces[0].Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:next" } };
        catalog.Surfaces[0].HasVideo = true;
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                GroupEntered = new GroupEntered
                {
                    GroupId = "group:next",
                    GroupEntryEpoch = 2,
                    Initialization = new GroupRuntimeInitialization
                    {
                        NodeStates = { new NodeRuntimeState { NodeId = "node:model", Opacity = 1, Transform = CreateValidTransform() } },
                        SurfaceStates = { new SurfaceRuntimeState { SurfaceId = "surface:main", StateId = "state:main" } },
                        ModelClipStates = { new ModelClipRuntimeState { ModelNodeId = "node:model", DefaultPose = new DefaultModelPose() } },
                        MediaStates = { new MediaRuntimeState { SurfaceId = "surface:main", Stopped = new MediaStoppedState() } }
                    }
                }
            }
        }, out string error), Is.True, error);
        Assert.That(store.TryGetModelClipState("node:model", out _), Is.True);
        Assert.That(store.TryGetMediaState("surface:main", out _), Is.True);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = CreateFence(delivery),
                GroupExited = new GroupExited { GroupId = "group:next", GroupEntryEpoch = 2 }
            }
        }, out error), Is.True, error);
        Assert.That(store.TryGetModelClipState("node:model", out _), Is.False);
        Assert.That(store.TryGetMediaState("surface:main", out _), Is.False);
    }

    [Test]
    public void CrossfadeSettlementKeepsTheRunUntilLogicalClipCompletion()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        RuntimeRunSnapshot run = PlaybackRun(delivery, true);
        ProjectedReliableEvent item = new ProjectedReliableEvent { Sequence = 1, Fence = CreateFence(delivery), ModelClipStarted = new ModelClipStarted { ModelNodeId = "node:model", RunId = run.RunId.Clone(), Playback = run.ModelClip.Single.Clone(), Run = run.Clone() } };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = item }, out string error), Is.True, error);
        ClipPlayback source = run.ModelClip.Single.Clone();
        run.RunId.RunSequence = 2;
        run.StartedAtRuntimeTimeMs = 10;
        ClipPlayback target = new ClipPlayback { ClipId = "clip:idle", Speed = 1, Playback = new PlaybackClock { Playing = new PlayingClock { ReferenceRuntimeTimeMs = 10 } } };
        run.ModelClip.Crossfade = new ModelClipCrossfade { From = source, To = target, DurationMs = 20, Easing = Easing.Linear, TransitionClock = new PlaybackClock { Playing = new PlayingClock { ReferenceRuntimeTimeMs = 10 } } };
        item = new ProjectedReliableEvent { Sequence = 2, Fence = CreateFence(delivery), OccurredAtRuntimeTimeMs = 10, ModelClipCrossfadeStarted = new ModelClipCrossfadeStarted { ModelNodeId = "node:model", RunId = run.RunId.Clone(), Crossfade = run.ModelClip.Crossfade.Clone(), Run = run.Clone() } };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = item }, out error), Is.True, error);
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.EqualTo(1));
        run.ModelClip.Single = target;
        item = new ProjectedReliableEvent { Sequence = 3, Fence = CreateFence(delivery), OccurredAtRuntimeTimeMs = 30, ModelClipCrossfadeCompleted = new ModelClipCrossfadeCompleted { ModelNodeId = "node:model", RunId = run.RunId.Clone(), Playback = target.Clone(), Run = run.Clone() } };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = item }, out error), Is.True, error);
        Assert.That(System.Linq.Enumerable.First(store.ActiveRuns).ModelClip.PhaseCase, Is.EqualTo(ModelClipRunSnapshot.PhaseOneofCase.Single));
        item = new ProjectedReliableEvent { Sequence = 4, Fence = CreateFence(delivery), OccurredAtRuntimeTimeMs = 110, ModelClipCompleted = new ModelClipCompleted { ModelNodeId = "node:model", RunId = run.RunId.Clone(), HeldPose = new ClipHeldPose { ClipId = "clip:idle", PositionMs = 100 } } };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = item }, out error), Is.True, error);
        Assert.That(store.TryGetModelClipState("node:model", out ModelClipRuntimeState state), Is.True);
        Assert.That(state.HeldClip.PositionMs, Is.EqualTo(100));
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.Zero);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void PlaybackCancellationResetsPresentationStateAndRejectsStaleRun(bool model)
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Surfaces[0].HasVideo = true;
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot);
        snapshot.Snapshot.RuntimeView.SurfaceStates.Add(new SurfaceRuntimeState { SurfaceId = "surface:main", StateId = "state:main" });
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out string error), Is.True, error);
        RuntimeRunSnapshot run = PlaybackRun(delivery, model);
        ProjectedReliableEvent item = new ProjectedReliableEvent { Sequence = 1, Fence = CreateFence(delivery) };
        if (model) item.ModelClipStarted = new ModelClipStarted { ModelNodeId = "node:model", RunId = run.RunId.Clone(), Playback = run.ModelClip.Single.Clone(), Run = run.Clone() };
        else item.MediaStarted = new MediaStarted { SurfaceId = "surface:main", RunId = run.RunId.Clone(), Playback = run.Media.Playback.Clone(), Run = run.Clone() };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = item }, out error), Is.True, error);
        item = new ProjectedReliableEvent { Sequence = 2, Fence = CreateFence(delivery) };
        RuntimeRunId stale = run.RunId.Clone(); stale.RunSequence++;
        if (model) item.ModelClipCanceled = new ModelClipCanceled { ModelNodeId = "node:model", RunId = stale, Reason = ModelClipCancelReason.PresentationEnded };
        else item.MediaCanceled = new MediaCanceled { SurfaceId = "surface:main", RunId = stale, Reason = MediaCancelReason.PresentationEnded };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = item }, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.EqualTo(1));
        if (model) item.ModelClipCanceled.RunId = run.RunId.Clone(); else item.MediaCanceled.RunId = run.RunId.Clone();
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = item }, out error), Is.True, error);
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.Zero);
        if (model) { Assert.That(store.TryGetModelClipState("node:model", out ModelClipRuntimeState state), Is.True); Assert.That(state.StateCase, Is.EqualTo(ModelClipRuntimeState.StateOneofCase.DefaultPose)); }
        else { Assert.That(store.TryGetMediaState("surface:main", out MediaRuntimeState state), Is.True); Assert.That(state.Stopped.HeldPositionMs, Is.Zero); }
    }

    private static RuntimeRunSnapshot PlaybackRun(DeliveryManifest delivery, bool model)
    {
        RuntimeRunSnapshot run = new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch, RunSequence = 1 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:main", CauseEventId = "event:main" },
            Completion = RunCompletion.NonBlocking,
        };
        PlaybackClock clock = new PlaybackClock { Playing = new PlayingClock() };
        if (model) run.ModelClip = new ModelClipRunSnapshot { ModelNodeId = "node:model", Single = new ClipPlayback { ClipId = "clip:idle", Speed = 1, Playback = clock } };
        else run.Media = new MediaRunSnapshot { SurfaceId = "surface:main", Playback = clock };
        return run;
    }

    private static DeliveryManifest CreateDelivery()
    {
        ProjectedRuntimeCatalog catalog = new ProjectedRuntimeCatalog { CatalogContractVersion = 3 };
        catalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:model",
            Parent = new SpatialParent { Stage = new StageParent() },
            Model = new ModelNode { ModelAssetId = "asset:model" },
        });
        catalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:surface",
            Parent = new SpatialParent { Node = new NodeParent { NodeId = "node:model" } },
            Surface = new SurfaceNode { SemanticSurfaceId = "surface:main" },
        });
        catalog.Surfaces.Add(new ProjectedSurfaceDefinition { SurfaceId = "surface:main", HostNodeId = "node:surface", ReachableStateIds = { "state:main" } });
        ProjectedTimelineDefinition timeline = new ProjectedTimelineDefinition
        {
            TimelineId = "timeline:main",
            DurationMs = 3,
            Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
        };
        timeline.Tracks.Add(new ProjectedTimelineTrack
        {
            Target = new TimelineTrackTarget { NodeId = "node:model", Property = TimelineProperty.Opacity },
            Keyframes =
            {
                new TimelineKeyframe { TimeMs = 0, Number = new NumberKeyframeValue { Value = 1 }, EasingToNext = Easing.Linear },
                new TimelineKeyframe { TimeMs = 3, Number = new NumberKeyframeValue { Value = 0 } },
            },
        });
        catalog.Timelines.Add(timeline);
        catalog.Variables.Add(new ProjectedVariableDefinition { VariableId = "variable:title" });
        foreach (ProjectedNodeDefinition node in catalog.Nodes) node.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces) surface.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        catalog.ModelClips.Add(new ProjectedModelClipDefinition { ModelNodeId = "node:model", ModelAssetId = "asset:model", ClipId = "clip:idle", DurationMs = 100 });

        DeliveryManifest delivery = new DeliveryManifest
        {
            SchemaVersion = 1,
            DeliveryContractVersion = 3,
            SessionId = "session:main",
            Publication = new PublicationFence { PresentationId = "presentation:main", PublicationEpoch = 1, PublicationManifestHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            DefinitionHash = "sha256:" + new string('b', 64),
            RenderBundleHash = "sha256:" + new string('c', 64),
            AssetSetHash = "sha256:" + new string('d', 64),
            CapabilityProfile = new CapabilityProfile
            {
                SchemaVersion = 1,
                CapabilityProfileId = "capability:quest",
                ContractVersions = new ContractVersions { Delivery = 3, Runtime = 3, Progression = 2, Projection = 2 },
                Renderers = new RendererCapabilities { NativeUi = new NativeUiCapability { Supported = true, ContractVersion = 1 } },
            },
            ProjectionProfile = new ProjectionProfileDescriptor
            {
                ProjectionProfileId = "profile:quest",
                Key = new ProjectionProfileKey
                {
                    Publication = new PublicationFence { PresentationId = "presentation:main", PublicationEpoch = 1, PublicationManifestHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
                    ProjectionContractVersion = 2,
                    Role = SessionRole.Presenter,
                    CapabilityProfileId = "capability:quest",
                },
                RuntimeCatalog = catalog,
            },
            ProjectionInstance = new ProjectionInstance { ProjectionProfileId = "profile:quest", ParticipantId = "participant:quest", AssignmentEpoch = 7 },
            Residency = new ResidencyPlan { Models = new ModelResidencyPlan(), Video = new VideoResidencyPlan() },
        };
        delivery.AssetAccess.Add(new AssetAccessBinding { AssetId = "asset:model" });
        delivery.Residency.Models.Models.Add(new ModelResidencyBinding { AssetId = "asset:model" });
        delivery.ProjectionProfile.VisibleNodeIds.Add("node:model");
        delivery.ProjectionProfile.VisibleNodeIds.Add("node:surface");
        delivery.ProjectionProfile.VisibleSurfaceIds.Add("surface:main");
        delivery.ProjectionProfile.VisibleVariableIds.Add("variable:title");
        delivery.ProjectionProfile.RequiredRuntimeCapabilities.Add(RuntimeCapability.TimelineRun);
        delivery.ProjectionProfile.SemanticSurfaces.Add(new ProjectedSemanticSurface
        {
            SemanticSurfaceId = "surface:main",
            RenderSurfaceIds = { "render:main" },
            States = { new SurfaceSemanticState { StateId = "state:main", SemanticTree = new ProjectedSemanticTree() } },
        });
        delivery.ProjectionProfile.RenderSurfaces.Add(new DeliveredRenderSurface
        {
            RenderSurfaceId = "render:main",
            SemanticSurfaceId = "surface:main",
            RendererKind = RendererKind.NativeUi,
            ArtifactContractVersion = 1,
            StateBindings = { new DeliveredStateBinding { StateId = "state:main", Artifact = new ArtifactStateBinding { ArtifactId = "artifact:main" } } },
            Artifacts = { new DeliveredArtifact { NativeUi = new NativeUiArtifact { ArtifactId = "artifact:main", ContractVersion = 1, RootNodeId = "ui:main", Nodes = { new NativeUiNode { Text = new NativeUiText { NodeId = "ui:main", Color = new Unframe.Delivery.SrgbaColor { Red = 1, Green = 1, Blue = 1, Alpha = 1 }, Value = new NativeTextValue { Literal = new LiteralText { Value = "Main" } } } } } } } },
        });
        return delivery;
    }

    private static PresentationRuntimeDataStore CreateStoreWithNodeState(DeliveryManifest delivery)
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        ConnectionSnapshotEnvelope snapshot = new ConnectionSnapshotEnvelope
        {
            SchemaVersion = 1,
            Fence = CreateFence(delivery),
            ProjectionInstance = delivery.ProjectionInstance.Clone(),
            Snapshot = new ProjectedRuntimeSnapshot
            {
                ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
                AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
                RuntimeView = new ParticipantRuntimeView
                {
                    ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
                    AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
                    Clock = new RuntimeClockSnapshot { Running = new Running() },
                    Progression = new ProgressionRuntimeState { CurrentGroupId = "group:main", GroupEntryEpoch = 1, CurrentStepId = "step:main", StepEntryEpoch = 1, Stable = new StableProgression() },
                },
            },
        };
        snapshot.Snapshot.RuntimeView.NodeStates.Add(new NodeRuntimeState
        {
            NodeId = "node:model",
            Active = true,
            Visible = true,
            Opacity = 1,
            Transform = CreateValidTransform(),
        });
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out error), Is.True, error);
        return store;
    }

    private static Unframe.Presentation.Transform CreateValidTransform()
    {
        return new Unframe.Presentation.Transform
        {
            Position = new Unframe.Presentation.Vector3(),
            Rotation = new Unframe.Presentation.Quaternion { W = 1 },
            Scale = new Unframe.Presentation.Vector3 { X = 1, Y = 1, Z = 1 },
        };
    }

    private static RuntimeProjectionFence CreateFence(DeliveryManifest delivery)
    {
        return new RuntimeProjectionFence
        {
            SessionId = delivery.SessionId,
            Publication = delivery.Publication.Clone(),
            AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
            ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
        };
    }

}

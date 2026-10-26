using System;
using System.IO;
using System.Collections.Generic;
using Google.Protobuf;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
#if UNITY_EDITOR
using NUnit.Framework;
using Application = UnityEngine.Application;
#endif

public sealed class PresentationRuntimePauseEditModeTests
{
#if UNITY_EDITOR
    [Test]
    public void FrozenViewSurvivesPauseResumeAndConvergesToFreshTracking() { Run(); }

    [Test]
    public void SharedPlaybackUsesPausedLogicalTimeWhileWallTimeAdvances()
    {
        var clock = new RuntimeClockSnapshot { RuntimeTimeMs = 1200, Paused = new Paused { Reason = PauseReason.ExplicitPause } };
        Assert.That(PresentationPlaybackPlayer.SampleRuntimeTimeMs(clock, 1, 50), Is.EqualTo(1200));
        clock.Running = new Running();
        Assert.That(PresentationPlaybackPlayer.SampleRuntimeTimeMs(clock, 50, 50.25), Is.EqualTo(1450));
    }
    [Test]
    public void ReplacementRestoresRunsAndSurfaceTogetherAndRejectsPartialState()
    {
        var delivery = JsonParser.Default.Parse<DeliveryManifest>(PresentationTestFixtures.Load("LocalDelivery").text);
        var snapshot = JsonParser.Default.Parse<ControlServerItem>(PresentationTestFixtures.Load("LocalSnapshot").text);
        foreach (var node in delivery.ProjectionProfile.RuntimeCatalog.Nodes)
        {
            node.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
            if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model)
                snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ModelClipStates.Add(new ModelClipRuntimeState { ModelNodeId = node.NodeId, DefaultPose = new DefaultModelPose() });
        }
        foreach (var definition in delivery.ProjectionProfile.RuntimeCatalog.Surfaces) definition.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Clone();
        view.BaseReliableSequence = 1; view.Clock.Paused = new Paused { Reason = PauseReason.ExplicitPause };
        view.Progression.StepEntryEpoch++;
        view.NodeStates[0].Opacity = 0.42;
        var runId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 100 };
        var surface = view.SurfaceStates[0];
        surface.TransitionRunId = runId.Clone();
        view.ActiveRuns.Add(new RuntimeRunSnapshot { RunId = runId,
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() }, Cause = new RuntimeRunCause { CueId = "cue:restore", CauseEventId = "event:restore" },
            Completion = RunCompletion.NonBlocking, SurfaceTransition = new SurfaceTransitionRunSnapshot { SurfaceId = surface.SurfaceId, FromStateId = surface.StateId, ToStateId = surface.StateId, DurationMs = 1000, Easing = Easing.Linear } });
        var replacement = new ControlServerItem { ReliableEvent = new ProjectedReliableEvent { Sequence = 1, Fence = snapshot.ConnectionSnapshot.Fence.Clone(), RuntimeViewReplaced = new RuntimeViewReplaced { RuntimeView = view } } };
        var invalid = replacement.Clone(); invalid.ReliableEvent.RuntimeViewReplaced.RuntimeView.SurfaceStates[0].TransitionRunId.RunSequence = 999;
        Assert.That(store.TryReceiveNetworkControl(invalid, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
        Assert.That(store.TryGetNodeState(view.NodeStates[0].NodeId, out var original), Is.True);
        Assert.That(original.Opacity, Is.Not.EqualTo(0.42));
        Assert.That(store.TryReceiveNetworkControl(replacement, out error), Is.True, error);
        Assert.That(store.TryGetSurfaceState(surface.SurfaceId, out var restored), Is.True);
        Assert.That(restored.TransitionRunId, Is.EqualTo(runId));
        Assert.That(store.RuntimeClock.StatusCase, Is.EqualTo(RuntimeClockSnapshot.StatusOneofCase.Paused));
        view.ActiveRuns.Clear(); surface.TransitionRunId = null; view.BaseReliableSequence = 2; replacement.ReliableEvent.Sequence = 2;
        Assert.That(store.TryReceiveNetworkControl(replacement, out error), Is.True, error);
        Assert.That(store.ActiveRuns, Is.Empty);
    }
#endif
    public static void Run()
    {
#if UNITY_EDITOR
        string root = Path.Combine(Application.dataPath, "Tests/EditMode/Editor/FixturesData");
#else
        string root = AppContext.BaseDirectory;
#endif
        DeliveryManifest delivery = JsonParser.Default.Parse<DeliveryManifest>(File.ReadAllText(Path.Combine(root, "LocalDelivery.json")));
        ControlServerItem snapshot = JsonParser.Default.Parse<ControlServerItem>(File.ReadAllText(Path.Combine(root, "LocalSnapshot.json")));
        foreach (var node in delivery.ProjectionProfile.RuntimeCatalog.Nodes)
            if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model)
                snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ModelClipStates.Add(new ModelClipRuntimeState { ModelNodeId = node.NodeId, DefaultPose = new DefaultModelPose() });
        foreach (var node in delivery.ProjectionProfile.RuntimeCatalog.Nodes) node.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        foreach (var surface in delivery.ProjectionProfile.RuntimeCatalog.Surfaces) surface.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        string id = delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].NodeId;
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent { PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true } };
        var view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        view.Clock.Paused = new Paused { Reason = PauseReason.ExplicitPause };
        view.FrozenAnchors.Add(new FrozenAnchorDisplayState { NodeId = id, Position = new Vector3 { X = 7 } });
        var store = new PresentationRuntimeDataStore();
        Require(store.TryReceiveDelivery(delivery, out string error), error);
        Require(store.TryReceiveControl(snapshot, out error), error);
        Require(store.TryGetAnchorSample(id, out var sample) && sample.Position.X == 7, "snapshot frozen anchor is not visible");
        System.Threading.Thread.Sleep(510);
        Require(store.TryGetAnchorSample(id, out _), "frozen anchor expired during pause");
        ParticipantRuntimeView resumed = view.Clone();
        resumed.BaseReliableSequence = 1;

        resumed.NodeStates[0].Opacity = 0.25;
        var replacement = new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                Sequence = 1,
                OccurredAtRuntimeTimeMs = resumed.Clock.RuntimeTimeMs,
                RuntimeViewReplaced = new RuntimeViewReplaced { RuntimeView = resumed },
            }
        };
        Require(store.TryReceiveNetworkControl(replacement, out error), error);
        Require(store.TryGetNodeState(id, out var state) && state.Opacity == 0.25, "replacement did not replace node state");
        Require(store.TryGetAnchorSample(id, out sample) && sample.Position.X == 7, "resume lost frozen display while waiting for fresh pose");
        Require(store.TryReceiveNetworkControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                Sequence = 2,
                OccurredAtRuntimeTimeMs = resumed.Clock.RuntimeTimeMs,
                RuntimeStatusChanged = new RuntimeStatusChanged { Running = new Running() },
            }
        }, out error), error);
        Require(store.TryGetAnchorSample(id, out _), "resume status discarded frozen display");
        var frame = new ElementStateFrame
        {
            Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
            BaseReliableSequence = 0,
            FrameSequence = 1,
            Kind = StateFrameKind.Keyframe,
            ProducedAtRuntimeMonotonicMs = 10000
        };
        var sortedNodes = new List<NodeRuntimeState>(resumed.NodeStates);
        sortedNodes.Sort((left, right) => string.CompareOrdinal(left.NodeId, right.NodeId));
        foreach (var node in sortedNodes)
            frame.Elements.Add(new ElementStatePatch
            {
                ElementId = node.NodeId,
                Node = new NodeStatePatch
                {
                    Active = node.Active,
                    Visible = node.Visible,
                    Opacity = node.Opacity,
                    Transform = node.Transform.Clone(),
                }
            });
        frame.AnchorBindings.Add(new ProjectedAnchorBindingPatch { NodeId = id, Unavailable = new AnchorBindingUnavailable() });
        Require(!store.TryReceiveState(new StateServerItem { StateFrame = frame }, out _), "old state cut replaced the new view");
        Require(store.TryGetAnchorSample(id, out _), "old state removed frozen display");
        frame.BaseReliableSequence = 1;
        Require(!store.TryReceiveState(new StateServerItem { StateFrame = frame }, out _), "pre-resume state cut replaced the resumed view");
        frame.BaseReliableSequence = 2;
        frame.AnchorBindings[0].Frozen = resumed.FrozenAnchors[0].Clone();
        Require(store.TryValidateNetworkStateFrame(frame, out error), error);
        Require(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out error), error);
        Require(store.TryGetAnchorSample(id, out sample) && sample.Position.X == 7, "frozen keyframe did not converge");
        frame.FrameSequence = 2;
        frame.AnchorBindings[0].Frozen.NodeId = "node:unknown";
        Require(!store.TryReceiveState(new StateServerItem { StateFrame = frame }, out _), "mismatched frozen node identity accepted");
        Require(store.TryGetAnchorSample(id, out sample) && sample.Position.X == 7, "invalid frozen patch partially changed display");
        frame.AnchorBindings[0].Sample = new ProjectedAnchorBindingSample
        {
            TrackingFrameSequence = 2,
            ObservedAtRuntimeMonotonicMs = 10000,
            Position = new Vector3 { X = 9 }
        };
        Require(store.TryValidateNetworkStateFrame(frame, out error), error);
        Require(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out error), error);
        Require(store.TryGetAnchorSample(id, out sample) && sample.Position.X == 9, "fresh pose did not replace frozen anchor");
        System.Threading.Thread.Sleep(510);
        Require(!store.TryGetAnchorSample(id, out _), "tracking sample did not return to normal freshness");
        frame.FrameSequence = 3;
        frame.AnchorBindings[0].Frozen = resumed.FrozenAnchors[0].Clone();
        Require(store.TryValidateNetworkStateFrame(frame, out error), error);
        Require(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out error), error);
        frame.FrameSequence = 4;
        frame.AnchorBindings[0].Unavailable = new AnchorBindingUnavailable();
        Require(store.TryValidateNetworkStateFrame(frame, out error), error);
        Require(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out error), error);
        Require(!store.TryGetAnchorSample(id, out _), "unavailable keyframe retained frozen anchor");
        replacement.ReliableEvent.Sequence = 3;
        resumed.BaseReliableSequence = 3;
        resumed.FrozenAnchors[0].NodeId = "node:unknown";
        Require(!store.TryReceiveNetworkControl(replacement, out _), "invalid replacement accepted");
        Require(store.LastReliableSequence == 2 && !store.TryGetAnchorSample(id, out _), "invalid replacement partially changed state");
        resumed.Progression = null;
        Require(!store.TryReceiveNetworkControl(replacement, out _), "replacement without progression accepted");

    }

    private static void Require(bool condition, string error)
    {
        if (!condition) throw new InvalidOperationException(error);
    }
}

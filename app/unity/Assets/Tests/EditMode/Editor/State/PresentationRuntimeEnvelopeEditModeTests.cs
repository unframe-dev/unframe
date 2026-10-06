using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationRuntimeEnvelopeEditModeTests
{
    [Test]
    public void BinaryPayloadsReceiveDeliverySnapshotAndStateFrame()
    {
        CreateLoadedStore(out DeliveryManifest delivery, out ControlServerItem snapshot);
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery.ToByteArray(), out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot.ToByteArray(), out error), Is.True, error);
        StateServerItem state = new StateServerItem
        {
            StateFrame = new ElementStateFrame
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                Kind = StateFrameKind.Keyframe,
                FrameSequence = 1,
                BaseReliableSequence = 0,
            },
        };
        Assert.That(store.TryReceiveState(state.ToByteArray(), out error), Is.True, error);
    }

    [TestCase("participant")]
    [TestCase("projection")]
    [TestCase("snapshot sequence")]
    [TestCase("view sequence")]
    public void SnapshotRejectsInconsistentIdentityAndSequence(string invalidPart)
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        ConnectionSnapshotEnvelope envelope = snapshot.ConnectionSnapshot;
        switch (invalidPart)
        {
            case "participant": envelope.ProjectionInstance.ParticipantId = "participant:other"; break;
            case "projection": envelope.Snapshot.ProjectionProfileId = "profile:other"; break;
            case "snapshot sequence": envelope.Snapshot.ReliableSequence = 7; break;
            case "view sequence": envelope.Snapshot.RuntimeView.BaseReliableSequence = 7; break;
        }

        Assert.That(store.TryReceiveControl(snapshot, out _), Is.False, invalidPart);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [Test]
    public void SnapshotRejectsAnOriginVersionDifferentFromItsProjectionFence()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        snapshot.ConnectionSnapshot.Fence.PresentationOriginVersion = 2;
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin { Version = 1 };

        Assert.That(store.TryReceiveControl(snapshot, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [Test]
    public void ProjectedItemsRejectAnotherOriginVersionWithoutAdvancingTheCursor()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);

        RuntimeProjectionFence foreignFence = snapshot.ConnectionSnapshot.Fence.Clone();
        foreignFence.PresentationOriginVersion++;
        ControlServerItem advance = new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance { Fence = foreignFence, FromExclusive = 0, ThroughSequence = 1 },
        };
        Assert.That(store.TryReceiveControl(advance, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);

        StateServerItem frame = new StateServerItem
        {
            StateFrame = new ElementStateFrame
            {
                Fence = foreignFence,
                Kind = StateFrameKind.Keyframe,
                FrameSequence = 1,
                BaseReliableSequence = 0,
            },
        };
        Assert.That(store.TryReceiveState(frame, out _), Is.False);
        Assert.That(store.LastStateFrameSequence, Is.Zero);
    }

    [Test]
    public void MalformedOriginEventDoesNotAdvanceTheCursor()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        ControlServerItem originChanged = new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                EventId = "event:origin-change",
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                PresentationOriginChanged = new PresentationOriginChanged
                {
                    Origin = new PresentationOrigin { Version = 1 },
                },
            },
        };

        Assert.That(store.TryReceiveControl(originChanged, out error), Is.False);
        Assert.That(error, Does.Contain("origin is invalid"));
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [Test]
    public void SnapshotRetainsTheFullTypedCutWithoutExposingMutableState()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        ParticipantRuntimeView view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        view.Clock = new RuntimeClockSnapshot { RuntimeTimeMs = 42, Running = new Running() };
        view.Progression = new ProgressionRuntimeState { CurrentGroupId = "group:local", GroupEntryEpoch = 1, CurrentStepId = "step:local", StepEntryEpoch = 1, Stable = new StableProgression() };
        view.PresentationOrigin = new PresentationOrigin { Version = 0, Pose = new Unframe.Presentation.Pose { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } } };
        view.MediaStates.Add(new MediaRuntimeState { SurfaceId = "semantic-surface:text-greeting", Stopped = new MediaStoppedState { HeldPositionMs = 12 } });
        view.ActiveRuns.Add(new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:local", CauseEventId = "event:local" },
            Completion = RunCompletion.NonBlocking,
            Timeline = new TimelineRunSnapshot { TimelineId = "timeline:story-01" },
        });

        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope retained), Is.True);
        Assert.That(retained, Is.EqualTo(snapshot.ConnectionSnapshot));
        retained.Snapshot.RuntimeView.Clock.RuntimeTimeMs = 99;
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope second), Is.True);
        Assert.That(second.Snapshot.RuntimeView.Clock.RuntimeTimeMs, Is.EqualTo(42));
    }

    [TestCase("unknown timeline")]
    [TestCase("unknown completion")]
    public void SnapshotRejectsInvalidActiveRunWithoutReplacingTheLastCut(string invalidPart)
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        ConnectionSnapshotEnvelope invalid = snapshot.ConnectionSnapshot.Clone();
        RuntimeRunSnapshot run = new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:local", CauseEventId = "event:local" },
            Completion = invalidPart == "unknown completion" ? (RunCompletion)99 : RunCompletion.Blocking,
            Timeline = new TimelineRunSnapshot { TimelineId = invalidPart == "unknown timeline" ? "timeline:missing" : "timeline:story-01" },
        };
        invalid.Snapshot.RuntimeView.ActiveRuns.Add(run);

        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = invalid }, out _), Is.False);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope retained), Is.True);
        Assert.That(retained, Is.EqualTo(snapshot.ConnectionSnapshot));
    }

    [TestCase("clock")]
    [TestCase("progression")]
    public void SnapshotRequiresClockAndProgression(string missingPart)
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        if (missingPart == "clock") snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Clock = null;
        else snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Progression = null;

        Assert.That(store.TryReceiveControl(snapshot, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [TestCase("media stopped")]
    [TestCase("media playback mismatch")]
    [TestCase("duplicate media target")]
    [TestCase("surface without transition ref")]
    [TestCase("blocking run omitted")]
    [TestCase("duplicate blocking ref")]
    public void SnapshotRejectsInconsistentRunStateClosure(string invalidPart)
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        ParticipantRuntimeView view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        RuntimeRunSnapshot run = NewRun(1);
        if (invalidPart.StartsWith("surface"))
        {
            run.SurfaceTransition = new SurfaceTransitionRunSnapshot
            {
                SurfaceId = "semantic-surface:text-greeting",
                FromStateId = "state:text-greeting",
                ToStateId = "state:text-greeting",
            };
        }
        else if (invalidPart.StartsWith("blocking") || invalidPart.StartsWith("duplicate blocking"))
        {
            run.Completion = RunCompletion.Blocking;
            run.Timeline = new TimelineRunSnapshot { TimelineId = "timeline:story-01" };
            if (invalidPart == "duplicate blocking ref")
            {
                view.Progression.Transitioning = new TransitioningProgression();
                view.Progression.Transitioning.BlockingRunIds.Add(run.RunId.Clone());
                view.Progression.Transitioning.BlockingRunIds.Add(run.RunId.Clone());
            }
        }
        else
        {
            PlaybackClock playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 12 } };
            run.Media = new MediaRunSnapshot { SurfaceId = "semantic-surface:text-greeting", Playback = playback };
            view.MediaStates.Add(new MediaRuntimeState
            {
                SurfaceId = "semantic-surface:text-greeting",
                Stopped = new MediaStoppedState { HeldPositionMs = 12 },
            });
            if (invalidPart == "media playback mismatch")
            {
                view.MediaStates[0].Active = new MediaActive
                {
                    RunId = run.RunId.Clone(),
                    Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 13 } },
                };
            }
        }
        view.ActiveRuns.Add(run);
        if (invalidPart == "duplicate media target")
        {
            RuntimeRunSnapshot duplicate = NewRun(2);
            duplicate.Media = run.Media.Clone();
            view.ActiveRuns.Add(duplicate);
        }

        Assert.That(store.TryReceiveControl(snapshot, out _), Is.False, invalidPart);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [Test]
    public void SnapshotAcceptsMatchingActiveMediaRun()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        ParticipantRuntimeView view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        RuntimeRunSnapshot media = NewRun(1);
        media.Media = new MediaRunSnapshot
        {
            SurfaceId = "semantic-surface:text-greeting",
            Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 12 } },
        };
        view.ActiveRuns.Add(media);
        view.MediaStates.Add(new MediaRuntimeState
        {
            SurfaceId = media.Media.SurfaceId,
            Active = new MediaActive { RunId = media.RunId.Clone(), Playback = media.Media.Playback.Clone() },
        });

        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
    }

    private static RuntimeRunSnapshot NewRun(ulong sequence)
    {
        return new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = sequence },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:local", CauseEventId = "event:local" },
            Completion = RunCompletion.NonBlocking,
        };
    }

    [Test]
    public void SnapshotRejectsUnreachableSurfaceState()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.SurfaceStates[0].StateId = "state:missing";

        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.False);
        Assert.That(error, Does.Contain("surface state"));
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [TestCase(-0.01d)]
    [TestCase(1.01d)]
    public void SnapshotRejectsOutOfRangeNodeOpacityWithoutReplacingCurrentState(double opacity)
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        string nodeId = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0].NodeId;
        Assert.That(store.TryGetNodeState(nodeId, out NodeRuntimeState before), Is.True);

        ControlServerItem invalidSnapshot = snapshot.Clone();
        invalidSnapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0].Opacity = opacity;

        Assert.That(store.TryReceiveControl(invalidSnapshot, out error), Is.False);
        Assert.That(error, Does.Contain("state"));
        Assert.That(store.LastReliableSequence, Is.Zero);
        Assert.That(store.TryGetNodeState(nodeId, out NodeRuntimeState after), Is.True);
        Assert.That(after, Is.EqualTo(before));
    }

    [Test]
    public void SnapshotRejectsNonFiniteNodeOpacityWithoutReplacingCurrentState()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        string nodeId = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0].NodeId;
        Assert.That(store.TryGetNodeState(nodeId, out NodeRuntimeState before), Is.True);

        ControlServerItem invalidSnapshot = snapshot.Clone();
        invalidSnapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0].Opacity = double.NaN;

        Assert.That(store.TryReceiveControl(invalidSnapshot, out error), Is.False);
        Assert.That(error, Does.Contain("state"));
        Assert.That(store.TryGetNodeState(nodeId, out NodeRuntimeState after), Is.True);
        Assert.That(after, Is.EqualTo(before));
    }

    [Test]
    public void NodeStateCommittedRejectsDegenerateTransformWithoutChangingStateOrSequence()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        NodeRuntimeState previous = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0];
        Assert.That(store.TryGetNodeState(previous.NodeId, out NodeRuntimeState before), Is.True);

        NodeRuntimeState invalidState = before.Clone();
        invalidState.Transform = new Unframe.Presentation.Transform
        {
            Position = new Unframe.Presentation.Vector3(),
            Rotation = new Unframe.Presentation.Quaternion(),
            Scale = new Unframe.Presentation.Vector3 { X = 1, Y = 1, Z = 1 },
        };
        ControlServerItem item = new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                EventId = "event:invalid-node-state",
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                NodeStateCommitted = new NodeStateCommitted { State = invalidState },
            },
        };

        Assert.That(store.TryReceiveControl(item, out error), Is.False);
        Assert.That(error, Does.Contain("state"));
        Assert.That(store.LastReliableSequence, Is.Zero);
        Assert.That(store.TryGetNodeState(previous.NodeId, out NodeRuntimeState after), Is.True);
        Assert.That(after, Is.EqualTo(before));
    }

    [Test]
    public void ProjectionAdvanceAllowsTheNextVisibleReliableEvent()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        RuntimeProjectionFence fence = snapshot.ConnectionSnapshot.Fence.Clone();
        ControlServerItem advance = new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance { Fence = fence, FromExclusive = 0, ThroughSequence = 2 },
        };

        Assert.That(store.TryReceiveControl(advance, out error), Is.True, error);
        Assert.That(store.LastReliableSequence, Is.EqualTo(2));
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 3,
                EventId = "event:visible",
                Fence = fence.Clone(),
                NodeStateCommitted = new NodeStateCommitted
                {
                    State = new NodeRuntimeState { NodeId = "node:opening-panel", Active = true, Visible = true, Opacity = 1 },
                },
            },
        }, out error), Is.True, error);
        Assert.That(store.LastReliableSequence, Is.EqualTo(3));
    }

    [TestCase(1, 2)]
    [TestCase(0, 0)]
    public void ProjectionAdvanceRejectsGapOrEmptyRange(int fromExclusive, int throughSequence)
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                FromExclusive = (ulong)fromExclusive,
                ThroughSequence = (ulong)throughSequence,
            },
        }, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [Test]
    public void ProjectionAdvanceRejectsAnotherDeliveryFence()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        RuntimeProjectionFence foreignFence = snapshot.ConnectionSnapshot.Fence.Clone();
        foreignFence.AssignmentEpoch++;

        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance { Fence = foreignFence, FromExclusive = 0, ThroughSequence = 1 },
        }, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [Test]
    public void ResyncRequiredIsNotReportedAsSuccessfulProgress()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);

        Assert.That(store.TryReceiveControl(new ControlServerItem { ResyncRequired = new ResyncRequired() }, out error), Is.False);
        Assert.That(error, Does.Contain("snapshot"));
    }

    [Test]
    public void StaleStateFrameCannotOverwriteReliableState()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        RuntimeProjectionFence fence = snapshot.ConnectionSnapshot.Fence.Clone();
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                EventId = "event:committed",
                Fence = fence.Clone(),
                NodeStateCommitted = new NodeStateCommitted
                {
                    State = new NodeRuntimeState { NodeId = "node:opening-panel", Active = true, Visible = false, Opacity = 0 },
                },
            },
        }, out error), Is.True, error);

        StateServerItem stale = new StateServerItem
        {
            StateFrame = new ElementStateFrame
            {
                Fence = fence,
                Kind = StateFrameKind.Delta,
                FrameSequence = 1,
                BaseReliableSequence = 0,
                Elements =
                {
                    new ElementStatePatch
                    {
                        ElementId = "node:opening-panel",
                        Node = new NodeStatePatch { Visible = true },
                    },
                },
            },
        };
        Assert.That(store.TryReceiveState(stale, out _), Is.False);
        Assert.That(store.TryGetNodeState("node:opening-panel", out NodeRuntimeState state), Is.True);
        Assert.That(state.Visible, Is.False);
        Assert.That(store.LastStateFrameSequence, Is.Zero);
    }

    [Test]
    public void InitialKeyframeWithCurrentReliableSequenceApplies()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.True, error);
        StateServerItem current = new StateServerItem
        {
            StateFrame = new ElementStateFrame
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                Kind = StateFrameKind.Keyframe,
                FrameSequence = 1,
                BaseReliableSequence = 0,
                Elements =
                {
                    new ElementStatePatch
                    {
                        ElementId = "node:opening-panel",
                        Node = new NodeStatePatch { Visible = false },
                    },
                },
            },
        };

        Assert.That(store.TryReceiveState(current, out error), Is.True, error);
        Assert.That(store.TryGetNodeState("node:opening-panel", out NodeRuntimeState state), Is.True);
        Assert.That(state.Visible, Is.False);
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(1));
    }

    private static PresentationRuntimeDataStore CreateLoadedStore(out DeliveryManifest delivery, out ControlServerItem snapshot)
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(
            Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery").text, out delivery, out string error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(
            Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text, out snapshot, out error), Is.True, error);
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        return store;
    }
}

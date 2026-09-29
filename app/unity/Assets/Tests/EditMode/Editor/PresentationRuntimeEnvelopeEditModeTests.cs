using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery.V2;
using Unframe.Presentation.V2;
using Unframe.Realtime.V2;
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
    public void SnapshotRejectsUnreachableSurfaceState()
    {
        PresentationRuntimeDataStore store = CreateLoadedStore(out _, out ControlServerItem snapshot);
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.SurfaceStates[0].StateId = "state:missing";

        Assert.That(store.TryReceiveControl(snapshot, out string error), Is.False);
        Assert.That(error, Does.Contain("surface state"));
        Assert.That(store.LastReliableSequence, Is.Zero);
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

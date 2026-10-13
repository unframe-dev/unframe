using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationNativeRecoveredSnapshotEditModeTests
{
    [Test]
    public void RecoveredSnapshotKeepsProgressionClockAndTransformedNodeWhenRendering()
    {
        var store = Load(out _, out ControlServerItem initial);
        Assert.That(store.TryReceiveControl(initial, out string error), Is.True, error);
        var recovered = Progressed(initial);
        Assert.That(store.TryReceiveControl(recovered, out error), Is.True, error);
        Assert.That(store.LastReliableSequence, Is.EqualTo(12));
        Assert.That(store.RuntimeClock.RuntimeTimeMs, Is.EqualTo(9000));
        Assert.That(store.Progression.GroupEntryEpoch, Is.EqualTo(3));
        Assert.That(store.Progression.StepEntryEpoch, Is.EqualTo(8));
        var root = new GameObject("recovered render fixture");
        var hierarchy = new PresentationNodeHierarchy();
        try
        {
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            new PresentationNodeStateApplier().Apply(store, hierarchy);
            var expected = recovered.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0];
            Assert.That(hierarchy.Registry.TryGet(expected.NodeId, out var node), Is.True);
            Assert.That(node.transform.localPosition.x, Is.EqualTo(4));
            Assert.That(store.TryGetNodeState(expected.NodeId, out var actual), Is.True);
            Assert.That(actual, Is.EqualTo(expected));
            Assert.That(store.TryGetLastConnectionSnapshot(out var retained), Is.True);
            Assert.That(retained, Is.EqualTo(recovered.ConnectionSnapshot));
        }
        finally
        {
            hierarchy.Clear();
            Object.DestroyImmediate(root);
        }
    }

    [TestCase("publication")]
    [TestCase("profile")]
    [TestCase("assignment")]
    public void ForeignSnapshotCannotReplaceTheRecoveredCut(string fence)
    {
        var store = Load(out _, out ControlServerItem initial);
        var recovered = Progressed(initial);
        Assert.That(store.TryReceiveControl(recovered, out string error), Is.True, error);
        var foreign = recovered.Clone();
        switch (fence)
        {
            case "publication": foreign.ConnectionSnapshot.Fence.Publication.PublicationEpoch++; break;
            case "profile": foreign.ConnectionSnapshot.Fence.ProjectionProfileId = "profile:foreign"; break;
            case "assignment": foreign.ConnectionSnapshot.Fence.AssignmentEpoch++; break;
        }
        Assert.That(store.TryReceiveControl(foreign, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.EqualTo(12));
        Assert.That(store.TryGetLastConnectionSnapshot(out var retained), Is.True);
        Assert.That(retained, Is.EqualTo(recovered.ConnectionSnapshot));
    }

    private static ControlServerItem Progressed(ControlServerItem initial)
    {
        var recovered = initial.Clone();
        var envelope = recovered.ConnectionSnapshot;
        envelope.ReliableSequence = envelope.Snapshot.ReliableSequence = envelope.Snapshot.RuntimeView.BaseReliableSequence = 12;
        var state = envelope.Snapshot.RuntimeView;
        state.Clock.RuntimeTimeMs = 9000;
        state.Progression.GroupEntryEpoch = 3;
        state.Progression.StepEntryEpoch = 8;
        state.NodeStates[0].Transform.Position.X = 4;
        state.NodeStates[0].Opacity = 0.35;
        return recovered;
    }

    private static PresentationRuntimeDataStore Load(out DeliveryManifest delivery, out ControlServerItem snapshot)
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery").text,
            out delivery, out string error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text,
            out snapshot, out error), Is.True, error);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        return store;
    }
}

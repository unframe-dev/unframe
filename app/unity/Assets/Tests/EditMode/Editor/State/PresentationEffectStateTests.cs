using System;
using System.IO;
using System.Linq;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationEffectStateTests
{
    [Test]
    public void SnapshotAndReliableReplacementPreserveRunsAndRejectDuplicateIdsAtomically()
    {
        string root = AppContext.BaseDirectory;
#if UNITY_EDITOR
        root = Path.Combine(UnityEngine.Application.dataPath, "Tests/EditMode/Editor/FixturesData");
#endif
        var delivery = JsonParser.Default.Parse<DeliveryManifest>(File.ReadAllText(Path.Combine(root, "LocalDelivery.json")));
        var snapshot = JsonParser.Default.Parse<ControlServerItem>(File.ReadAllText(Path.Combine(root, "LocalSnapshot.json")));
        var view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        foreach (var node in delivery.ProjectionProfile.RuntimeCatalog.Nodes)
        {
            node.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
            if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model)
                view.ModelClipStates.Add(new ModelClipRuntimeState { ModelNodeId = node.NodeId, DefaultPose = new DefaultModelPose() });
        }
        foreach (var surface in delivery.ProjectionProfile.RuntimeCatalog.Surfaces)
            surface.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        var run = new EffectRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 40 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:wave", CauseEventId = "event:wave" },
            EffectId = "wave",
            NodeId = view.NodeStates[0].NodeId,
            StartedAtRuntimeTimeMs = view.Clock.RuntimeTimeMs,
            Seed = 42,
            Status = EffectRunStatus.Active,
            Configuration = new EffectConfiguration
            {
                Kind = EffectKind.Wave,
                Size = 1,
                Speed = 1,
                DurationMs = 1000,
                WaveCycles = 2,
                Color = new Unframe.Presentation.SrgbaColor { Red = 1, Alpha = 1 }
            },
        };
        view.EffectRuns.Add(run);
        var store = new PresentationRuntimeDataStore();
        Assert.IsTrue(store.TryReceiveDelivery(delivery, out string error), error);
        Assert.IsTrue(store.TryReceiveControl(snapshot, out error), error);
        Assert.AreEqual(run, store.EffectRuns.Single());
        var update = new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                Sequence = 1,
                OccurredAtRuntimeTimeMs = view.Clock.RuntimeTimeMs + 1000,
                EffectRunsChanged = new EffectRunsChanged { EffectRuns = { run.Clone() } },
            }
        };
        update.ReliableEvent.EffectRunsChanged.EffectRuns[0].Status = EffectRunStatus.Retained;
        var invalid = update.Clone();
        invalid.ReliableEvent.EffectRunsChanged.EffectRuns.Add(run.Clone());
        Assert.IsFalse(store.TryReceiveNetworkControl(invalid, out _));
        Assert.AreEqual(EffectRunStatus.Active, store.EffectRuns.Single().Status);
        Assert.IsTrue(store.TryReceiveNetworkControl(update, out error), error);
        Assert.AreEqual(EffectRunStatus.Retained, store.EffectRuns.Single().Status);
        Assert.IsFalse(store.TryReceiveNetworkControl(update, out _));
        Assert.AreEqual(EffectRunStatus.Retained, store.EffectRuns.Single().Status);
        update.ReliableEvent.Sequence = 2;
        update.ReliableEvent.EffectRunsChanged.EffectRuns.Clear();
        Assert.IsTrue(store.TryReceiveNetworkControl(update, out error), error);
        Assert.IsEmpty(store.EffectRuns);
        foreach (var gesture in new[] { GestureKind.Throw, GestureKind.Circle })
        {
            update.ReliableEvent.Sequence++;
            update.ReliableEvent.GestureInputAccepted = new GestureInputAccepted { Gesture = gesture };
            Assert.IsTrue(store.TryReceiveNetworkControl(update, out error), error);
        }
    }
}

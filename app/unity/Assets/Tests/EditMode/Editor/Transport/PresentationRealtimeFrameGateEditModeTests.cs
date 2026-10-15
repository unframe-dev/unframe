using System.Reflection;
using System.Linq;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationRealtimeFrameGateEditModeTests
{
    [Test]
    public void ResumeWithoutSnapshotAcceptsContiguousReplayAndAcknowledgesItsEndCut()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var replay = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/Control/01-opening-greeting-in").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            InvokeResume(connection, "BeginReplayBootstrap");
            Assert.That(ReceiveReplay(connection, replay, out error), Is.True, error);
            InvokeResume(connection, "CompleteReplayBootstrap");
            StateReady ready = (StateReady)typeof(PresentationRealtimeConnection)
                .GetMethod("CreateStateReady", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(connection, null);
            Assert.That(ready.AppliedReliableSequence, Is.EqualTo(replay.ReliableEvent.Sequence));
            Assert.That(ready.PresentationOriginVersion, Is.EqualTo(snapshot.ConnectionSnapshot.Fence.PresentationOriginVersion));
        }
    }

    [Test]
    public void EmptyReplayAcknowledgesThePriorReliableCut()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            InvokeResume(connection, "BeginReplayBootstrap");
            InvokeResume(connection, "CompleteReplayBootstrap");
            StateReady ready = (StateReady)typeof(PresentationRealtimeConnection)
                .GetMethod("CreateStateReady", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(connection, null);
            Assert.That(ready.AppliedReliableSequence, Is.EqualTo(snapshot.ConnectionSnapshot.ReliableSequence));
        }
    }

    [Test]
    public void HiddenGapMarkerThenVisibleReplayAcknowledgesTheVisibleEventCut()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var replay = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/Control/01-opening-greeting-in").text);
        replay.ReliableEvent.Sequence = 2;
        var marker = new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                FromExclusive = 0,
                ThroughSequence = 1
            }
        };
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            InvokeResume(connection, "BeginReplayBootstrap");
            Assert.That(ReceiveReplay(connection, marker, out error), Is.True, error);
            Assert.That(store.LastReliableSequence, Is.EqualTo(1));
            Assert.That(ReceiveReplay(connection, replay, out error), Is.True, error);
            InvokeResume(connection, "CompleteReplayBootstrap");
            StateReady ready = (StateReady)typeof(PresentationRealtimeConnection)
                .GetMethod("CreateStateReady", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(connection, null);
            Assert.That(ready.AppliedReliableSequence, Is.EqualTo(2));
        }
    }

    [TestCase("wrong-from")]
    [TestCase("wrong-fence")]
    [TestCase("empty-range")]
    public void InvalidReplayMarkersDoNotAdvanceTheCursor(string invalid)
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var marker = new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                FromExclusive = 0,
                ThroughSequence = 1
            }
        };
        if (invalid == "wrong-from") { marker.ProjectionAdvance.FromExclusive = 1; marker.ProjectionAdvance.ThroughSequence = 2; }
        if (invalid == "wrong-fence") marker.ProjectionAdvance.Fence.ProjectionProfileId = "profile:other";
        if (invalid == "empty-range") marker.ProjectionAdvance.ThroughSequence = 0;
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            InvokeResume(connection, "BeginReplayBootstrap");
            Assert.That(ReceiveReplay(connection, marker, out _), Is.False);
            Assert.That(store.LastReliableSequence, Is.EqualTo(snapshot.ConnectionSnapshot.ReliableSequence));
        }
    }

    [Test]
    public void AReplayMarkerCannotEndAtTheStateNonceWithoutAVisibleEvent()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var marker = new ControlServerItem
        {
            ProjectionAdvance = new ProjectionAdvance
            {
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                FromExclusive = 0,
                ThroughSequence = 1
            }
        };
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            InvokeResume(connection, "BeginReplayBootstrap");
            Assert.That(ReceiveReplay(connection, marker, out error), Is.True, error);
            Assert.Throws<TargetInvocationException>(() => InvokeResume(connection, "CompleteReplayBootstrap"));
        }
    }

    [Test]
    public void ReplayGapIsRejectedWithoutAdvancingTheAppliedCursor()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var replay = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/Control/01-opening-greeting-in").text);
        replay.ReliableEvent.Sequence += 1;
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            InvokeResume(connection, "BeginReplayBootstrap");
            Assert.That(ReceiveReplay(connection, replay, out error), Is.False);
            Assert.That(store.LastReliableSequence, Is.EqualTo(snapshot.ConnectionSnapshot.ReliableSequence));
        }
    }

    [Test]
    public void StateReadyAcknowledgesTheSnapshotCutWhileLiveEventsContinue()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                RuntimeStatusChanged = new RuntimeStatusChanged
                {
                    Paused = new Paused { Reason = PauseReason.ExplicitPause }
                }
            }
        }, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            var method = typeof(PresentationRealtimeConnection).GetMethod("CreateStateReady", BindingFlags.Instance | BindingFlags.NonPublic);
            var ready = (StateReady)method.Invoke(connection, null);
            Assert.That(ready.AppliedReliableSequence, Is.EqualTo(snapshot.ConnectionSnapshot.ReliableSequence));
            Assert.That(store.LastReliableSequence, Is.EqualTo(1));
        }
    }

    [TestCase("01-opening-greeting-in")]
    [TestCase("17-long-text-in-from-top")]
    public void KeyframesOmitTimelineOwnedFieldsAndPreserveTheirCanonicalBase(string eventName)
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var started = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/Control/" + eventName).text);
        started.ReliableEvent.Sequence = 1;
        Assert.That(store.TryReceiveControl(started, out error), Is.True, error);
        Assert.That(store.TryGetTimeline(started.ReliableEvent.TimelineStarted.TimelineId, out ProjectedTimelineDefinition timeline), Is.True);
        StateServerItem frame = Frame(snapshot.ConnectionSnapshot.Fence, 1, store.LastReliableSequence, StateFrameKind.Keyframe);
        foreach (ProjectedTimelineTrack track in timeline.Tracks)
        {
            ElementStatePatch element = frame.StateFrame.Elements.Single(value => value.ElementId == track.Target.NodeId);
            if (track.Target.Property == TimelineProperty.Opacity) element.Node.ClearOpacity();
            else if (track.Target.Property == TimelineProperty.TransformPosition) element.Node.Transform.Position = null;
            else if (track.Target.Property == TimelineProperty.TransformRotation) element.Node.Transform.Rotation = null;
            else if (track.Target.Property == TimelineProperty.TransformScale) element.Node.Transform.Scale = null;
        }
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures)) AssertAccepted(connection, frame, true);
    }

    [TestCase("position")]
    [TestCase("rotation")]
    [TestCase("scale")]
    public void DeltaTransformUpdatesOnlyPresentComponents(string component)
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        NodeRuntimeState original = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0];
        var expected = original.Transform.Clone();
        var patch = new Unframe.Presentation.Transform();
        if (component == "position") { expected.Position.X += 1; patch.Position = expected.Position.Clone(); }
        if (component == "rotation") { expected.Rotation = new Unframe.Presentation.Quaternion { W = 1 }; patch.Rotation = expected.Rotation.Clone(); }
        if (component == "scale") { expected.Scale.X *= 2; patch.Scale = expected.Scale.Clone(); }
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            AssertAccepted(connection, Frame(snapshot.ConnectionSnapshot.Fence, 1, store.LastReliableSequence, StateFrameKind.Keyframe), true);
            StateServerItem delta = Frame(snapshot.ConnectionSnapshot.Fence, 2, store.LastReliableSequence, StateFrameKind.Delta);
            delta.StateFrame.Elements.Add(new ElementStatePatch
            {
                ElementId = original.NodeId,
                Node = new NodeStatePatch
                {
                    Transform = patch
                }
            });
            AssertAccepted(connection, delta, true);
            Assert.That(store.TryGetNodeState(original.NodeId, out NodeRuntimeState current), Is.True);
            Assert.That(current.Transform, Is.EqualTo(expected));
        }
    }

    [TestCase("empty")]
    [TestCase("position")]
    [TestCase("rotation")]
    [TestCase("scale")]
    public void InvalidPartialTransformsDoNotApplyOtherFields(string invalid)
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        NodeRuntimeState original = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0];
        var patch = new Unframe.Presentation.Transform();
        if (invalid == "position") patch.Position = new Unframe.Presentation.Vector3 { X = double.NaN };
        if (invalid == "rotation") patch.Rotation = new Unframe.Presentation.Quaternion { W = 0.5 };
        if (invalid == "scale") patch.Scale = new Unframe.Presentation.Vector3 { Y = 1, Z = 1 };
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            AssertAccepted(connection, Frame(snapshot.ConnectionSnapshot.Fence, 1, store.LastReliableSequence, StateFrameKind.Keyframe), true);
            StateServerItem delta = Frame(snapshot.ConnectionSnapshot.Fence, 2, store.LastReliableSequence, StateFrameKind.Delta);
            delta.StateFrame.Elements.Add(new ElementStatePatch
            {
                ElementId = original.NodeId,
                Node = new NodeStatePatch
                {
                    Visible = !original.Visible,
                    Transform = patch
                }
            });
            object[] args = { delta, false, null };
            var method = typeof(PresentationRealtimeConnection).GetMethod("TryReceiveStateFrame", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That((bool)method.Invoke(connection, args), Is.False);
            Assert.That(store.LastStateFrameSequence, Is.EqualTo(1));
            Assert.That(store.TryGetNodeState(original.NodeId, out NodeRuntimeState current), Is.True);
            Assert.That(current, Is.EqualTo(original));
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void NetworkFramesRejectIncompleteKeyframesAndTimelineOwnedProperties(bool timeline)
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        if (timeline)
        {
            var started = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/Control/01-opening-greeting-in").text);
            Assert.That(store.TryReceiveControl(started, out error), Is.True, error);
        }
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            StateServerItem item = Frame(snapshot.ConnectionSnapshot.Fence, 1, store.LastReliableSequence, StateFrameKind.Keyframe);
            if (!timeline) item.StateFrame.Elements.Clear();
            var method = typeof(PresentationRealtimeConnection).GetMethod("TryReceiveStateFrame", BindingFlags.Instance | BindingFlags.NonPublic);
            object[] args = { item, false, null };
            Assert.That((bool)method.Invoke(connection, args), Is.False);
            Assert.That(store.LastStateFrameSequence, Is.Zero);
        }
    }

    [Test]
    public void ControlAheadAndDeltaGapWaitForKeyframeWithoutDiscardingAcceptedState()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(
            Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text, out ControlServerItem snapshot, out string error), Is.True, error);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            RuntimeProjectionFence fence = snapshot.ConnectionSnapshot.Fence.Clone();
            AssertAccepted(connection, Frame(fence, 1, 0, StateFrameKind.Keyframe), true);
            Assert.That(store.LastStateFrameSequence, Is.EqualTo(1));
            AssertAccepted(connection, Frame(fence, 2, 1, StateFrameKind.Delta), false);
            AssertAccepted(connection, Frame(fence, 4, 0, StateFrameKind.Delta), false);
            AssertAccepted(connection, Frame(fence, 5, 0, StateFrameKind.Delta), false);
            Assert.That(store.LastStateFrameSequence, Is.EqualTo(1));
            Assert.That(store.LastReliableSequence, Is.Zero);
            AssertAccepted(connection, Frame(fence, 6, 0, StateFrameKind.Keyframe), true);
            Assert.That(store.LastStateFrameSequence, Is.EqualTo(6));
        }
    }

    [Test]
    public void NewStateStreamAcceptsRestartedSequenceAfterControlReplay()
    {
        DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var replay = new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                RuntimeStatusChanged = new RuntimeStatusChanged { Paused = new Paused { Reason = PauseReason.ExplicitPause } }
            }
        };
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            AssertAccepted(connection, Frame(snapshot.ConnectionSnapshot.Fence, 20, 0, StateFrameKind.Keyframe), true);
            InvokeResume(connection, "BeginReplayBootstrap");
            Assert.That(ReceiveReplay(connection, replay, out error), Is.True, error);
            InvokeResume(connection, "CompleteReplayBootstrap");
            RuntimeClockSnapshot clock = store.RuntimeClock;
            NodeRuntimeState original = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0];
            InvokeResume(connection, "BeginStateStream");
            Assert.That(store.RuntimeClock, Is.EqualTo(clock));
            Assert.That(store.TryGetNodeState(original.NodeId, out NodeRuntimeState retained), Is.True);
            Assert.That(retained, Is.EqualTo(original));
            Assert.That(store.LastReliableSequence, Is.EqualTo(1));
            Assert.That(store.LastStateFrameSequence, Is.Zero);
            Assert.That(store.TryGetLastConnectionSnapshot(out _), Is.True);
            AssertAccepted(connection, Frame(snapshot.ConnectionSnapshot.Fence, 1, 1, StateFrameKind.Delta), false);
            AssertAccepted(connection, Frame(snapshot.ConnectionSnapshot.Fence, 1, 1, StateFrameKind.Keyframe), true);
            AssertAccepted(connection, Frame(snapshot.ConnectionSnapshot.Fence, 1, 1, StateFrameKind.Keyframe), false);
            AssertAccepted(connection, Frame(snapshot.ConnectionSnapshot.Fence, 2, 1, StateFrameKind.Delta), true);
            Assert.That(store.LastStateFrameSequence, Is.EqualTo(2));
        }
    }

    [TestCase("origin")]
    [TestCase("reliable-cut")]
    [TestCase("delta-gap")]
    [TestCase("stream-reset")]
    [TestCase("snapshot-reset")]
    public void ReadinessRequiresCurrentKeyframeAndClosesOnResynchronization(string reason)
    {
        var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(PresentationTextureResidencyEditModeTests.BakedDelivery(), out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        using (var textures = new PresentationTextureResidency())
        using (var connection = new PresentationRealtimeConnection(store, textures))
        {
            RuntimeProjectionFence fence = snapshot.ConnectionSnapshot.Fence.Clone();
            InvokeResume(connection, "BeginStateStream");
            AssertAccepted(connection, Frame(fence, 1, 0, StateFrameKind.Delta), false);
            Assert.That(connection.SessionReady, Is.False);
            AssertAccepted(connection, Frame(fence, 1, 0, StateFrameKind.Keyframe), true);
            Assert.That(connection.SessionReady, Is.True);
            if (reason == "stream-reset") InvokeResume(connection, "BeginStateStream");
            else if (reason == "snapshot-reset") InvokeResume(connection, "ResetSnapshotBootstrap");
            else
            {
                StateServerItem stale = Frame(fence, 3, 0, StateFrameKind.Delta);
                if (reason == "origin") stale.StateFrame.Fence.PresentationOriginVersion++;
                if (reason == "reliable-cut") stale.StateFrame.BaseReliableSequence++;
                AssertAccepted(connection, stale, false);
            }
            Assert.That(connection.SessionReady, Is.False);
            AssertAccepted(connection, Frame(fence, 4, 0, StateFrameKind.Delta), false);
            Assert.That(connection.SessionReady, Is.False);
            AssertAccepted(connection, Frame(fence, 5, 0, StateFrameKind.Keyframe), true);
            Assert.That(connection.SessionReady, Is.True);
            AssertAccepted(connection, Frame(fence, 5, 0, StateFrameKind.Keyframe), false);
            Assert.That(connection.SessionReady, Is.True, "A duplicate current frame does not revoke readiness.");
        }
    }

    private static StateServerItem Frame(RuntimeProjectionFence fence, ulong sequence, ulong baseReliable, StateFrameKind kind)
    {
        var frame = new ElementStateFrame { Fence = fence.Clone(), FrameSequence = sequence, BaseReliableSequence = baseReliable, Kind = kind };
        if (kind == StateFrameKind.Keyframe)
        {
            var snapshot = Google.Protobuf.JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
            foreach (NodeRuntimeState node in snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates.OrderBy(node => node.NodeId, System.StringComparer.Ordinal))
                frame.Elements.Add(new ElementStatePatch
                {
                    ElementId = node.NodeId,
                    Node = new NodeStatePatch
                    {
                        Active = node.Active,
                        Visible = node.Visible,
                        Opacity = node.Opacity,
                        Transform = node.Transform.Clone()
                    }
                });
        }
        return new StateServerItem { StateFrame = frame };
    }

    private static void AssertAccepted(PresentationRealtimeConnection connection, StateServerItem frame, bool expectedApplied)
    {
        MethodInfo method = typeof(PresentationRealtimeConnection).GetMethod("TryReceiveStateFrame", BindingFlags.Instance | BindingFlags.NonPublic);
        object[] args = { frame, false, null };
        Assert.That((bool)method.Invoke(connection, args), Is.True, args[2]?.ToString());
        Assert.That((bool)args[1], Is.EqualTo(expectedApplied));
    }

    private static void InvokeResume(PresentationRealtimeConnection connection, string method)
    {
        MethodInfo target = typeof(PresentationRealtimeConnection).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.That(target, Is.Not.Null);
        target.Invoke(connection, null);
    }

    private static bool ReceiveReplay(PresentationRealtimeConnection connection, ControlServerItem item, out string error)
    {
        object[] args = { item, null };
        bool accepted = (bool)typeof(PresentationRealtimeConnection)
            .GetMethod("TryReceiveReplayBootstrap", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(connection, args);
        error = args[1] as string;
        return accepted;
    }
}

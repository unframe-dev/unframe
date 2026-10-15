using NUnit.Framework;
using Google.Protobuf;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationRuntimeDataStoreEditModeTests
{
    [Test]
    public void SurfaceInteractionAcceptancePreservesStateAndAdvancesReliableCut()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                SurfaceInteractionAccepted = new SurfaceInteractionAccepted
                {
                    SurfaceId = "surface:main",
                    InteractionId = "interaction:submit"
                },
            }
        }, out string error), Is.True, error);
        Assert.That(store.LastReliableSequence, Is.EqualTo(1));
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState node), Is.True);
        Assert.That(node.Opacity, Is.EqualTo(1));
    }

    [Test]
    public void GroupInitializationRejectsPresentationOwnedStateWithoutMutation()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                GroupExited = new GroupExited { GroupId = "group:main", GroupEntryEpoch = 1 },
            }
        }, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = CreateFence(delivery),
                GroupEntered = new GroupEntered
                {
                    GroupId = "group:next",
                    GroupEntryEpoch = 2,
                    Initialization = new GroupRuntimeInitialization { NodeStates = { new NodeRuntimeState { NodeId = "node:model", Active = true, Visible = true, Opacity = 0.5 } } }
                },
            }
        }, out error), Is.False);
        Assert.That(store.LastReliableSequence, Is.EqualTo(1));
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState node), Is.True);
        Assert.That(node.Opacity, Is.EqualTo(1));
    }

    [Test]
    public void StateFrameSamplesAdvanceTheRunningClock()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        ElementStateFrame frame = CreateStateFrame(delivery, 1, StateFrameKind.Keyframe, new NodeStatePatch { Opacity = 0.5 });
        frame.ProducedAtRuntimeTimeMs = 17;
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out string error), Is.True, error);
        Assert.That(store.RuntimeClock.RuntimeTimeMs, Is.EqualTo(17));
    }

    [Test]
    public void GroupExitRemovesOwnedStateAndHidesItsGeneratedNode()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:main" } };
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        GameObject root = new GameObject("group-stage");
        PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
        try
        {
            Assert.That(hierarchy.TryReplace(store, root.transform, out string error), Is.True, error);
            PresentationNodeStateApplier applier = new PresentationNodeStateApplier();
            applier.Apply(store, hierarchy);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject node), Is.True);
            Assert.That(node.activeSelf, Is.True);
            Assert.That(store.TryReceiveControl(new ControlServerItem
            {
                ReliableEvent = new ProjectedReliableEvent
                {
                    Sequence = 1,
                    Fence = CreateFence(delivery),
                    GroupExited = new GroupExited { GroupId = "group:main", GroupEntryEpoch = 1 },
                }
            }, out error), Is.True, error);
            Assert.That(store.TryGetNodeState("node:model", out _), Is.False);
            applier.Apply(store, hierarchy);
            Assert.That(node.activeSelf, Is.False);
        }
        finally { hierarchy.Clear(); Object.DestroyImmediate(root); }
    }

    [TestCase("node")]
    [TestCase("surface")]
    [TestCase("variable")]
    public void InactiveGroupResourceEventsDoNotRecreateOwnedState(string resource)
    {
        DeliveryManifest delivery = CreateDelivery();
        ResourceOwner groupOwner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:main" } };
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Owner = groupOwner.Clone();
        delivery.ProjectionProfile.RuntimeCatalog.Surfaces[0].Owner = groupOwner.Clone();
        delivery.ProjectionProfile.RuntimeCatalog.Variables[0].Owner = groupOwner.Clone();
        delivery.ProjectionProfile.RuntimeCatalog.Variables[0].Type = ScalarType.String;
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveNetworkControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                GroupExited = new GroupExited { GroupId = "group:main", GroupEntryEpoch = 1 },
            }
        }, out string error), Is.True, error);
        ProjectedReliableEvent oldGroupEvent = new ProjectedReliableEvent { Sequence = 2, Fence = CreateFence(delivery) };
        switch (resource)
        {
            case "node":
                oldGroupEvent.NodeStateCommitted = new NodeStateCommitted
                {
                    State = new NodeRuntimeState
                    {
                        NodeId = "node:model",
                        Active = true,
                        Visible = true,
                        Opacity = 1,
                        Transform = CreateValidTransform(),
                    }
                }; break;
            case "surface": oldGroupEvent.SurfaceStateChanged = new SurfaceStateChanged { SurfaceId = "surface:main", StateId = "state:main" }; break;
            case "variable":
                oldGroupEvent.VariableChanged = new VariableChanged
                {
                    State = new VariableState
                    {
                        VariableId = "variable:title",
                        Value = new ScalarValue { StringValue = "stale" },
                    }
                }; break;
        }
        Assert.That(store.TryReceiveNetworkControl(new ControlServerItem { ReliableEvent = oldGroupEvent }, out _), Is.False, resource);
        Assert.That(store.LastReliableSequence, Is.EqualTo(1), resource);
        Assert.That(store.TryGetNodeState("node:model", out _), Is.False, resource);
        Assert.That(store.TryGetSurfaceState("surface:main", out _), Is.False, resource);
        Assert.That(store.TryGetVariableState("variable:title", out _), Is.False, resource);
    }

    [TestCase("node")]
    [TestCase("variable")]
    public void NetworkResourceEventsRejectMissingStateWithoutThrowing(string resource)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        ProjectedReliableEvent malformed = new ProjectedReliableEvent { Sequence = 1, Fence = CreateFence(delivery) };
        if (resource == "node") malformed.NodeStateCommitted = new NodeStateCommitted();
        else malformed.VariableChanged = new VariableChanged();
        Assert.That(store.TryReceiveNetworkControl(new ControlServerItem { ReliableEvent = malformed }, out _), Is.False, resource);
        Assert.That(store.LastReliableSequence, Is.Zero, resource);
    }

    [Test]
    public void NetworkReadinessRequiresEveryOwnedResourceAtTheSnapshotCut()
    {
        DeliveryManifest delivery = JsonParser.Default.Parse<DeliveryManifest>(Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery").text);
        ProjectedRuntimeCatalog catalog = delivery.ProjectionProfile.RuntimeCatalog;
        foreach (ProjectedNodeDefinition node in catalog.Nodes) node.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces) surface.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        foreach (ProjectedVariableDefinition variable in catalog.Variables) { variable.Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() }; variable.Type = ScalarType.String; }
        ControlServerItem snapshot = JsonParser.Default.Parse<ControlServerItem>(Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text);
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryValidateRuntimeOwnership(out _), Is.False);
        foreach (ProjectedVariableDefinition variable in catalog.Variables)
            snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Variables.Add(new VariableState { VariableId = variable.VariableId, Value = new ScalarValue { StringValue = "value" } });
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryValidateRuntimeOwnership(out error), Is.True, error);
        VariableState firstVariable = snapshot.ConnectionSnapshot.Snapshot.RuntimeView.Variables[0];
        ScalarValue validValue = firstVariable.Value.Clone();
        firstVariable.Value = new ScalarValue { NumberValue = 1 };
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryValidateRuntimeOwnership(out _), Is.False, "A value with a different declared scalar type must not reach StateReady.");
        firstVariable.Value = null;
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryValidateRuntimeOwnership(out _), Is.False, "Missing scalar values must not reach StateReady.");
        firstVariable.Value = validValue;
        snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0].Transform = null;
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryValidateRuntimeOwnership(out _), Is.False, "Incomplete node state must not reach StateReady.");
    }

    [Test]
    public void NetworkVariableChangesRejectMismatchedValuesWithoutAdvancingCursor()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Variables[0].Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        delivery.ProjectionProfile.RuntimeCatalog.Variables[0].Type = ScalarType.String;
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        ControlServerItem item = new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                VariableChanged = new VariableChanged
                {
                    State = new VariableState { VariableId = "variable:title", Value = new ScalarValue { NumberValue = 1 } },
                },
            }
        };
        Assert.That(store.TryReceiveNetworkControl(item, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
        Assert.That(store.TryGetVariableState("variable:title", out _), Is.False);
        item.ReliableEvent.VariableChanged.State.Value = new ScalarValue { StringValue = "title" };
        Assert.That(store.TryReceiveNetworkControl(item, out string error), Is.True, error);
        Assert.That(store.LastReliableSequence, Is.EqualTo(1));
    }

    [TestCase("negative-zero opacity")]
    [TestCase("negative-zero transform")]
    [TestCase("non-unit quaternion")]
    public void NetworkSnapshotRejectsNonCanonicalNodeValues(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
        NodeRuntimeState state = snapshot.Snapshot.RuntimeView.NodeStates[0];
        if (invalidCase == "negative-zero opacity") state.Opacity = -0.0;
        else if (invalidCase == "negative-zero transform") state.Transform.Position.X = -0.0;
        else state.Transform.Rotation.W = 2;

        Assert.That(store.TryReceiveNetworkControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out _), Is.False, invalidCase);
        Assert.That(store.LastReliableSequence, Is.Zero, invalidCase);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState retained), Is.True);
        Assert.That(retained.Opacity, Is.EqualTo(1), invalidCase);
        Assert.That(retained.Transform.Rotation.W, Is.EqualTo(1), invalidCase);
    }

    [TestCase("negative-zero position")]
    [TestCase("non-canonical quaternion sign")]
    public void NetworkOriginEventRejectsNonCanonicalPoseWithoutAdvancingCursor(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Unframe.Presentation.Pose pose = new Unframe.Presentation.Pose
        {
            Position = new Unframe.Presentation.Vector3(),
            Rotation = new Unframe.Presentation.Quaternion { W = 1 },
        };
        if (invalidCase == "negative-zero position") pose.Position.X = -0.0;
        else pose.Rotation.W = -1;
        Assert.That(store.TryReceiveNetworkControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                PresentationOriginChanged = new PresentationOriginChanged
                {
                    Origin = new PresentationOrigin { Version = 1, Pose = pose },
                },
            }
        }, out _), Is.False, invalidCase);
        Assert.That(store.LastReliableSequence, Is.Zero, invalidCase);
        Assert.That(store.PresentationOrigin, Is.Null, invalidCase);
    }

    [Test]
    public void OriginChangesAdvanceTheFenceAndPresenceEventsRemainReliable()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                PresentationOriginChanged = new PresentationOriginChanged
                {
                    Origin = new PresentationOrigin { Version = 1, Pose = new Unframe.Presentation.Pose { Position = new Unframe.Presentation.Vector3(), Rotation = new Unframe.Presentation.Quaternion { W = 1 } } }
                },
            }
        }, out string error), Is.True, error);
        RuntimeProjectionFence fence = CreateFence(delivery);
        fence.PresentationOriginVersion = 1;
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = fence,
                ParticipantPresenceChanged = new ParticipantPresenceChanged { ParticipantId = "participant:viewer", Role = SessionRole.Viewer, Connected = true },
            }
        }, out error), Is.True, error);
        Assert.That(store.LastReliableSequence, Is.EqualTo(2));
    }

    [TestCase(2U, 1U)]
    [TestCase(1U, 2U)]
    public void DeliveryRejectsUnknownProgressionAndProjectionVersions(uint progression, uint projection)
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.CapabilityProfile.ContractVersions.Progression = progression;
        delivery.CapabilityProfile.ContractVersions.Projection = projection;
        delivery.ProjectionProfile.Key.ProjectionContractVersion = projection;
        Assert.That(new PresentationRuntimeDataStore().TryReceiveDelivery(delivery, out _), Is.False);
    }

    [Test]
    public void SurfaceTransitionRetainsBothStatesUntilItsMatchingCompletion()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Surfaces[0].ReachableStateIds.Add("state:next");
        delivery.ProjectionProfile.SemanticSurfaces[0].States.Add(new SurfaceSemanticState { StateId = "state:next", SemanticTree = new ProjectedSemanticTree() });
        delivery.ProjectionProfile.RenderSurfaces[0].StateBindings.Add(new DeliveredStateBinding { StateId = "state:next", Artifact = new ArtifactStateBinding { ArtifactId = "artifact:main" } });
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                SurfaceStateChanged = new SurfaceStateChanged { SurfaceId = "surface:main", StateId = "state:main" },
            }
        }, out string error), Is.True, error);
        RuntimeRunId id = new RuntimeRunId { AssignmentEpoch = 7, RunSequence = 1 };
        RuntimeRunSnapshot run = new RuntimeRunSnapshot
        {
            RunId = id,
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:main", CauseEventId = "event:input" },
            Completion = RunCompletion.NonBlocking,
            SurfaceTransition = new SurfaceTransitionRunSnapshot { SurfaceId = "surface:main", FromStateId = "state:main", ToStateId = "state:next", DurationMs = 100, Easing = Easing.Linear }
        };
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = CreateFence(delivery),
                SurfaceTransitionStarted = new SurfaceTransitionStarted
                {
                    SurfaceId = "surface:main",
                    RunId = id,
                    FromStateId = "state:main",
                    StateId = "state:next",
                    DurationMs = 100,
                    Easing = Easing.Linear,
                    Run = run
                },
            }
        }, out error), Is.True, error);
        Assert.That(store.TryGetSurfaceState("surface:main", out SurfaceRuntimeState state), Is.True);
        Assert.That(state.TransitionRunId, Is.EqualTo(id));
        Assert.That(state.StateId, Is.EqualTo("state:next"));
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.EqualTo(1));
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 3,
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 100,
                SurfaceTransitionCompleted = new SurfaceTransitionCompleted { SurfaceId = "surface:main", RunId = id, StateId = "state:next" },
            }
        }, out error), Is.True, error);
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.Zero);
        Assert.That(store.TryGetSurfaceState("surface:main", out state), Is.True);
        Assert.That(state.TransitionRunId, Is.Null);
    }

    [Test]
    public void PresentationEndClearsInFlightSurfaceTransitionRunReference()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Surfaces[0].ReachableStateIds.Add("state:next");
        delivery.ProjectionProfile.SemanticSurfaces[0].States.Add(new SurfaceSemanticState { StateId = "state:next", SemanticTree = new ProjectedSemanticTree() });
        delivery.ProjectionProfile.RenderSurfaces[0].StateBindings.Add(new DeliveredStateBinding { StateId = "state:next", Artifact = new ArtifactStateBinding { ArtifactId = "artifact:main" } });
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                SurfaceStateChanged = new SurfaceStateChanged { SurfaceId = "surface:main", StateId = "state:main" },
            }
        }, out string error), Is.True, error);
        RuntimeRunId id = new RuntimeRunId { AssignmentEpoch = 7, RunSequence = 1 };
        RuntimeRunSnapshot run = new RuntimeRunSnapshot
        {
            RunId = id,
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:main", CauseEventId = "event:input" },
            Completion = RunCompletion.NonBlocking,
            SurfaceTransition = new SurfaceTransitionRunSnapshot { SurfaceId = "surface:main", FromStateId = "state:main", ToStateId = "state:next", DurationMs = 100, Easing = Easing.Linear }
        };
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = CreateFence(delivery),
                SurfaceTransitionStarted = new SurfaceTransitionStarted
                {
                    SurfaceId = "surface:main",
                    RunId = id,
                    FromStateId = "state:main",
                    StateId = "state:next",
                    DurationMs = 100,
                    Easing = Easing.Linear,
                    Run = run
                },
            }
        }, out error), Is.True, error);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 3,
                Fence = CreateFence(delivery),
                PresentationEnded = new PresentationEnded { Reason = TerminationReason.ExplicitEnd },
            }
        }, out error), Is.True, error);
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.Zero);
        Assert.That(store.TryGetSurfaceState("surface:main", out SurfaceRuntimeState state), Is.True);
        Assert.That(state.StateId, Is.EqualTo("state:next"));
        Assert.That(state.TransitionRunId, Is.Null);
        Assert.That(store.LastReliableSequence, Is.EqualTo(3));
    }

    [Test]
    public void GroupInitializationAndStepEntryReplaceTheCurrentProgression()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
        delivery.ProjectionProfile.RuntimeCatalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:next",
            Parent = new SpatialParent { Stage = new StageParent() },
            Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:next" } },
            Container = new ContainerNode()
        });
        delivery.ProjectionProfile.VisibleNodeIds.Add("node:next");
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                Fence = CreateFence(delivery),
                GroupExited = new GroupExited { GroupId = "group:main", GroupEntryEpoch = 1 },
            }
        }, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                Fence = CreateFence(delivery),
                GroupEntered = new GroupEntered
                {
                    GroupId = "group:next",
                    GroupEntryEpoch = 2,
                    Initialization = new GroupRuntimeInitialization { NodeStates = { new NodeRuntimeState { NodeId = "node:next", Active = true, Visible = true, Opacity = 0.5, Transform = CreateValidTransform() } } }
                },
            }
        }, out error), Is.True, error);
        Assert.That(store.Progression.CurrentGroupId, Is.EqualTo("group:next"));
        Assert.That(store.TryGetNodeState("node:next", out NodeRuntimeState node), Is.True);
        Assert.That(node.Opacity, Is.EqualTo(0.5));
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 3,
                Fence = CreateFence(delivery),
                StepEntered = new StepEntered { GroupId = "group:next", GroupEntryEpoch = 2, StepId = "step:next", StepEntryEpoch = 2 },
            }
        }, out error), Is.True, error);
    }

    [Test]
    public void TimelineRunIsRestoredAndRemovedOnlyByTheMatchingCompletion()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        RuntimeRunId runId = new RuntimeRunId { AssignmentEpoch = 7, RunSequence = 1 };
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                EventId = "event:timeline",
                Fence = CreateFence(delivery),
                TimelineStarted = new TimelineStarted { RunId = runId, TimelineId = "timeline:main", Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() }, Cause = new RuntimeRunCause { CueId = "cue:main", CauseEventId = "event:input" }, Completion = RunCompletion.NonBlocking },
            }
        }, out string error), Is.True, error);
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.EqualTo(1));
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                EventId = "event:wrong",
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 3,
                TimelineCompleted = new TimelineCompleted { RunId = new RuntimeRunId { AssignmentEpoch = 7, RunSequence = 2 }, TimelineId = "timeline:main" },
            }
        }, out error), Is.False);
        Assert.That(store.LastReliableSequence, Is.EqualTo(1));
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                EventId = "event:complete",
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 3,
                TimelineCompleted = new TimelineCompleted { RunId = runId, TimelineId = "timeline:main" },
            }
        }, out error), Is.True, error);
        Assert.That(System.Linq.Enumerable.Count(store.ActiveRuns), Is.Zero);
    }

    [Test]
    public void RuntimeStatusAndStepEventsUpdateTheProjectedClockAndProgression()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                EventId = "event:pause",
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 42,
                RuntimeStatusChanged = new RuntimeStatusChanged { Paused = new Paused { Reason = PauseReason.ExplicitPause } },
            }
        }, out string error), Is.True, error);
        Assert.That(store.RuntimeClock.RuntimeTimeMs, Is.EqualTo(42));
        Assert.That(store.RuntimeClock.StatusCase, Is.EqualTo(RuntimeClockSnapshot.StatusOneofCase.Paused));
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 2,
                EventId = "event:step",
                Fence = CreateFence(delivery),
                OccurredAtRuntimeTimeMs = 42,
                StepEntered = new StepEntered { GroupId = "group:main", GroupEntryEpoch = 1, StepId = "step:next", StepEntryEpoch = 2, EnteredAtRuntimeTimeMs = 42 },
            }
        }, out error), Is.True, error);
        Assert.That(store.Progression.CurrentStepId, Is.EqualTo("step:next"));
        Assert.That(store.Progression.StepEntryEpoch, Is.EqualTo(2));
        Assert.That(store.LastReliableSequence, Is.EqualTo(2));
    }

    [Test]
    public void Delivery_IndexesContractEntitiesById()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();

        Assert.That(store.TryReceiveDelivery(Serialize(CreateDelivery()), out string error), Is.True, error);
        Assert.That(store.TryGetNode("node:model", out ProjectedNodeDefinition node), Is.True);
        Assert.That(node.Model.ModelAssetId, Is.EqualTo("asset:model"));
        Assert.That(store.TryGetSurface("surface:main", out _), Is.True);
        Assert.That(store.TryGetAsset("asset:model", out _), Is.True);
        Assert.That(store.TryGetModel("asset:model", out _), Is.True);
        Assert.That(store.TryGetTimeline("timeline:main", out _), Is.True);
        Assert.That(store.TryGetVariable("variable:title", out _), Is.True);
        Assert.That(store.TryGetModelClip("node:model", "clip:idle", out _), Is.True);
    }

    [Test]
    public void BinaryDeliveryPreservesProjectionFenceAndAssetAccessDescriptor()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.AssetAccess[0].Checksum = "sha256:" + new string('e', 64);
        delivery.AssetAccess[0].MediaType = "model/gltf-binary";
        delivery.AssetAccess[0].EncodedSizeBytes = 12345;
        delivery.AssetAccess[0].Url = "https://assets.example.test/model.glb";
        delivery.AssetAccess[0].ExpiresAtUnixMs = 67890;
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();

        Assert.That(store.TryReceiveDelivery(Serialize(delivery), out string error), Is.True, error);
        Assert.That(store.Delivery.Publication, Is.EqualTo(delivery.Publication));
        Assert.That(store.Delivery.ProjectionInstance, Is.EqualTo(delivery.ProjectionInstance));
        Assert.That(store.Delivery.ProjectionProfile.Key, Is.EqualTo(delivery.ProjectionProfile.Key));
        Assert.That(store.TryGetAsset("asset:model", out AssetAccessBinding asset), Is.True);
        Assert.That(asset, Is.EqualTo(delivery.AssetAccess[0]));
    }

    [Test]
    public void SnapshotAndRealtimeUpdates_RequireTheDeliveryFenceAndExposeState()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        DeliveryManifest delivery = CreateDelivery();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);

        ConnectionSnapshotEnvelope snapshot = new ConnectionSnapshotEnvelope
        {
            SchemaVersion = 2,
            Fence = CreateFence(delivery),
            ProjectionInstance = delivery.ProjectionInstance.Clone(),
            ReliableSequence = 4,
            Snapshot = new ProjectedRuntimeSnapshot
            {
                ProjectionProfileId = "profile:quest",
                AssignmentEpoch = 7,
                ReliableSequence = 4,
                RuntimeView = new ParticipantRuntimeView
                {
                    ProjectionProfileId = "profile:quest",
                    AssignmentEpoch = 7,
                    BaseReliableSequence = 4,
                    Clock = new RuntimeClockSnapshot { Running = new Running() },
                    Progression = new ProgressionRuntimeState { CurrentGroupId = "group:main", GroupEntryEpoch = 1, CurrentStepId = "step:main", StepEntryEpoch = 1, Stable = new StableProgression() },
                },
            },
        };
        snapshot.Snapshot.RuntimeView.NodeStates.Add(new NodeRuntimeState { NodeId = "node:model", Active = true, Visible = true, Opacity = 1 });

        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out error), Is.True, error);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState initial), Is.True);
        Assert.That(initial.Visible, Is.True);

        ProjectedReliableEvent update = new ProjectedReliableEvent
        {
            Sequence = 5,
            EventId = "event:5",
            Fence = CreateFence(delivery),
            NodeStateCommitted = new NodeStateCommitted { State = new NodeRuntimeState { NodeId = "node:model", Active = true, Visible = false, Opacity = 0.5 } },
        };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = update }, out error), Is.True, error);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState changed), Is.True);
        Assert.That(changed.Visible, Is.False);
        Assert.That(store.LastReliableSequence, Is.EqualTo(5));
    }

    [Test]
    public void SnapshotRejectsModelRunWithoutMatchingActiveModelState()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
        RuntimeRunId runId = new RuntimeRunId { AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch, RunSequence = 1 };
        snapshot.Snapshot.RuntimeView.ActiveRuns.Add(new RuntimeRunSnapshot
        {
            RunId = runId,
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:main", CauseEventId = "event:main" },
            Completion = RunCompletion.NonBlocking,
            ModelClip = new ModelClipRunSnapshot
            {
                ModelNodeId = "node:model",
                Single = new ClipPlayback { ClipId = "clip:idle", Playback = new PlaybackClock { Paused = new PausedClock() }, Speed = 1 },
            },
        });
        snapshot.Snapshot.RuntimeView.ModelClipStates.Add(new ModelClipRuntimeState
        {
            ModelNodeId = "node:model",
            DefaultPose = new DefaultModelPose(),
        });

        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out _), Is.False);
    }

    [TestCase("crossfade terminal", true)]
    [TestCase("crossfade deadline", false)]
    [TestCase("nonloop exact deadline", false)]
    [TestCase("loop overflow", false)]
    [TestCase("loop elapsed beyond duration", true)]
    [TestCase("nonloop elapsed beyond duration", false)]
    [TestCase("valid", true)]
    [TestCase("unknown clip", false)]
    [TestCase("future reference", false)]
    [TestCase("loop paused beyond duration", true)]
    [TestCase("nonloop paused beyond duration", false)]
    [TestCase("loop playing beyond duration", true)]
    [TestCase("nonloop playing beyond duration", false)]
    public void SnapshotChecksModelClipCatalogAndRuntimeReference(string variant, bool expected)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
        RuntimeRunId runId = new RuntimeRunId { AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch, RunSequence = 1 };
        ClipPlayback playback = new ClipPlayback
        {
            ClipId = variant == "unknown clip" ? "clip:missing" : "clip:idle",
            Playback = variant == "future reference"
                ? new PlaybackClock { Playing = new PlayingClock { ReferenceRuntimeTimeMs = 100 } }
                : variant.Contains("playing beyond duration") || variant.Contains("elapsed") || variant.Contains("overflow") || variant.Contains("exact deadline") || variant.StartsWith("crossfade")
                    ? new PlaybackClock { Playing = new PlayingClock { PositionAtReferenceMs = variant.Contains("playing beyond duration") ? 101 : 0 } }
                    : new PlaybackClock { Paused = new PausedClock { PositionMs = variant.Contains("paused beyond duration") ? 101 : 0 } },
            Speed = variant.Contains("overflow") ? 1e308 : 1,
            Loop = variant.StartsWith("loop"),
        };
        if (variant.Contains("overflow") || variant.Contains("elapsed") || variant.Contains("exact deadline") || variant.StartsWith("crossfade"))
            snapshot.Snapshot.RuntimeView.Clock.RuntimeTimeMs = variant.Contains("overflow") ? 2UL : variant.Contains("exact deadline") ? 100UL : 101UL;
        snapshot.Snapshot.RuntimeView.ActiveRuns.Add(new RuntimeRunSnapshot
        {
            RunId = runId,
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:main", CauseEventId = "event:main" },
            Completion = RunCompletion.NonBlocking,
            ModelClip = new ModelClipRunSnapshot { ModelNodeId = "node:model", Single = playback },
        });
        if (variant.StartsWith("crossfade"))
            snapshot.Snapshot.RuntimeView.ActiveRuns[snapshot.Snapshot.RuntimeView.ActiveRuns.Count - 1].ModelClip.Crossfade = new ModelClipCrossfade
            {
                From = new ClipPlayback { ClipId = "clip:idle", Speed = 1, Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 100 } } },
                To = playback,
                FromIsHeld = true,
                DurationMs = 10,
                Easing = Easing.Linear,
                TransitionClock = new PlaybackClock { Playing = new PlayingClock { ReferenceRuntimeTimeMs = variant.Contains("deadline") ? 91UL : 100UL } },
            };
        snapshot.Snapshot.RuntimeView.ModelClipStates.Add(new ModelClipRuntimeState
        {
            ModelNodeId = "node:model",
            Active = new ModelClipActive { RunId = runId.Clone() },
        });

        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out string error), Is.EqualTo(expected), error);
    }

    [Test]
    public void StateFrame_RequiresAKeyframeBeforeDeltas()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        ElementStateFrame delta = CreateStateFrame(delivery, 1, StateFrameKind.Delta, new NodeStatePatch { Opacity = 0.5 });

        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = delta }, out string error), Is.False);
        Assert.That(error, Does.Contain("keyframe"));
        Assert.That(store.LastStateFrameSequence, Is.Zero);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState state), Is.True);
        Assert.That(state.Opacity, Is.EqualTo(1));
    }

    [Test]
    public void StateFrame_RejectsDeltaGapsUntilANewKeyframeArrives()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);

        Assert.That(store.TryReceiveState(new StateServerItem
        {
            StateFrame = CreateStateFrame(delivery, 7, StateFrameKind.Keyframe, new NodeStatePatch { Opacity = 0.75 }),
        }, out string error), Is.True, error);

        Assert.That(store.TryReceiveState(new StateServerItem
        {
            StateFrame = CreateStateFrame(delivery, 9, StateFrameKind.Delta, new NodeStatePatch { Opacity = 0.25 }),
        }, out error), Is.False);
        Assert.That(error, Does.Contain("contiguous"));
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(7));
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState afterGap), Is.True);
        Assert.That(afterGap.Opacity, Is.EqualTo(0.75));

        Assert.That(store.TryReceiveState(new StateServerItem
        {
            StateFrame = CreateStateFrame(delivery, 10, StateFrameKind.Keyframe, new NodeStatePatch { Opacity = 0.5 }),
        }, out error), Is.True, error);
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(10));
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState recovered), Is.True);
        Assert.That(recovered.Opacity, Is.EqualTo(0.5));
    }

    [TestCase("empty patch")]
    [TestCase("NaN opacity")]
    [TestCase("infinite opacity")]
    [TestCase("negative opacity")]
    [TestCase("opacity over one")]
    [TestCase("missing transform position")]
    [TestCase("non-finite position")]
    [TestCase("zero scale")]
    [TestCase("non-finite scale")]
    [TestCase("zero quaternion")]
    [TestCase("non-finite quaternion")]
    [TestCase("negative-zero opacity")]
    [TestCase("negative-zero position")]
    [TestCase("negative-zero quaternion")]
    [TestCase("non-unit quaternion")]
    [TestCase("non-canonical quaternion sign")]
    public void StateFrame_RejectsInvalidPatches(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        NodeStatePatch patch = invalidCase == "empty patch"
            ? new NodeStatePatch()
            : new NodeStatePatch { Opacity = 0.5 };

        switch (invalidCase)
        {
            case "NaN opacity": patch.Opacity = double.NaN; break;
            case "infinite opacity": patch.Opacity = double.PositiveInfinity; break;
            case "negative opacity": patch.Opacity = -0.01; break;
            case "opacity over one": patch.Opacity = 1.01; break;
            case "missing transform position": patch.Transform = new Unframe.Presentation.Transform(); break;
            case "non-finite position": patch.Transform = CreateValidTransform(); patch.Transform.Position.X = double.NaN; break;
            case "zero scale": patch.Transform = CreateValidTransform(); patch.Transform.Scale.X = 0; break;
            case "non-finite scale": patch.Transform = CreateValidTransform(); patch.Transform.Scale.Y = double.PositiveInfinity; break;
            case "zero quaternion": patch.Transform = CreateValidTransform(); patch.Transform.Rotation = new Unframe.Presentation.Quaternion(); break;
            case "non-finite quaternion": patch.Transform = CreateValidTransform(); patch.Transform.Rotation.W = double.NaN; break;
            case "negative-zero opacity": patch.Opacity = -0.0; break;
            case "negative-zero position": patch.Transform = CreateValidTransform(); patch.Transform.Position.X = -0.0; break;
            case "negative-zero quaternion": patch.Transform = CreateValidTransform(); patch.Transform.Rotation.X = -0.0; break;
            case "non-unit quaternion": patch.Transform = CreateValidTransform(); patch.Transform.Rotation.W = 0.5; break;
            case "non-canonical quaternion sign": patch.Transform = CreateValidTransform(); patch.Transform.Rotation.W = -1; break;
        }

        ElementStateFrame frame = CreateStateFrame(delivery, 1, StateFrameKind.Keyframe, patch);
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out string error), Is.False, invalidCase);
        Assert.That(error, Does.Contain("patch"), invalidCase);
        Assert.That(store.LastStateFrameSequence, Is.Zero, invalidCase);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState state), Is.True);
        Assert.That(state.Opacity, Is.EqualTo(1), invalidCase);
    }

    [Test]
    public void DeliveryReplacement_ResetsRuntimeOnlyAfterTheCatalogAcceptsTheDelivery()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryReceiveState(new StateServerItem
        {
            StateFrame = CreateStateFrame(delivery, 7, StateFrameKind.Keyframe, new NodeStatePatch { Opacity = 0.4 }),
        }, out string error), Is.True, error);

        DeliveryManifest invalidDelivery = delivery.Clone();
        invalidDelivery.ProjectionProfile.RuntimeCatalog.Nodes.Add(invalidDelivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Clone());
        Assert.That(store.TryReceiveDelivery(invalidDelivery, out error), Is.False);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState retained), Is.True);
        Assert.That(retained.Opacity, Is.EqualTo(0.4));
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(7));

        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        Assert.That(store.TryGetNodeState("node:model", out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.Zero);
        Assert.That(store.LastStateFrameSequence, Is.Zero);
    }

    [Test]
    public void Delivery_RejectsDuplicateIds()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes.Add(delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Clone());

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False);
        Assert.That(error, Does.Contain("duplicated"));
    }

    [Test]
    public void Delivery_RejectsTimelineTracksThatReferenceUnknownNodes()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].Tracks[0].Target.NodeId = "node:missing";

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False);
        Assert.That(error, Does.Contain("timeline track"));
    }

    [TestCase("single keyframe")]
    [TestCase("missing start")]
    [TestCase("missing end")]
    [TestCase("repeated time")]
    [TestCase("missing easing")]
    [TestCase("final easing")]
    [TestCase("unsupported easing")]
    public void Delivery_RejectsTimelineTracksWithoutCompleteSegments(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedTimelineTrack track = delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].Tracks[0];
        switch (invalidCase)
        {
            case "single keyframe": track.Keyframes.RemoveAt(1); break;
            case "missing start": track.Keyframes[0].TimeMs = 1; break;
            case "missing end": track.Keyframes[1].TimeMs = 2; break;
            case "repeated time": track.Keyframes[1].TimeMs = 0; break;
            case "missing easing": track.Keyframes[0].ClearEasingToNext(); break;
            case "final easing": track.Keyframes[1].EasingToNext = Easing.Linear; break;
            case "unsupported easing": track.Keyframes[0].EasingToNext = Easing.Unspecified; break;
        }

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False, invalidCase);
        Assert.That(error, Does.Contain("timeline"), invalidCase);
    }

    [Test]
    public void Delivery_RejectsDuplicateTimelineTargets()
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedTimelineDefinition timeline = delivery.ProjectionProfile.RuntimeCatalog.Timelines[0];
        timeline.Tracks.Add(timeline.Tracks[0].Clone());

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False);
        Assert.That(error, Does.Contain("timeline"));
    }

    [Test]
    public void Delivery_RejectsNonFiniteTimelineValues()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].Tracks[0].Keyframes[1].Number.Value = double.NaN;

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False);
        Assert.That(error, Does.Contain("timeline"));
    }

    [Test]
    public void Delivery_RejectsNonFiniteVectorAndZeroQuaternionTimelineValues()
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedTimelineTrack track = delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].Tracks[0];
        track.Target.Property = TimelineProperty.TransformPosition;
        track.Keyframes[0].Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = double.PositiveInfinity } };
        track.Keyframes[1].Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3() };

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False);
        Assert.That(error, Does.Contain("timeline"));

        track.Target.Property = TimelineProperty.TransformRotation;
        track.Keyframes[0].Quaternion = new QuaternionKeyframeValue { Value = new Unframe.Presentation.Quaternion() };
        track.Keyframes[1].Quaternion = new QuaternionKeyframeValue { Value = new Unframe.Presentation.Quaternion { W = 1 } };
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.False);
        Assert.That(error, Does.Contain("timeline"));
    }

    [TestCase("negative-zero opacity")]
    [TestCase("opacity over one")]
    [TestCase("negative-zero position")]
    [TestCase("zero scale")]
    [TestCase("negative scale")]
    [TestCase("negative-zero rotation")]
    [TestCase("non-unit rotation")]
    [TestCase("non-canonical rotation sign")]
    public void Delivery_RejectsNonCanonicalTimelineKeyframes(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedTimelineTrack track = delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].Tracks[0];
        switch (invalidCase)
        {
            case "negative-zero opacity": track.Keyframes[0].Number.Value = -0.0; break;
            case "opacity over one": track.Keyframes[0].Number.Value = 1.1; break;
            case "negative-zero position":
                track.Target.Property = TimelineProperty.TransformPosition;
                track.Keyframes[0].Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = -0.0 } };
                track.Keyframes[1].Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3() };
                break;
            case "zero scale":
            case "negative scale":
                track.Target.Property = TimelineProperty.TransformScale;
                track.Keyframes[0].Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = invalidCase == "zero scale" ? 0 : -1, Y = 1, Z = 1 } };
                track.Keyframes[1].Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = 1, Y = 1, Z = 1 } };
                break;
            default:
                track.Target.Property = TimelineProperty.TransformRotation;
                Unframe.Presentation.Quaternion rotation = new Unframe.Presentation.Quaternion { W = 1 };
                if (invalidCase == "negative-zero rotation") rotation.X = -0.0;
                else if (invalidCase == "non-unit rotation") rotation.W = 0.5;
                else rotation.W = -1;
                track.Keyframes[0].Quaternion = new QuaternionKeyframeValue { Value = rotation };
                track.Keyframes[1].Quaternion = new QuaternionKeyframeValue { Value = new Unframe.Presentation.Quaternion { W = 1 } };
                break;
        }

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False, invalidCase);
        Assert.That(error, Does.Contain("timeline"), invalidCase);
    }

    [Test]
    public void NodeFactory_BuildsTheContractHierarchyWithoutLoadingAssets()
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedRuntimeCatalog catalog = delivery.ProjectionProfile.RuntimeCatalog;
        catalog.Nodes.Clear();
        catalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:parent",
            Parent = new SpatialParent { Stage = new StageParent() },
            Container = new ContainerNode(),
            Order = 1,
        });
        catalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:stage-sibling",
            Parent = new SpatialParent { Stage = new StageParent() },
            Container = new ContainerNode(),
            Order = 2,
        });
        catalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:model",
            Parent = new SpatialParent { Node = new NodeParent { NodeId = "node:parent" } },
            Model = new ModelNode { ModelAssetId = "asset:model" },
        });
        catalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:surface",
            Parent = new SpatialParent { Node = new NodeParent { NodeId = "node:model" } },
            Surface = new SurfaceNode { SemanticSurfaceId = "surface:main" },
        });

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);

        GameObject root = new GameObject("test-root");
        try
        {
            PresentationNodeFactory factory = new PresentationNodeFactory();
            Assert.That(factory.TryBuild(store, root.transform, out PresentationNodeRegistry registry, out error), Is.True, error);
            Assert.That(registry.TryGet("node:parent", out GameObject parent), Is.True);
            Assert.That(registry.TryGet("node:model", out GameObject model), Is.True);
            Assert.That(model.transform.parent, Is.EqualTo(parent.transform));
            Assert.That(parent.transform.GetSiblingIndex(), Is.EqualTo(0));
            Assert.That(root.transform.GetChild(1).name, Is.EqualTo("node:stage-sibling"));
            Assert.That(parent.transform.localPosition, Is.EqualTo(UnityEngine.Vector3.zero));
            Assert.That(model.transform.localPosition, Is.EqualTo(UnityEngine.Vector3.zero));
            Assert.That(model.GetComponent<MeshRenderer>(), Is.Null);
            Assert.That(model.GetComponent<PresentationNodeMetadata>().NodeId, Is.EqualTo("node:model"));
            Assert.That(model.GetComponent<PresentationNodeMetadata>().ModelAssetId, Is.EqualTo("asset:model"));
            Assert.That(registry.TryGet("node:surface", out GameObject surface), Is.True);
            Assert.That(surface.GetComponent<PresentationSurfaceMetadata>().SurfaceId, Is.EqualTo("surface:main"));
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void AnchorKeyframeIncludesOnlyCurrentlyOwnedNodes()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
        {
            PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true },
        };
        delivery.ProjectionProfile.RuntimeCatalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:future-anchor",
            Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:next" } },
            Parent = new SpatialParent { PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true } },
            Container = new ContainerNode(),
        });
        delivery.ProjectionProfile.VisibleNodeIds.Add("node:future-anchor");
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);

        ElementStateFrame keyframe = CreateAnchorFrame(delivery, 1, 1000, 900);
        Assert.That(store.TryValidateNetworkStateFrame(keyframe, out string error), Is.True, error);
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = keyframe }, out error), Is.True, error);
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(1));

        ElementStateFrame unowned = CreateStateFrame(delivery, 2, StateFrameKind.Delta, null);
        unowned.Elements.Clear();
        unowned.ProducedAtRuntimeMonotonicMs = 1100;
        unowned.AnchorBindings.Add(new ProjectedAnchorBindingPatch { NodeId = "node:future-anchor", Unavailable = new AnchorBindingUnavailable() });
        Assert.That(store.TryValidateNetworkStateFrame(unowned, out error), Is.False);
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = unowned }, out error), Is.False);
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(1));
    }

    [Test]
    public void PresenterAnchorStartsUnavailableAndFreshBindingControlsItsSubtree()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
        {
            PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true, FollowRotation = true },
        };
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
        double halfTurn = System.Math.Sqrt(0.5d);
        snapshot.Fence.PresentationOriginVersion = 1;
        snapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin
        {
            Version = 1,
            Pose = new Unframe.Presentation.Pose
            {
                Position = new Unframe.Presentation.Vector3 { X = 1, Z = 2 },
                Rotation = new Unframe.Presentation.Quaternion { Y = halfTurn, W = halfTurn },
            }
        };
        snapshot.Snapshot.RuntimeView.NodeStates[0].Transform.Position.Z = 1;
        snapshot.Snapshot.RuntimeView.NodeStates[0].Transform.Scale.X = 2;
        snapshot.Snapshot.RuntimeView.NodeStates[0].Transform.Scale.Z = 3;
        snapshot.Snapshot.RuntimeView.NodeStates.Add(new NodeRuntimeState
        {
            NodeId = "node:surface",
            Active = true,
            Visible = true,
            Opacity = 1,
            Transform = CreateValidTransform()
        });
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out string snapshotError), Is.True, snapshotError);

        GameObject root = new GameObject("test-root");
        PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
        try
        {
            Assert.That(hierarchy.TryReplace(store, root.transform, out string error), Is.True, error);
            PresentationNodeStateApplier applier = new PresentationNodeStateApplier();
            applier.Apply(store, hierarchy);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject anchored), Is.True);
            Assert.That(anchored.activeInHierarchy, Is.False);
            Assert.That(hierarchy.Registry.TryGet("node:surface", out GameObject descendant), Is.True);
            Assert.That(descendant.activeInHierarchy, Is.False);

            ElementStateFrame frame = CreateStateFrame(delivery, 1, StateFrameKind.Keyframe, FullNodePatch());
            frame.Fence.PresentationOriginVersion = 1;
            frame.Elements[0].Node.Transform = snapshot.Snapshot.RuntimeView.NodeStates[0].Transform.Clone();
            frame.Elements.Add(new ElementStatePatch { ElementId = "node:surface", Node = FullNodePatch() });
            frame.ProducedAtRuntimeMonotonicMs = 1000;
            frame.AnchorBindings.Add(new ProjectedAnchorBindingPatch
            {
                NodeId = "node:model",
                Sample = new ProjectedAnchorBindingSample
                {
                    TrackingFrameSequence = 1,
                    ObservedAtRuntimeMonotonicMs = 900,
                    Position = new Unframe.Presentation.Vector3 { X = 2, Y = 3, Z = 4 },
                    Rotation = new Unframe.Presentation.Quaternion { X = halfTurn, W = halfTurn },
                }
            });
            Assert.That(store.TryValidateNetworkStateFrame(frame, out error), Is.True, error);
            Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out error), Is.True, error);
            applier.Apply(store, hierarchy);
            Assert.That(anchored.activeInHierarchy, Is.True);
            Assert.That(descendant.activeInHierarchy, Is.True);
            Assert.That(anchored.transform.parent.localPosition, Is.EqualTo(new UnityEngine.Vector3(2, 3, -4)));
            Assert.That(anchored.transform.localPosition, Is.EqualTo(new UnityEngine.Vector3(0, 0, -1)));
            Assert.That(anchored.transform.localScale, Is.EqualTo(new UnityEngine.Vector3(2, 1, 3)));
            Assert.That(anchored.transform.position.x, Is.EqualTo(5f).Within(0.0001f));
            Assert.That(anchored.transform.position.y, Is.EqualTo(2f).Within(0.0001f));
            Assert.That(anchored.transform.position.z, Is.EqualTo(0f).Within(0.0001f));

            ElementStateFrame unavailable = CreateStateFrame(delivery, 2, StateFrameKind.Delta, null);
            unavailable.Fence.PresentationOriginVersion = 1;
            unavailable.Elements.Clear();
            unavailable.ProducedAtRuntimeMonotonicMs = 1100;
            unavailable.AnchorBindings.Add(new ProjectedAnchorBindingPatch { NodeId = "node:model", Unavailable = new AnchorBindingUnavailable() });
            Assert.That(store.TryValidateNetworkStateFrame(unavailable, out error), Is.True, error);
            Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = unavailable }, out error), Is.True, error);
            applier.ApplyAnchors(store, hierarchy);
            Assert.That(anchored.activeInHierarchy, Is.False);
            Assert.That(descendant.activeInHierarchy, Is.False);
        }
        finally
        {
            hierarchy.Clear();
            Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void RealtimeDisconnectImmediatelyHidesFreshAnchorSubtree()
    {
        GameObject host = new GameObject("anchor-runtime");
        PresentationBakedRuntime runtime = host.AddComponent<PresentationBakedRuntime>();
        var fields = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
        PresentationRuntimeDataStore store = (PresentationRuntimeDataStore)typeof(PresentationBakedRuntime).GetField("store", fields).GetValue(runtime);
        PresentationNodeHierarchy hierarchy = (PresentationNodeHierarchy)typeof(PresentationBakedRuntime).GetField("hierarchy", fields).GetValue(runtime);
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
        {
            PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true },
        };
        try
        {
            Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
            PresentationRuntimeDataStore seeded = CreateStoreWithNodeState(delivery);
            Assert.That(seeded.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
            Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out error), Is.True, error);
            Assert.That(hierarchy.TryReplace(store, host.transform, out error), Is.True, error);
            ElementStateFrame frame = CreateAnchorFrame(delivery, 1, 1000, 900);
            Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out error), Is.True, error);
            new PresentationNodeStateApplier().Apply(store, hierarchy);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject anchored), Is.True);
            Assert.That(anchored.activeInHierarchy, Is.True);
            Assert.That(store.TryGetAnchorSample("node:model", out _), Is.True);

            var handler = typeof(PresentationBakedRuntime).GetMethod("HandleDisconnected", fields);
            Assert.That(handler, Is.Not.Null);
            handler.Invoke(runtime, null);
            Assert.That(anchored.activeInHierarchy, Is.False);
            Assert.That(store.TryGetAnchorSample("node:model", out _), Is.False);
            new PresentationNodeStateApplier().ApplyAnchors(store, hierarchy);
            Assert.That(anchored.activeInHierarchy, Is.False);
        }
        finally { hierarchy.Clear(); Object.DestroyImmediate(host); }
    }

    [TestCase(false, AnchorTarget.Head)]
    [TestCase(true, AnchorTarget.Unspecified)]
    public void NodeFactoryRejectsInvalidPresenterAnchorParent(bool followPosition, AnchorTarget target)
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
        {
            PresenterAnchor = new PresenterAnchorParent { Target = target, FollowPosition = followPosition },
        };
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        GameObject root = new GameObject("test-root");
        try
        {
            Assert.That(new PresentationNodeFactory().TryBuild(store, root.transform, out _, out error), Is.False);
            Assert.That(error, Does.Contain("anchor"));
            Assert.That(root.transform.childCount, Is.Zero);
        }
        finally { Object.DestroyImmediate(root); }
    }

    [TestCase("position-overflow")]
    [TestCase("scale-overflow")]
    [TestCase("scale-underflow")]
    public void DeliveryRejectsTimelineCoordinatesOutsideUnityFloatRange(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedTimelineTrack track = delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].Tracks[0];
        track.Target.Property = invalidCase == "position-overflow" ? TimelineProperty.TransformPosition : TimelineProperty.TransformScale;
        double value = invalidCase == "scale-underflow" ? 1e-323d : (double)float.MaxValue * 2d;
        foreach (TimelineKeyframe keyframe in track.Keyframes)
            keyframe.Vector3 = new Vector3KeyframeValue
            {
                Value = new Unframe.Presentation.Vector3
                {
                    X = value,
                    Y = 1,
                    Z = 1,
                }
            };
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False, invalidCase);
        Assert.That(error, Does.Contain("timeline"), invalidCase);
    }

    [TestCase("missing")]
    [TestCase("duplicate")]
    [TestCase("unknown")]
    [TestCase("missing-position")]
    [TestCase("unexpected-rotation")]
    [TestCase("future-observation")]
    [TestCase("noncanonical-position")]
    public void AnchorBindingRejectsMalformedKeyframesAtomically(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
        {
            PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true },
        };
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        ElementStateFrame frame = CreateAnchorFrame(delivery, 1, 1000, 900);
        switch (invalidCase)
        {
            case "missing": frame.AnchorBindings.Clear(); break;
            case "duplicate": frame.AnchorBindings.Add(frame.AnchorBindings[0].Clone()); break;
            case "unknown": frame.AnchorBindings[0].NodeId = "node:unknown"; break;
            case "missing-position": frame.AnchorBindings[0].Sample.Position = null; break;
            case "unexpected-rotation": frame.AnchorBindings[0].Sample.Rotation = new Unframe.Presentation.Quaternion { W = 1 }; break;
            case "future-observation": frame.AnchorBindings[0].Sample.ObservedAtRuntimeMonotonicMs = 1001; break;
            case "noncanonical-position": frame.AnchorBindings[0].Sample.Position.X = double.NaN; break;
        }
        Assert.That(store.TryValidateNetworkStateFrame(frame, out _), Is.False, invalidCase);
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out _), Is.False, invalidCase);
        Assert.That(store.LastStateFrameSequence, Is.Zero, invalidCase);
        Assert.That(store.TryGetAnchorSample("node:model", out _), Is.False, invalidCase);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState state), Is.True);
        Assert.That(state.Opacity, Is.EqualTo(1));
    }

    [Test]
    public void AnchorSampleExpiresAndAKeyframeWithoutItCannotReuseTheOldPose()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
        {
            PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true },
        };
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        ElementStateFrame first = CreateAnchorFrame(delivery, 1, 1000, 900);
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = first }, out string error), Is.True, error);
        Assert.That(store.TryGetAnchorSample("node:model", out _), Is.True);
        System.Threading.Thread.Sleep(420);
        Assert.That(store.TryGetAnchorSample("node:model", out _), Is.False);

        ElementStateFrame stale = CreateAnchorFrame(delivery, 2, 2000, 1499);
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = stale }, out error), Is.True, error);
        Assert.That(store.TryGetAnchorSample("node:model", out _), Is.False);
        ElementStateFrame unavailable = CreateAnchorFrame(delivery, 3, 3000, 2900);
        unavailable.AnchorBindings[0].Unavailable = new AnchorBindingUnavailable();
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = unavailable }, out error), Is.True, error);
        Assert.That(store.TryGetAnchorSample("node:model", out _), Is.False);
        ElementStateFrame recovered = CreateAnchorFrame(delivery, 4, 4000, 3900);
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = recovered }, out error), Is.True, error);
        Assert.That(store.TryGetAnchorSample("node:model", out _), Is.True);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out error), Is.True, error);
        Assert.That(store.TryGetAnchorSample("node:model", out _), Is.False);
    }

    [Test]
    public void PartialNodePatchWithoutFullBaseTransformFailsWithoutAdvancingCursor()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithNodeState(delivery);
        Assert.That(store.TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot), Is.True);
        snapshot.Snapshot.RuntimeView.NodeStates[0].Transform = null;
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out string error), Is.True, error);
        ElementStateFrame frame = CreateStateFrame(delivery, 1, StateFrameKind.Keyframe, new NodeStatePatch
        {
            Transform = new Unframe.Presentation.Transform { Position = new Unframe.Presentation.Vector3 { X = 2 } },
        });
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = frame }, out error), Is.False);
        Assert.That(store.LastStateFrameSequence, Is.Zero);
    }

    [Test]
    public void NodeHierarchy_ReplacesOnlyThePreviousGeneratedNodes()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(CreateDelivery(), out string error), Is.True, error);

        GameObject root = new GameObject("test-root");
        try
        {
            PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject first), Is.True);

            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject second), Is.True);
            Assert.That(first == null, Is.True);
            Assert.That(second, Is.Not.Null);

            hierarchy.Clear();
            Assert.That(root.transform.childCount, Is.Zero);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void NodeHierarchy_KeepsThePreviousHierarchyWhenReplacementFails()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(CreateDelivery(), out string error), Is.True, error);

        GameObject root = new GameObject("test-root");
        try
        {
            PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject original), Is.True);

            Assert.That(hierarchy.TryReplace(null, root.transform, out error), Is.False);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject retained), Is.True);
            Assert.That(retained, Is.EqualTo(original));
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void ContractJsonFixtureLoader_ParsesDeliveryUsingTheGeneratedProtoMapping()
    {
        string json = JsonFormatter.Default.Format(CreateDelivery());

        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(json, out DeliveryManifest delivery, out string error), Is.True, error);
        Assert.That(delivery.SessionId, Is.EqualTo("session:main"));
        Assert.That(delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].NodeId, Is.EqualTo("node:model"));
    }

    [Test]
    public void ContractJsonFixtureLoader_RejectsUnknownProtoFields()
    {
        const string json = "{ \"unknownField\": true }";

        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(json, out _, out string error), Is.False);
        Assert.That(error, Does.Contain("invalid"));
    }

    [Test]
    public void LocalFixtureRunner_LoadsDeliveryAndBuildsTheNodeHierarchy()
    {
        GameObject host = new GameObject("fixture-runner");
        try
        {
            LocalPresentationFixtureRunner runner = host.AddComponent<LocalPresentationFixtureRunner>();

            Assert.That(runner.TryLoad(out string error), Is.True, error);
            Assert.That(runner.Store.TryGetNode("node:cube", out _), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:cube", out GameObject nodeObject), Is.True);
            Assert.That(nodeObject.transform.IsChildOf(host.transform), Is.True);
        }
        finally
        {
            Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void LocalFixtureRunner_RequiresLoadBeforeAdvance()
    {
        GameObject host = new GameObject("fixture-runner");
        try
        {
            LocalPresentationFixtureRunner runner = host.AddComponent<LocalPresentationFixtureRunner>();

            Assert.That(runner.TryAdvance(out string error), Is.False);
            Assert.That(error, Does.Contain("Load Local Presentation"));
        }
        finally
        {
            Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void LocalFixtureRunner_AppliesContractFixturesAsLocalPresentationProgression()
    {
        GameObject host = new GameObject("fixture-runner");
        try
        {
            LocalPresentationFixtureRunner runner = host.AddComponent<LocalPresentationFixtureRunner>();

            Assert.That(runner.TryLoad(out string error), Is.True, error);
            Assert.That(runner.ReliableEventCount, Is.EqualTo(35));
            Assert.That(runner.Store.Nodes, Has.Count.EqualTo(35));
            Assert.That(runner.Hierarchy.Registry.TryGet("node:text-greeting", out GameObject greeting), Is.True);
            Assert.That(greeting.GetComponentInChildren<TextMesh>(true).text, Is.EqualTo("仮テキスト：挨拶"));
            Assert.That(runner.Hierarchy.Registry.TryGet("node:opening-panel", out GameObject firstPanel), Is.True);
            Assert.That(firstPanel.GetComponentInChildren<MeshRenderer>(true), Is.Not.Null);
            Assert.That(GetRendererAlpha(greeting.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
            Assert.That(runner.Hierarchy.Registry.TryGet("node:cube", out GameObject firstCube), Is.True);
            Assert.That(firstCube.GetComponentInChildren<MeshRenderer>(true), Is.Not.Null);
            Assert.That(firstCube.transform.localPosition, Is.EqualTo(UnityEngine.Vector3.zero));
            Assert.That(GetRendererAlpha(firstCube.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));

            for (int i = 1; i <= 35; i++)
            {
                string timelineId = "timeline:story-" + i.ToString("D2");
                Assert.That(runner.Store.TryGetTimeline(timelineId, out Unframe.Presentation.ProjectedTimelineDefinition timeline), Is.True);
                foreach (Unframe.Presentation.ProjectedTimelineTrack track in timeline.Tracks)
                {
                    bool hasPositionMotion = i == 17 || (i >= 22 && i <= 24);
                    Assert.That(
                        track.Target.Property == Unframe.Presentation.TimelineProperty.Opacity
                            || (hasPositionMotion && track.Target.Property == Unframe.Presentation.TimelineProperty.TransformPosition),
                        Is.True);
                }
            }

            Assert.That(runner.Hierarchy.Registry.TryGet("node:text-self", out GameObject selfIntro), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:text-overview", out GameObject overview), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:text-result", out GameObject resultText), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:text-long", out GameObject longText), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:vertical-text-1", out GameObject verticalText), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:vertical-text-new", out GameObject addedText), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:foreground-panel-1", out GameObject foregroundPanel), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:normal-panel", out GameObject normalPanel), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:quadrant-upper-left", out GameObject upperLeft), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:quadrant-upper-right", out GameObject upperRight), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:quadrant-lower-left", out GameObject lowerLeft), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:quadrant-lower-right", out GameObject lowerRight), Is.True);

            for (int i = 0; i < 35; i++)
            {
                Assert.That(runner.TryAdvance(out error), Is.True, error);
                Assert.That(runner.AppliedEventCount, Is.EqualTo(i + 1));

                if (i == 0)
                {
                    Assert.That(GetRendererAlpha(greeting.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(GetRendererAlpha(firstPanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 1)
                {
                    Assert.That(GetRendererAlpha(greeting.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
                    Assert.That(GetRendererAlpha(firstPanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 2)
                {
                    Assert.That(GetRendererAlpha(selfIntro.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 4)
                {
                    Assert.That(GetRendererAlpha(overview.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 6)
                {
                    Assert.That(GetRendererAlpha(firstPanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
                }
                else if (i == 14)
                {
                    Assert.That(GetRendererAlpha(resultText.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
                    Assert.That(runner.Hierarchy.Registry.TryGet("node:side-panel-left", out GameObject sidePanel), Is.True);
                    Assert.That(GetRendererAlpha(sidePanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 16)
                {
                    Assert.That(GetRendererAlpha(longText.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(longText.transform.localPosition.y, Is.EqualTo(0.25f).Within(0.001f));
                }
                else if (i == 19)
                {
                    Assert.That(runner.Hierarchy.Registry.TryGet("node:scatter-panel-1", out GameObject lonePanel), Is.True);
                    Assert.That(GetRendererAlpha(lonePanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 21)
                {
                    Assert.That(GetRendererAlpha(verticalText.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(verticalText.transform.localPosition.y, Is.EqualTo(0.3f).Within(0.001f));
                }
                else if (i == 22)
                {
                    Assert.That(GetRendererAlpha(addedText.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(verticalText.transform.localPosition.x, Is.EqualTo(-1f).Within(0.001f));
                }
                else if (i == 23)
                {
                    Assert.That(GetRendererAlpha(verticalText.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
                    Assert.That(verticalText.transform.localPosition.z, Is.EqualTo(-2f).Within(0.001f));
                    Assert.That(GetRendererAlpha(foregroundPanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 25)
                {
                    Assert.That(GetRendererAlpha(firstCube.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 26)
                {
                    Assert.That(GetRendererAlpha(firstCube.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
                }
                else if (i == 27)
                {
                    Assert.That(GetRendererAlpha(normalPanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 29)
                {
                    Assert.That(GetRendererAlpha(upperLeft.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(GetRendererAlpha(upperRight.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(GetRendererAlpha(lowerLeft.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(GetRendererAlpha(lowerRight.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 30)
                {
                    Assert.That(GetRendererAlpha(upperLeft.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                    Assert.That(GetRendererAlpha(upperRight.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
                }
                else if (i == 31)
                {
                    Assert.That(GetRendererAlpha(upperLeft.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
                    Assert.That(GetRendererAlpha(upperRight.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 32)
                {
                    Assert.That(GetRendererAlpha(lowerLeft.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
                else if (i == 33)
                {
                    Assert.That(GetRendererAlpha(lowerRight.GetComponentInChildren<Renderer>(true)), Is.EqualTo(1f).Within(0.001f));
                }
            }

            Assert.That(GetRendererAlpha(greeting.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
            Assert.That(GetRendererAlpha(firstPanel.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
            Assert.That(GetRendererAlpha(firstCube.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
            Assert.That(GetRendererAlpha(lowerRight.GetComponentInChildren<Renderer>(true)), Is.EqualTo(0f).Within(0.001f));
            Assert.That(runner.Store.LastReliableSequence, Is.EqualTo(35));
            Assert.That(runner.TryAdvance(out error), Is.False);
            Assert.That(error, Does.Contain("No local reliable event remains"));
        }
        finally
        {
            Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void TimelinePlayer_AppliesPresetTimelineTracksByTheContractTimelineId()
    {
        DeliveryManifest delivery = CreateDelivery();
        ProjectedTimelineDefinition timeline = new ProjectedTimelineDefinition
        {
            TimelineId = PresentationAnimationPresetIds.FadeInUp,
            DurationMs = 1000,
            Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
        };
        timeline.Tracks.Add(new ProjectedTimelineTrack
        {
            Target = new TimelineTrackTarget { NodeId = "node:model", Property = TimelineProperty.TransformPosition },
            Keyframes =
            {
                new TimelineKeyframe { TimeMs = 0, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = 0, Y = -1, Z = 0 } }, EasingToNext = Easing.Linear },
                new TimelineKeyframe { TimeMs = 1000, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = 0, Y = 0, Z = 0 } } },
            },
        });
        timeline.Tracks.Add(new ProjectedTimelineTrack
        {
            Target = new TimelineTrackTarget { NodeId = "node:model", Property = TimelineProperty.Opacity },
            Keyframes =
            {
                new TimelineKeyframe { TimeMs = 0, Number = new NumberKeyframeValue { Value = 0 }, EasingToNext = Easing.Linear },
                new TimelineKeyframe { TimeMs = 1000, Number = new NumberKeyframeValue { Value = 1 } },
            },
        });
        delivery.ProjectionProfile.RuntimeCatalog.Timelines.Add(timeline);

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        GameObject root = new GameObject("timeline-root");
        try
        {
            PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            PresentationTimelinePlayer player = new PresentationTimelinePlayer();

            Assert.That(player.TryStart(timeline, hierarchy, 0d, out error), Is.True, error);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject model), Is.True);
            Assert.That(model.transform.localPosition, Is.EqualTo(new UnityEngine.Vector3(0f, -1f, 0f)));

            player.Update(0.5d);
            Assert.That(model.transform.localPosition.x, Is.EqualTo(0f).Within(0.0001f));
            Assert.That(model.transform.localPosition.y, Is.EqualTo(-0.5f).Within(0.0001f));
            Assert.That(model.transform.localPosition.z, Is.EqualTo(0f).Within(0.0001f));

            player.Update(1d);
            Assert.That(model.transform.localPosition, Is.EqualTo(UnityEngine.Vector3.zero));
            Assert.That(player.ActiveCount, Is.Zero);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void AnimationPresetFactory_ProducesOpacityTransitionsForEveryPresetId()
    {
        DeliveryManifest delivery = CreateDelivery();
        foreach (string timelineId in PresentationAnimationPresetIds.All)
        {
            Assert.That(PresentationAnimationPresetTimelineFactory.TryCreate(timelineId, "node:model", UnityEngine.Vector3.zero, 600, out ProjectedTimelineDefinition timeline, out string error), Is.True, error);
            Assert.That(timeline.TimelineId, Is.EqualTo(timelineId));
            ProjectedTimelineTrack presetOpacity = FindTimelineTrack(timeline, TimelineProperty.Opacity);
            Assert.That(presetOpacity, Is.Not.Null, timelineId);
            Assert.That(presetOpacity.Keyframes.Count, Is.EqualTo(2), timelineId);
            Assert.That(presetOpacity.Keyframes[0].TimeMs, Is.Zero, timelineId);
            Assert.That(presetOpacity.Keyframes[1].TimeMs, Is.EqualTo(timeline.DurationMs), timelineId);
            bool appears = PresentationAnimationPresetIds.IsFadeIn(timelineId);
            Assert.That(presetOpacity.Keyframes[0].Number.Value, Is.EqualTo(appears ? 0 : 1), timelineId);
            Assert.That(presetOpacity.Keyframes[1].Number.Value, Is.EqualTo(appears ? 1 : 0), timelineId);
            Assert.That(presetOpacity.Keyframes[0].HasEasingToNext, Is.True, timelineId);
            delivery.ProjectionProfile.RuntimeCatalog.Timelines.Add(timeline);
        }

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string deliveryError), Is.True, deliveryError);

        Assert.That(PresentationAnimationPresetTimelineFactory.TryCreate(PresentationAnimationPresetIds.SlideFadeOutRight, "node:model", UnityEngine.Vector3.zero, 600, out ProjectedTimelineDefinition fadeOut, out _), Is.True);
        ProjectedTimelineTrack fadeOutOpacity = FindTimelineTrack(fadeOut, TimelineProperty.Opacity);
        Assert.That(fadeOutOpacity.Keyframes[0].Number.Value, Is.EqualTo(1));
        Assert.That(fadeOutOpacity.Keyframes[1].Number.Value, Is.EqualTo(0));
        ProjectedTimelineTrack position = FindTimelineTrack(fadeOut, TimelineProperty.TransformPosition);
        Assert.That(position.Keyframes[1].Vector3.Value.X, Is.GreaterThan(0));

        Assert.That(PresentationAnimationPresetTimelineFactory.TryCreate(PresentationAnimationPresetIds.SlideFadeInLeft, "node:model", UnityEngine.Vector3.zero, 600, out ProjectedTimelineDefinition fadeIn, out _), Is.True);
        ProjectedTimelineTrack fadeInPosition = FindTimelineTrack(fadeIn, TimelineProperty.TransformPosition);
        Assert.That(fadeInPosition.Keyframes[0].Vector3.Value.X, Is.GreaterThan(0));
        Assert.That(fadeInPosition.Keyframes[1].Vector3.Value.X, Is.EqualTo(0));
    }

    [Test]
    public void Delivery_RejectsBuiltInPresetWithoutTheExpectedFadeDirection()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].TimelineId = PresentationAnimationPresetIds.FadeOutUp;
        delivery.ProjectionProfile.RuntimeCatalog.Timelines[0].Tracks[0].Keyframes[1].Number.Value = 1;

        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.False);
        Assert.That(error, Does.Contain("matching opacity transition"));
    }

    [Test]
    public void TimelinePlayer_HidesTheTargetOnlyAfterPresetFadeOutCompletes()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(CreateDelivery(), out string error), Is.True, error);

        GameObject root = new GameObject("timeline-root");
        try
        {
            PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject model), Is.True);
            GameObject visual = GameObject.CreatePrimitive(PrimitiveType.Cube);
            visual.transform.SetParent(model.transform, false);
            Renderer renderer = visual.GetComponent<Renderer>();
            Assert.That(PresentationAnimationPresetTimelineFactory.TryCreate(PresentationAnimationPresetIds.FadeOutDown, "node:model", UnityEngine.Vector3.zero, 600, out ProjectedTimelineDefinition timeline, out error), Is.True, error);
            float originalAlpha = GetRendererAlpha(renderer);

            PresentationTimelinePlayer player = new PresentationTimelinePlayer();
            Assert.That(player.TryStart(timeline, hierarchy, 0d, out error), Is.True, error);
            Assert.That(renderer.enabled, Is.True);
            Assert.That(GetRendererAlpha(renderer), Is.EqualTo(originalAlpha).Within(0.001f));

            player.Update(0.3d);
            Assert.That(renderer.enabled, Is.True);
            Assert.That(GetRendererAlpha(renderer), Is.LessThan(originalAlpha));
            Assert.That(GetRendererAlpha(renderer), Is.GreaterThan(0f));

            player.Update(0.6d);
            Assert.That(renderer.enabled, Is.False);
            Assert.That(GetRendererAlpha(renderer), Is.EqualTo(0f).Within(0.001f));
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void PresentationOrigin_SnapshotAndGetterAreClonedAndDeliveryResetClearsOrigin()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithOrigin(delivery);
        Assert.That(store.PresentationOrigin, Is.Not.Null);
        Assert.That(store.PresentationOrigin.Version, Is.Zero);
        PresentationOrigin read = store.PresentationOrigin;
        read.Pose.Position.X = 100;
        Assert.That(store.PresentationOrigin.Pose.Position.X, Is.Zero);
        PresentationOrigin source = CreateOrigin(3);
        source.Pose.Position.X = 2;
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = CreateOriginSnapshot(delivery, source) }, out string snapshotError), Is.True, snapshotError);
        source.Version = 99;
        source.Pose.Position.X = 100;
        Assert.That(store.PresentationOrigin.Version, Is.EqualTo(3));
        Assert.That(store.PresentationOrigin.Pose.Position.X, Is.EqualTo(2));
        DeliveryManifest invalid = delivery.Clone();
        invalid.ProjectionProfile.RuntimeCatalog.Nodes.Add(invalid.ProjectionProfile.RuntimeCatalog.Nodes[0].Clone());
        Assert.That(store.TryReceiveDelivery(invalid, out _), Is.False);
        Assert.That(store.PresentationOrigin, Is.Not.Null);
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.PresentationOrigin, Is.Null);
    }

    [TestCase("missing pose")]
    [TestCase("missing position")]
    [TestCase("missing rotation")]
    [TestCase("nonfinite position")]
    [TestCase("overflow position")]
    [TestCase("nonunit rotation")]
    [TestCase("negative sign")]
    [TestCase("fence version")]
    [TestCase("duplicate node")]
    public void PresentationOrigin_InvalidSnapshotPreservesTheAcceptedCut(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithOrigin(delivery);
        ConnectionSnapshotEnvelope snapshot = CreateOriginSnapshot(delivery, CreateOrigin(3));
        switch (invalidCase)
        {
            case "missing pose": snapshot.Snapshot.RuntimeView.PresentationOrigin.Pose = null; break;
            case "missing position": snapshot.Snapshot.RuntimeView.PresentationOrigin.Pose.Position = null; break;
            case "missing rotation": snapshot.Snapshot.RuntimeView.PresentationOrigin.Pose.Rotation = null; break;
            case "nonfinite position": snapshot.Snapshot.RuntimeView.PresentationOrigin.Pose.Position.X = double.NaN; break;
            case "overflow position": snapshot.Snapshot.RuntimeView.PresentationOrigin.Pose.Position.X = double.MaxValue; break;
            case "nonunit rotation": snapshot.Snapshot.RuntimeView.PresentationOrigin.Pose.Rotation.W = 1 + 2e-9; break;
            case "negative sign": snapshot.Snapshot.RuntimeView.PresentationOrigin.Pose.Rotation.W = -1; break;
            case "fence version": snapshot.Fence.PresentationOriginVersion = 2; break;
            case "duplicate node": snapshot.Snapshot.RuntimeView.NodeStates.Add(snapshot.Snapshot.RuntimeView.NodeStates[0].Clone()); break;
        }

        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out _), Is.False, invalidCase);
        Assert.That(store.PresentationOrigin.Version, Is.Zero);
        Assert.That(store.LastReliableSequence, Is.Zero);
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState retained), Is.True);
        Assert.That(retained.Opacity, Is.EqualTo(1));
    }

    [Test]
    public void PresentationOrigin_ChangeAdvancesTheFenceAndRejectsTheOldStateCut()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithOrigin(delivery);
        Assert.That(store.TryReceiveState(new StateServerItem
        {
            StateFrame = CreateStateFrame(delivery, 5, StateFrameKind.Keyframe, new NodeStatePatch { Opacity = 0.75 }),
        }, out string frameError), Is.True, frameError);
        PresentationOrigin origin = CreateOrigin(1);
        origin.Pose.Position.Z = 2;
        ProjectedReliableEvent change = CreateOriginChange(delivery, origin);
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = change }, out string error), Is.True, error);
        origin.Pose.Position.Z = 20;
        Assert.That(store.PresentationOrigin.Pose.Position.Z, Is.EqualTo(2));
        Assert.That(store.LastReliableSequence, Is.EqualTo(1));
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(5));
        ProjectedReliableEvent oldEvent = new ProjectedReliableEvent
        {
            Sequence = 2,
            Fence = CreateFence(delivery),
            NodeStateCommitted = new NodeStateCommitted { State = new NodeRuntimeState { NodeId = "node:model", Active = true, Visible = true, Opacity = 0.1 } },
        };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = oldEvent }, out _), Is.False);
        Assert.That(store.LastReliableSequence, Is.EqualTo(1));
        Assert.That(store.TryGetNodeState("node:model", out NodeRuntimeState retained), Is.True);
        Assert.That(retained.Opacity, Is.EqualTo(0.75));
        ElementStateFrame oldFrame = CreateStateFrame(delivery, 6, StateFrameKind.Keyframe, new NodeStatePatch { Opacity = 0.5 });
        oldFrame.BaseReliableSequence = 1;
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = oldFrame }, out _), Is.False);
        Assert.That(store.LastStateFrameSequence, Is.EqualTo(5));
        oldFrame.Fence.PresentationOriginVersion = 1;
        Assert.That(store.TryReceiveState(new StateServerItem { StateFrame = oldFrame }, out error), Is.True, error);
        ProjectionAdvance advance = new ProjectionAdvance { Fence = CreateFence(delivery), FromExclusive = 1, ThroughSequence = 2 };
        Assert.That(store.TryReceiveControl(new ControlServerItem { ProjectionAdvance = advance }, out _), Is.False);
        advance.Fence.PresentationOriginVersion = 1;
        Assert.That(store.TryReceiveControl(new ControlServerItem { ProjectionAdvance = advance }, out error), Is.True, error);
    }

    [Test]
    public void PresentationOrigin_ReliableEventsRequireAnAcceptedSnapshot()
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveControl(new ControlServerItem
        {
            ReliableEvent = CreateOriginChange(delivery, CreateOrigin(1)),
        }, out _), Is.False);
        Assert.That(store.PresentationOrigin, Is.Null);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    [TestCase("same version")]
    [TestCase("old fence")]
    [TestCase("invalid pose")]
    [TestCase("sequence gap")]
    public void PresentationOrigin_InvalidChangeDoesNotAdvanceTheCut(string invalidCase)
    {
        DeliveryManifest delivery = CreateDelivery();
        PresentationRuntimeDataStore store = CreateStoreWithOrigin(delivery);
        ProjectedReliableEvent change = CreateOriginChange(delivery, CreateOrigin(1));
        switch (invalidCase)
        {
            case "same version": change.PresentationOriginChanged.Origin.Version = 0; change.Fence.PresentationOriginVersion = 0; break;
            case "old fence": change.Fence.PresentationOriginVersion = 1; break;
            case "invalid pose": change.PresentationOriginChanged.Origin.Pose.Rotation.W = -1; break;
            case "sequence gap": change.Sequence = 2; break;
        }

        Assert.That(store.TryReceiveControl(new ControlServerItem { ReliableEvent = change }, out _), Is.False);
        Assert.That(store.PresentationOrigin.Version, Is.Zero);
        Assert.That(store.LastReliableSequence, Is.Zero);
    }

    private static PresentationOrigin CreateOrigin(ulong version = 0)
    {
        return new PresentationOrigin
        {
            Version = version,
            Pose = new Unframe.Presentation.Pose
            {
                Position = new Unframe.Presentation.Vector3(),
                Rotation = new Unframe.Presentation.Quaternion { W = 1 },
            },
        };
    }

    private static ConnectionSnapshotEnvelope CreateOriginSnapshot(DeliveryManifest delivery, PresentationOrigin origin, ulong sequence = 4)
    {
        RuntimeProjectionFence fence = CreateFence(delivery);
        fence.PresentationOriginVersion = origin.Version;
        return new ConnectionSnapshotEnvelope
        {
            SchemaVersion = 2,
            Fence = fence,
            ProjectionInstance = delivery.ProjectionInstance.Clone(),
            ReliableSequence = sequence,
            Snapshot = new ProjectedRuntimeSnapshot
            {
                ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
                AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
                ReliableSequence = sequence,
                RuntimeView = new ParticipantRuntimeView
                {
                    ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
                    AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
                    BaseReliableSequence = sequence,
                    PresentationOrigin = origin,
                    Clock = new RuntimeClockSnapshot { Running = new Running() },
                    Progression = new ProgressionRuntimeState { CurrentGroupId = "group:main", GroupEntryEpoch = 1, CurrentStepId = "step:main", StepEntryEpoch = 1, Stable = new StableProgression() },
                    NodeStates = { new NodeRuntimeState { NodeId = "node:model", Active = true, Visible = true, Opacity = 0.5, Transform = CreateValidTransform() } },
                },
            },
        };
    }

    private static ProjectedReliableEvent CreateOriginChange(DeliveryManifest delivery, PresentationOrigin origin)
    {
        RuntimeProjectionFence fence = CreateFence(delivery);
        fence.PresentationOriginVersion = origin.Version == 0 ? 0 : origin.Version - 1;
        return new ProjectedReliableEvent
        {
            Sequence = 1,
            Fence = fence,
            PresentationOriginChanged = new PresentationOriginChanged { Origin = origin },
        };
    }

    [Test]
    public void TimelinePlayer_ReflectsPositionAndRotationWithoutReflectingScale()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(CreateDelivery(), out string error), Is.True, error);
        GameObject root = new GameObject("coordinate-timeline-root");
        try
        {
            PresentationNodeHierarchy hierarchy = new PresentationNodeHierarchy();
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            Assert.That(hierarchy.Registry.TryGet("node:model", out GameObject model), Is.True);
            ProjectedTimelineDefinition timeline = new ProjectedTimelineDefinition { TimelineId = "timeline:coordinate", DurationMs = 1000 };
            foreach (TimelineProperty property in new[] { TimelineProperty.TransformPosition, TimelineProperty.TransformScale, TimelineProperty.TransformRotation })
            {
                ProjectedTimelineTrack track = new ProjectedTimelineTrack { Target = new TimelineTrackTarget { NodeId = "node:model", Property = property } };
                foreach (uint time in new uint[] { 0, 1000 })
                {
                    TimelineKeyframe keyframe = new TimelineKeyframe { TimeMs = time };
                    if (property == TimelineProperty.TransformRotation)
                    {
                        double component = System.Math.Sqrt(0.5d);
                        keyframe.Quaternion = new QuaternionKeyframeValue { Value = new Unframe.Presentation.Quaternion { X = component, W = component } };
                    }
                    else
                    {
                        keyframe.Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = 1, Y = 2, Z = 3 } };
                    }
                    track.Keyframes.Add(keyframe);
                }
                timeline.Tracks.Add(track);
            }
            PresentationTimelinePlayer player = new PresentationTimelinePlayer();
            Assert.That(player.TryStart(timeline, hierarchy, 0, out error), Is.True, error);
            player.Update(0.5d);
            Assert.That(model.transform.localPosition, Is.EqualTo(new UnityEngine.Vector3(1, 2, -3)));
            Assert.That(model.transform.localScale, Is.EqualTo(new UnityEngine.Vector3(1, 2, 3)));
            Assert.That(model.transform.localRotation.x, Is.EqualTo(-System.Math.Sqrt(0.5d)).Within(1e-5));
            timeline.Tracks[0].Keyframes[0].Vector3.Value.Z = double.MaxValue;
            Assert.That(player.CanStart(timeline, hierarchy, out error), Is.False);
            timeline.Tracks[0].Keyframes[0].Vector3.Value.Z = float.MaxValue;
            timeline.Tracks[0].Keyframes[1].Vector3.Value.Z = -float.MaxValue;
            PresentationTimelinePlayer extremePlayer = new PresentationTimelinePlayer();
            Assert.That(extremePlayer.TryStart(timeline, hierarchy, 0, out error), Is.True, error);
            extremePlayer.Update(0.5d);
            Assert.That(model.transform.localPosition.z, Is.EqualTo(0f));
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    private static PresentationRuntimeDataStore CreateStoreWithOrigin(DeliveryManifest delivery)
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);
        ConnectionSnapshotEnvelope snapshot = CreateOriginSnapshot(delivery, CreateOrigin(), 0);
        snapshot.Snapshot.RuntimeView.NodeStates[0].Opacity = 1;
        Assert.That(store.TryReceiveControl(new ControlServerItem { ConnectionSnapshot = snapshot }, out error), Is.True, error);
        return store;
    }

    private static DeliveryManifest CreateDelivery()
    {
        ProjectedRuntimeCatalog catalog = new ProjectedRuntimeCatalog { CatalogContractVersion = 2 };
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
        catalog.ModelClips.Add(new ProjectedModelClipDefinition { ModelNodeId = "node:model", ModelAssetId = "asset:model", ClipId = "clip:idle", DurationMs = 100 });

        DeliveryManifest delivery = new DeliveryManifest
        {
            SchemaVersion = 2,
            DeliveryContractVersion = 2,
            SessionId = "session:main",
            Publication = new PublicationFence { PresentationId = "presentation:main", PublicationEpoch = 1, PublicationManifestHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            DefinitionHash = "sha256:" + new string('b', 64),
            RenderBundleHash = "sha256:" + new string('c', 64),
            AssetSetHash = "sha256:" + new string('d', 64),
            CapabilityProfile = new CapabilityProfile
            {
                SchemaVersion = 2,
                CapabilityProfileId = "capability:quest",
                ContractVersions = new ContractVersions { Delivery = 2, Runtime = 2, Progression = 1, Projection = 1 },
                Renderers = new RendererCapabilities { NativeUi = new NativeUiCapability { Supported = true, ContractVersion = 1 } },
            },
            ProjectionProfile = new ProjectionProfileDescriptor
            {
                ProjectionProfileId = "profile:quest",
                Key = new ProjectionProfileKey
                {
                    Publication = new PublicationFence { PresentationId = "presentation:main", PublicationEpoch = 1, PublicationManifestHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
                    ProjectionContractVersion = 1,
                    Role = SessionRole.Presenter,
                    CapabilityProfileId = "capability:quest",
                },
                RuntimeCatalog = catalog,
            },
            ProjectionInstance = new ProjectionInstance { ProjectionProfileId = "profile:quest", ParticipantId = "participant:quest", AssignmentEpoch = 7 },
            Residency = new ResidencyPlan { Models = new ModelResidencyPlan() },
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
            SchemaVersion = 2,
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

    private static ElementStateFrame CreateStateFrame(DeliveryManifest delivery, ulong sequence, StateFrameKind kind, NodeStatePatch patch)
    {
        return new ElementStateFrame
        {
            Fence = CreateFence(delivery),
            FrameSequence = sequence,
            BaseReliableSequence = 0,
            Kind = kind,
            Elements = { new ElementStatePatch { ElementId = "node:model", Node = patch } },
        };
    }

    private static NodeStatePatch FullNodePatch()
    {
        return new NodeStatePatch { Active = true, Visible = true, Opacity = 1, Transform = CreateValidTransform() };
    }

    private static ElementStateFrame CreateAnchorFrame(DeliveryManifest delivery, ulong sequence, ulong producedAt, ulong observedAt)
    {
        ElementStateFrame frame = CreateStateFrame(delivery, sequence, StateFrameKind.Keyframe, FullNodePatch());
        frame.ProducedAtRuntimeMonotonicMs = producedAt;
        frame.AnchorBindings.Add(new ProjectedAnchorBindingPatch
        {
            NodeId = "node:model",
            Sample = new ProjectedAnchorBindingSample
            {
                TrackingFrameSequence = sequence,
                ObservedAtRuntimeMonotonicMs = observedAt,
                Position = new Unframe.Presentation.Vector3 { X = 2, Y = 3, Z = 4 },
            }
        });
        return frame;
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

    private static ProjectedTimelineTrack FindTimelineTrack(ProjectedTimelineDefinition timeline, TimelineProperty property)
    {
        foreach (ProjectedTimelineTrack track in timeline.Tracks)
        {
            if (track.Target.Property == property)
            {
                return track;
            }
        }

        return null;
    }

    private static float GetRendererAlpha(Renderer renderer)
    {
        Material material = renderer.sharedMaterial;
        string property = material.HasProperty("_BaseColor") ? "_BaseColor" : "_Color";
        return material.GetColor(property).a;
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

    private static byte[] Serialize(IMessage message)
    {
        byte[] bytes = new byte[message.CalculateSize()];
        CodedOutputStream output = new CodedOutputStream(bytes);
        message.WriteTo(output);
        output.CheckNoSpaceLeft();
        return bytes;
    }
}

using NUnit.Framework;
using Google.Protobuf;
using Unframe.Delivery.V2;
using Unframe.Presentation.V2;
using Unframe.Realtime.V2;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationRuntimeDataStoreEditModeTests
{
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
    public void SnapshotAndRealtimeUpdates_RequireTheDeliveryFenceAndExposeState()
    {
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        DeliveryManifest delivery = CreateDelivery();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);

        ConnectionSnapshotEnvelope snapshot = new ConnectionSnapshotEnvelope
        {
            SchemaVersion = 2,
            Fence = CreateFence(delivery),
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
            Assert.That(model.GetComponent<PresentationSurfaceMetadata>().SurfaceId, Is.EqualTo("surface:main"));
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void NodeFactory_RejectsAnchorNodesUntilAnAnchorResolverExists()
    {
        DeliveryManifest delivery = CreateDelivery();
        delivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
        {
            PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head },
        };
        PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out string error), Is.True, error);

        GameObject root = new GameObject("test-root");
        try
        {
            PresentationNodeFactory factory = new PresentationNodeFactory();
            Assert.That(factory.TryBuild(store, root.transform, out _, out error), Is.False);
            Assert.That(error, Does.Contain("anchor resolver"));
            Assert.That(root.transform.childCount, Is.Zero);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
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

            DeliveryManifest anchorDelivery = CreateDelivery();
            anchorDelivery.ProjectionProfile.RuntimeCatalog.Nodes[0].Parent = new SpatialParent
            {
                PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head },
            };
            Assert.That(store.TryReceiveDelivery(anchorDelivery, out error), Is.True, error);
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.False);
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
    public void LocalFixtureSource_LoadsAHandwrittenDeliveryTextAsset()
    {
        GameObject host = new GameObject("fixture-source");
        try
        {
            LocalPresentationFixtureSource source = host.AddComponent<LocalPresentationFixtureSource>();
            source.SetDeliveryFixture(new TextAsset(JsonFormatter.Default.Format(CreateDelivery())));
            PresentationRuntimeDataStore store = new PresentationRuntimeDataStore();

            Assert.That(source.TryLoadDelivery(store, out string error), Is.True, error);
            Assert.That(store.TryGetNode("node:model", out _), Is.True);
        }
        finally
        {
            Object.DestroyImmediate(host);
        }
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
                Assert.That(runner.Store.TryGetTimeline(timelineId, out Unframe.Presentation.V2.ProjectedTimelineDefinition timeline), Is.True);
                foreach (Unframe.Presentation.V2.ProjectedTimelineTrack track in timeline.Tracks)
                {
                    bool hasPositionMotion = i == 17 || (i >= 22 && i <= 24);
                    Assert.That(
                        track.Target.Property == Unframe.Presentation.V2.TimelineProperty.Opacity
                            || (hasPositionMotion && track.Target.Property == Unframe.Presentation.V2.TimelineProperty.TransformPosition),
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
                    Assert.That(verticalText.transform.localPosition.z, Is.EqualTo(2f).Within(0.001f));
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
                new TimelineKeyframe { TimeMs = 0, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.V2.Vector3 { X = 0, Y = -1, Z = 0 } } },
                new TimelineKeyframe { TimeMs = 1000, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.V2.Vector3 { X = 0, Y = 0, Z = 0 } } },
            },
        });
        timeline.Tracks.Add(new ProjectedTimelineTrack
        {
            Target = new TimelineTrackTarget { NodeId = "node:model", Property = TimelineProperty.Opacity },
            Keyframes =
            {
                new TimelineKeyframe { TimeMs = 0, Number = new NumberKeyframeValue { Value = 0 } },
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

    private static DeliveryManifest CreateDelivery()
    {
        ProjectedRuntimeCatalog catalog = new ProjectedRuntimeCatalog { CatalogContractVersion = 2 };
        catalog.Nodes.Add(new ProjectedNodeDefinition
        {
            NodeId = "node:model",
            Parent = new SpatialParent { Stage = new StageParent() },
            Model = new ModelNode { ModelAssetId = "asset:model" },
        });
        catalog.Surfaces.Add(new ProjectedSurfaceDefinition { SurfaceId = "surface:main", HostNodeId = "node:model" });
        ProjectedTimelineDefinition timeline = new ProjectedTimelineDefinition
        {
            TimelineId = "timeline:main",
            DurationMs = 1,
            Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
        };
        timeline.Tracks.Add(new ProjectedTimelineTrack
        {
            Target = new TimelineTrackTarget { NodeId = "node:model", Property = TimelineProperty.Opacity },
            Keyframes = { new TimelineKeyframe { TimeMs = 0, Number = new NumberKeyframeValue { Value = 1 } } },
        });
        catalog.Timelines.Add(timeline);
        catalog.Variables.Add(new ProjectedVariableDefinition { VariableId = "variable:title" });
        catalog.ModelClips.Add(new ProjectedModelClipDefinition { ModelNodeId = "node:model", ModelAssetId = "asset:model", ClipId = "clip:idle" });

        DeliveryManifest delivery = new DeliveryManifest
        {
            SchemaVersion = 2,
            DeliveryContractVersion = 2,
            SessionId = "session:main",
            Publication = new PublicationFence { PresentationId = "presentation:main", PublicationEpoch = 1, PublicationManifestHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            CapabilityProfile = new CapabilityProfile { CapabilityProfileId = "capability:quest" },
            ProjectionProfile = new ProjectionProfileDescriptor
            {
                ProjectionProfileId = "profile:quest",
                Key = new ProjectionProfileKey { CapabilityProfileId = "capability:quest" },
                RuntimeCatalog = catalog,
            },
            ProjectionInstance = new ProjectionInstance { ProjectionProfileId = "profile:quest", ParticipantId = "participant:quest", AssignmentEpoch = 7 },
            Residency = new ResidencyPlan { Models = new ModelResidencyPlan() },
        };
        delivery.AssetAccess.Add(new AssetAccessBinding { AssetId = "asset:model" });
        delivery.Residency.Models.Models.Add(new ModelResidencyBinding { AssetId = "asset:model" });
        return delivery;
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

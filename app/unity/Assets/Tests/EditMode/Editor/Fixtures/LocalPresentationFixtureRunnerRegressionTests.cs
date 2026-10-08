using System.Reflection;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class LocalPresentationFixtureRunnerRegressionTests
{
    [Test]
    public void KeyboardGateBlocksKeyboardWithoutBlockingExplicitAdvance()
    {
        var host = new GameObject("fixture-keyboard-gate");
        try
        {
            var runner = host.AddComponent<LocalPresentationFixtureRunner>();
            Assert.That(runner.TryLoad(out string error), Is.True, error);
            runner.KeyboardAdvanceEnabled = false;
            typeof(LocalPresentationFixtureRunner).GetMethod("ProcessKeyboardInput",
                BindingFlags.Instance | BindingFlags.NonPublic).Invoke(runner, new object[] { true });
            Assert.That(runner.AppliedEventCount, Is.Zero);
            Assert.That(runner.TryAdvance(out error), Is.True, error);
            runner.KeyboardAdvanceEnabled = true;
            Assert.That(runner.CanAdvance, Is.True);
            typeof(LocalPresentationFixtureRunner).GetMethod("ProcessKeyboardInput",
                BindingFlags.Instance | BindingFlags.NonPublic).Invoke(runner, new object[] { true });
            Assert.That(runner.AppliedEventCount, Is.EqualTo(2));
        }
        finally
        {
            Object.DestroyImmediate(host);
        }
    }

    [TestCase("node:opening-panel", "node:text-greeting")]
    [TestCase("node:normal-panel", "node:text-only")]
    public void CentralBackgroundPanelStaysBehindItsText(string panelId, string textId)
    {
        var host = new GameObject("fixture-depth-test");
        try
        {
            var runner = host.AddComponent<LocalPresentationFixtureRunner>();
            Assert.That(runner.TryLoad(out string error), Is.True, error);
            Assert.That(runner.Hierarchy.Registry.TryGet(panelId, out GameObject panel), Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet(textId, out GameObject textNode), Is.True);
            var text = textNode.GetComponentInChildren<TextMesh>(true);
            Assert.That(text, Is.Not.Null);
            Assert.That(panel.GetComponentInChildren<Renderer>(true).bounds.min.z,
                Is.GreaterThan(text.transform.position.z),
                "The marker front is negative Unity Z; its background must be farther away than the text.");
        }
        finally
        {
            Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void ExplicitReliableEventFixturesKeepTheirConfiguredSequenceOrder()
    {
        GameObject host = new GameObject("fixture-runner");
        TextAsset firstFixture = null;
        TextAsset secondFixture = null;
        try
        {
            LocalPresentationFixtureRunner runner = host.AddComponent<LocalPresentationFixtureRunner>();
            Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(
                Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery").text,
                out DeliveryManifest delivery,
                out string error), Is.True, error);

            firstFixture = CreateNodeStateEventFixture(delivery, 1, "event:first", visible: false);
            firstFixture.name = "z-first";
            secondFixture = CreateNodeStateEventFixture(delivery, 2, "event:second", visible: true);
            secondFixture.name = "a-second";
            runner.SetReliableEventFixtures(new[] { firstFixture, secondFixture });

            Assert.That(runner.TryLoad(out error), Is.True, error);
            Assert.That(runner.TryAdvance(out error), Is.True, error);
            Assert.That(runner.Store.LastReliableSequence, Is.EqualTo(1));
            Assert.That(runner.TryAdvance(out error), Is.True, error);
            Assert.That(runner.Store.LastReliableSequence, Is.EqualTo(2));
        }
        finally
        {
            Object.DestroyImmediate(host);
            Object.DestroyImmediate(firstFixture);
            Object.DestroyImmediate(secondFixture);
        }
    }

    [Test]
    public void SurfaceRefreshPreservesNodeOpacityAndVisibility()
    {
        GameObject host = new GameObject("fixture-runner");
        TextAsset snapshotFixture = null;
        TextAsset eventFixture = null;
        try
        {
            LocalPresentationFixtureRunner runner = host.AddComponent<LocalPresentationFixtureRunner>();
            Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(
                Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery").text,
                out DeliveryManifest delivery,
                out string error), Is.True, error);
            Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(
                Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text,
                out ControlServerItem snapshot,
                out error), Is.True, error);

            foreach (NodeRuntimeState state in snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates)
            {
                if (state.NodeId == "node:text-greeting")
                {
                    state.Visible = false;
                    state.Opacity = 0.5;
                }
            }

            snapshotFixture = new TextAsset(JsonFormatter.Default.Format(snapshot));
            eventFixture = new TextAsset(JsonFormatter.Default.Format(new ControlServerItem
            {
                ReliableEvent = new ProjectedReliableEvent
                {
                    Sequence = 1,
                    EventId = "event:surface-refresh",
                    Fence = CreateFence(delivery),
                    SurfaceStateChanged = new SurfaceStateChanged
                    {
                        SurfaceId = "semantic-surface:text-greeting",
                        StateId = "state:text-greeting",
                    },
                },
            }));
            runner.SetSnapshotFixture(snapshotFixture);
            runner.SetReliableEventFixtures(new[] { eventFixture });

            Assert.That(runner.TryLoad(out error), Is.True, error);
            Assert.That(runner.TryAdvance(out error), Is.True, error);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:text-greeting", out GameObject node), Is.True);
            Renderer renderer = node.GetComponentInChildren<TextMesh>(true).GetComponent<Renderer>();
            Assert.That(renderer.enabled, Is.False);
            Assert.That(GetAlpha(renderer), Is.EqualTo(0.5f).Within(0.001f));
        }
        finally
        {
            Object.DestroyImmediate(host);
            Object.DestroyImmediate(snapshotFixture);
            Object.DestroyImmediate(eventFixture);
        }
    }

    [Test]
    public void FailedTimelineStartDoesNotConsumeReliableSequence()
    {
        GameObject host = new GameObject("fixture-runner");
        PresentationAnimationPresetLibrary library = null;
        TextAsset deliveryFixture = null;
        TextAsset eventFixture = null;
        try
        {
            LocalPresentationFixtureRunner runner = host.AddComponent<LocalPresentationFixtureRunner>();
            Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(
                Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery").text,
                out DeliveryManifest delivery,
                out string error), Is.True, error);
            Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(
                Resources.Load<TextAsset>("PresentationFixtures/Control/01-opening-greeting-in").text,
                out ControlServerItem firstEvent,
                out error), Is.True, error);

            const string presetId = "preset:missing";
            foreach (Unframe.Presentation.ProjectedTimelineDefinition timeline in delivery.ProjectionProfile.RuntimeCatalog.Timelines)
            {
                if (timeline.TimelineId == firstEvent.ReliableEvent.TimelineStarted.TimelineId)
                {
                    timeline.TimelineId = presetId;
                    break;
                }
            }

            firstEvent.ReliableEvent.TimelineStarted.TimelineId = presetId;
            deliveryFixture = new TextAsset(JsonFormatter.Default.Format(delivery));
            eventFixture = new TextAsset(JsonFormatter.Default.Format(firstEvent));
            library = ScriptableObject.CreateInstance<PresentationAnimationPresetLibrary>();
            runner.SetDeliveryFixture(deliveryFixture);
            runner.SetReliableEventFixtures(new[] { eventFixture });
            runner.SetAnimationPresetLibrary(library);

            Assert.That(runner.TryLoad(out error), Is.True, error);
            Assert.That(runner.TryAdvance(out error), Is.False);
            Assert.That(error, Does.Contain("not registered"));
            Assert.That(runner.Store.LastReliableSequence, Is.EqualTo(0));

            runner.SetAnimationPresetLibrary(null);
            Assert.That(runner.TryAdvance(out error), Is.True, error);
            Assert.That(runner.AppliedEventCount, Is.EqualTo(1));
        }
        finally
        {
            Object.DestroyImmediate(host);
            Object.DestroyImmediate(library);
            Object.DestroyImmediate(deliveryFixture);
            Object.DestroyImmediate(eventFixture);
        }
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

    private static TextAsset CreateNodeStateEventFixture(DeliveryManifest delivery, ulong sequence, string eventId, bool visible)
    {
        return new TextAsset(JsonFormatter.Default.Format(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = sequence,
                EventId = eventId,
                Fence = CreateFence(delivery),
                NodeStateCommitted = new NodeStateCommitted
                {
                    State = new NodeRuntimeState
                    {
                        NodeId = "node:text-greeting",
                        Active = true,
                        Visible = visible,
                        Opacity = 1,
                    },
                },
            },
        }));
    }

    private static float GetAlpha(Renderer renderer)
    {
        Material material = renderer.sharedMaterial;
        return material.GetColor(material.HasProperty("_BaseColor") ? "_BaseColor" : "_Color").a;
    }
}

using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationScenePlaybackEditModeTests
{
    [UnityTest]
    public IEnumerator ProductionScenePlaybackPausesAndRetainsTimelineTerminalPose()
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out DeliveryManifest manifest, out string error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
            out ControlServerItem snapshot, out error), Is.True, error);
        manifest.AssetAccess.Clear();
        manifest.CapabilityProfile.Limits = new CapabilityLimits();
        manifest.Residency.Models = new ModelResidencyPlan();
        manifest.Residency.Textures = new TextureResidencyPlan();
        manifest.ProjectionProfile.RenderSurfaces.Clear();
        manifest.ProjectionProfile.SemanticSurfaces.Clear();
        manifest.ProjectionProfile.RuntimeCatalog.Surfaces.Clear();
        foreach (ProjectedNodeDefinition node in manifest.ProjectionProfile.RuntimeCatalog.Nodes)
            if (node.Model != null || node.Surface != null) node.Container = new ContainerNode();
        manifest.ProjectionProfile.RuntimeCatalog.ModelClips.Clear();
        manifest.ProjectionProfile.RuntimeCatalog.Timelines.Clear();
        manifest.ProjectionProfile.RuntimeCatalog.Timelines.Add(new ProjectedTimelineDefinition
        {
            TimelineId = "timeline:production-move",
            DurationMs = 1000,
            Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
            Tracks =
            {
                new ProjectedTimelineTrack
                {
                    Target = new TimelineTrackTarget { NodeId = "node:opening-panel", Property = TimelineProperty.TransformPosition },
                    Keyframes =
                    {
                        new TimelineKeyframe { TimeMs = 0, EasingToNext = Easing.Linear, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3() } },
                        new TimelineKeyframe { TimeMs = 1000, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = 2 } } },
                    },
                },
            },
        });
        var view = snapshot.ConnectionSnapshot.Snapshot.RuntimeView;
        view.SurfaceStates.Clear();
        view.ActiveRuns.Clear();
        view.ActiveRuns.Add(new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:production-move", CauseEventId = "event:production-move" },
            Completion = RunCompletion.NonBlocking,
            Timeline = new TimelineRunSnapshot { TimelineId = "timeline:production-move" },
        });
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        var root = new GameObject("production playback test");
        var hierarchy = new PresentationNodeHierarchy();
        var playback = new PresentationPlaybackPlayer();
        using (var renderer = new PresentationSceneRenderer())
        {
            try
            {
                Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
                Task load = renderer.LoadAsync(store, hierarchy,
                    (_, __) => Task.FromException<byte[]>(new AssertionException("The playback fixture has no external assets.")), CancellationToken.None);
                while (!load.IsCompleted) yield return null;
                load.GetAwaiter().GetResult();
                PresentationPlaybackPlayer.RendererRefresh refreshRenderer =
                    (double runtimeTime, out string renderError) => renderer.TryRefresh(store, runtimeTime, out renderError);
                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, 0, out error), Is.True, error);
                Assert.That(hierarchy.Registry.TryGet("node:opening-panel", out GameObject host), Is.True);
                var clock = new RuntimeClockSnapshot { RuntimeTimeMs = 0, Running = new Running() };
                double time = PresentationPlaybackPlayer.SampleRuntimeTimeMs(clock, 10, 10.5);
                Assert.That(playback.TryUpdate(store, hierarchy, refreshRenderer, time, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(1).Within(0.001));

                clock.RuntimeTimeMs = 500;
                clock.Paused = new Paused();
                time = PresentationPlaybackPlayer.SampleRuntimeTimeMs(clock, 11, 30);
                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, time, out error), Is.True, error);
                Assert.That(playback.TryUpdate(store, hierarchy, refreshRenderer, time, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(1).Within(0.001));

                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, 1000, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(2).Within(0.001));
                Assert.That(playback.TryRefresh(store, hierarchy, refreshRenderer, 1000, out error), Is.True, error);
                Assert.That(playback.TryUpdate(store, hierarchy, refreshRenderer, 3000, out error), Is.True, error);
                Assert.That(host.transform.localPosition.x, Is.EqualTo(2).Within(0.001),
                    "Repeated authoritative snapshots must not restore the pre-animation pose while the completed run remains active.");
            }
            finally
            {
                playback.Clear();
                hierarchy.Clear();
                Object.DestroyImmediate(root);
            }
        }
    }
}

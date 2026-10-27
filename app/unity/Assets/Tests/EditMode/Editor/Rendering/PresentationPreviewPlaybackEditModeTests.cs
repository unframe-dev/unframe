using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Preview;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationPreviewPlaybackEditModeTests
{
    private static LocalPreviewPlaybackState State(LocalPreviewEnvelope envelope, ulong sequence, ulong time, bool running = true)
    {
        var state = new LocalPreviewPlaybackState
        {
            RequestId = envelope.RequestId,
            Sequence = sequence,
            CurrentGroupId = "group:first",
            Clock = new RuntimeClockSnapshot { RuntimeTimeMs = time },
            NodeStates = { envelope.InitialState.Clone().NodeStates },
            SurfaceStates = { envelope.InitialState.Clone().SurfaceStates },
        };
        if (running) state.Clock.Running = new Running(); else state.Clock.Paused = new Paused();
        return state;
    }
    private static void AddTimeline(LocalPreviewEnvelope envelope)
    {
        envelope.Projection.RuntimeCatalog.Timelines.Add(new ProjectedTimelineDefinition
        {
            TimelineId = "timeline:move",
            DurationMs = 1000,
            Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
            Tracks =
            {
                new ProjectedTimelineTrack
                {
                    Target = new TimelineTrackTarget { NodeId = "node:surface", Property = TimelineProperty.TransformPosition },
                    Keyframes =
                    {
                        new TimelineKeyframe { TimeMs = 0, EasingToNext = Easing.Linear, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3() } },
                        new TimelineKeyframe { TimeMs = 1000, Vector3 = new Vector3KeyframeValue { Value = new Unframe.Presentation.Vector3 { X = 2 } } },
                    },
                },
                new ProjectedTimelineTrack
                {
                    Target = new TimelineTrackTarget { NodeId = "node:surface", Property = TimelineProperty.Opacity },
                    Keyframes =
                    {
                        new TimelineKeyframe { TimeMs = 0, EasingToNext = Easing.Linear, Number = new NumberKeyframeValue { Value = 1 } },
                        new TimelineKeyframe { TimeMs = 1000, Number = new NumberKeyframeValue { Value = 0 } },
                    },
                },
            },
        });
    }
    private static RuntimeRunSnapshot Run()
    {
        return new RuntimeRunSnapshot
        {
            RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
            Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
            Cause = new RuntimeRunCause { CueId = "cue:move" },
            Completion = RunCompletion.NonBlocking,
            Timeline = new TimelineRunSnapshot { TimelineId = "timeline:move" },
        };
    }

    [UnityTest]
    public IEnumerator PlaybackInterpolatesPausesAndKeepsCanonicalStateAfterTimelineEnds()
    {
        var root = new GameObject("playback test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var envelope = PresentationPreviewTestFixture.Create(texture: true);
                AddTimeline(envelope);
                var task = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png")), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult();
                transaction.Commit(envelope.RequestId);
                var state = State(envelope, 1, 0); state.ActiveRuns.Add(Run());
                Assert.That(transaction.TryPlayback(state, 10, out var error), Is.True, error);
                Assert.That(transaction.TryUpdate(10.5, out error), Is.True, error);
                var node = root.transform.GetChild(0).Find("Presentation Nodes/node:stage/node:surface");
                Assert.That(node, Is.Not.Null);
                Assert.That(node.localPosition.x, Is.EqualTo(1).Within(0.001));
                Assert.That(node.GetComponentInChildren<Renderer>(true).sharedMaterial.GetColor("_Color").a, Is.EqualTo(0.5).Within(0.001));
                state = State(envelope, 2, 500, false); state.ActiveRuns.Add(Run());
                Assert.That(transaction.TryPlayback(state, 11, out error), Is.True, error);
                transaction.TryUpdate(20, out error);
                Assert.That(node.localPosition.x, Is.EqualTo(1).Within(0.001));
                state = State(envelope, 3, 1000, false); state.ActiveRuns.Add(Run());
                Assert.That(transaction.TryPlayback(state, 20, out error), Is.True, error);
                Assert.That(node.localPosition.x, Is.EqualTo(2).Within(0.001));
                state.Sequence = 4;
                Assert.That(transaction.TryPlayback(state, 21, out error), Is.True, error);
                Assert.That(node.localPosition.x, Is.EqualTo(2).Within(0.001));
                state = State(envelope, 5, 1000, false);
                state.NodeStates[1].Transform.Position.X = 2;
                state.NodeStates[1].Opacity = 0;
                Assert.That(transaction.TryPlayback(state, 20, out error), Is.True, error);
                transaction.TryUpdate(30, out error);
                Assert.That(node.localPosition.x, Is.EqualTo(2).Within(0.001));
                Assert.That(node.GetComponentInChildren<Renderer>(true).sharedMaterial.GetColor("_Color").a, Is.Zero);
            }
            finally { transaction.Dispose(); Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator SurfaceTransitionUsesTheSameInterpolatedClockAndPauses()
    {
        var root = new GameObject("transition test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var envelope = PresentationPreviewTestFixture.Create(texture: true);
                envelope.Projection.RuntimeCatalog.Surfaces[0].ReachableStateIds.Add("state:empty");
                envelope.Projection.RenderSurfaces[0].StateBindings.Add(new Unframe.Delivery.DeliveredStateBinding
                { StateId = "state:empty", Empty = new Unframe.Delivery.EmptyStateBinding() });
                envelope.Projection.SemanticSurfaces[0].States.Add(new Unframe.Delivery.SurfaceSemanticState { StateId = "state:empty" });
                var task = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png")), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(envelope.RequestId);
                var state = State(envelope, 1, 0);
                var run = Run();
                run.Owner = new RuntimeRunOwner { Group = new GroupRunOwner { GroupId = "group:first", GroupEntryEpoch = 1 } };
                run.SurfaceTransition = new SurfaceTransitionRunSnapshot
                { SurfaceId = "surface:one", FromStateId = "state:first", ToStateId = "state:empty", DurationMs = 1000, Easing = Easing.Linear };
                state.ActiveRuns.Add(run);
                state.SurfaceStates[0].StateId = "state:empty";
                state.SurfaceStates[0].TransitionRunId = run.RunId.Clone();
                Assert.That(transaction.TryPlayback(state, 10, out var error), Is.True, error);
                Assert.That(transaction.TryUpdate(10.5, out error), Is.True, error);
                var renderer = root.GetComponentInChildren<Renderer>(true);
                var properties = new MaterialPropertyBlock(); renderer.GetPropertyBlock(properties);
                Assert.That(properties.GetFloat("_Blend"), Is.EqualTo(0.5).Within(0.001));
                state.Sequence = 2; state.Clock.RuntimeTimeMs = 500; state.Clock.Paused = new Paused();
                Assert.That(transaction.TryPlayback(state, 11, out error), Is.True, error);
                transaction.TryUpdate(30, out error); renderer.GetPropertyBlock(properties);
                Assert.That(properties.GetFloat("_Blend"), Is.EqualTo(0.5).Within(0.001));
            }
            finally { transaction.Dispose(); Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator GroupOwnedTimelineCanAnimatePresentationOwnedNodes()
    {
        var root = new GameObject("timeline owner test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var envelope = PresentationPreviewTestFixture.Create(texture: true);
                var owner = new ResourceOwner { Presentation = new PresentationResourceOwner() };
                envelope.Projection.RuntimeCatalog.Nodes[1].Owner = owner;
                envelope.Projection.RuntimeCatalog.Surfaces[0].Owner = owner.Clone();
                AddTimeline(envelope);
                envelope.Projection.RuntimeCatalog.Timelines[0].Owner = new ResourceOwner { Group = new GroupResourceOwner { GroupId = "group:first" } };
                var task = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png")), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(envelope.RequestId);
                var state = State(envelope, 1, 500, false);
                var run = Run(); run.Owner = new RuntimeRunOwner { Group = new GroupRunOwner { GroupId = "group:first", GroupEntryEpoch = 1 } };
                state.ActiveRuns.Add(run);
                Assert.That(transaction.TryPlayback(state, 10, out var error), Is.True, error);
                var node = root.transform.GetChild(0).Find("Presentation Nodes/node:stage/node:surface");
                Assert.That(node.localPosition.x, Is.EqualTo(1).Within(0.001));
                state.Sequence = 2; state.CurrentGroupId = "group:second";
                Assert.That(transaction.TryPlayback(state, 11, out error), Is.False);
                Assert.That(node.localPosition.x, Is.EqualTo(1).Within(0.001));
            }
            finally { transaction.Dispose(); Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator StaleSequenceInvalidStateAndInvalidatedGenerationCannotMutateCommittedScene()
    {
        var root = new GameObject("playback fencing test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var envelope = PresentationPreviewTestFixture.Create();
                var task = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult<PresentationPreviewAssetData>(null), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(envelope.RequestId);
                var state = State(envelope, 1, 0);
                state.NodeStates[1].Transform.Position.X = 3;
                Assert.That(transaction.TryPlayback(state, 0, out var error), Is.True, error);
                Assert.That(transaction.TryPlayback(state, 1, out error), Is.False);
                Assert.That(error, Is.EqualTo("preview.playback-sequence-stale"));
                state.Sequence = 2; state.NodeStates[1].Opacity = double.NaN;
                state.NodeStates[1].Transform.Position.X = 4;
                Assert.That(transaction.TryPlayback(state, 1, out error), Is.False);
                var node = root.transform.GetChild(0).Find("Presentation Nodes/node:stage/node:surface");
                Assert.That(node.localPosition.x, Is.EqualTo(3), "rejected snapshots must not apply a partial transform");
                state.NodeStates[1].Opacity = 0.25;
                Assert.That(transaction.TryPlayback(state, 1, out error), Is.True, error);
                transaction.Invalidate(); state.Sequence = 3;
                Assert.That(transaction.TryPlayback(state, 2, out error), Is.False);
                Assert.That(error, Is.EqualTo("preview.playback-request-mismatch"));
                var next = PresentationPreviewTestFixture.Create('b');
                task = transaction.PrepareAsync(next, (_, __, ___) => Task.FromResult<PresentationPreviewAssetData>(null), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(next.RequestId);
                Assert.That(transaction.TryPlayback(state, 3, out error), Is.False);
            }
            finally { transaction.Dispose(); Object.DestroyImmediate(root); }
        }
    }
    [UnityTest]
    public IEnumerator RendererFailureStopsUpdatesAndConsumesSequenceUntilNewSceneIsCommitted()
    {
        var root = new GameObject("faulted playback test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var envelope = PresentationPreviewTestFixture.Create(texture: true);
                var task = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png")), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(envelope.RequestId);
                Assert.That(transaction.TryPlayback(State(envelope, 1, 0), 0, out var error), Is.True, error);
                Object.DestroyImmediate(root.GetComponentInChildren<MeshRenderer>(true));
                var failed = State(envelope, 2, 500, false);
                failed.NodeStates[1].Transform.Position.X = 7;
                Assert.That(transaction.TryPlayback(failed, 1, out error), Is.False);
                Assert.That(error, Is.EqualTo("preview.playback-apply-failed"));
                Assert.That(transaction.PlaybackFaulted, Is.True);
                Assert.That(transaction.TryUpdate(2, out error), Is.True, "faulted updates must be inert");
                failed.Sequence = 3;
                Assert.That(transaction.TryPlayback(failed, 2, out error), Is.False);
                Assert.That(error, Is.EqualTo("preview.playback-recovery-required"));
                Assert.That(transaction.TryRestore(State(envelope, 2, 0, false), 2, out error), Is.False);
                Assert.That(error, Is.EqualTo("preview.playback-sequence-stale"));
                Assert.That(transaction.TryRestore(State(envelope, 3, 0, false), 2, out error), Is.False);
                Assert.That(transaction.PlaybackFaulted, Is.True);
                var next = PresentationPreviewTestFixture.Create('b');
                task = transaction.PrepareAsync(next, (_, __, ___) => Task.FromResult<PresentationPreviewAssetData>(null), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(next.RequestId);
                Assert.That(transaction.PlaybackFaulted, Is.False);
                Assert.That(transaction.TryPlayback(State(next, 1, 0, false), 3, out error), Is.True, error);
                Object.DestroyImmediate(root.transform.GetChild(0).gameObject);
                Assert.That(transaction.TryPlayback(State(next, 2, 0, false), 4, out error), Is.False);
                Assert.That(error, Is.EqualTo("asset_residency_lost"));
                Assert.That(transaction.PlaybackRejected, Is.False);
                var rebuilt = PresentationPreviewTestFixture.Create('c');
                task = transaction.PrepareAsync(rebuilt, (_, __, ___) => Task.FromResult<PresentationPreviewAssetData>(null), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(rebuilt.RequestId);
                Assert.That(transaction.TryPlayback(State(rebuilt, 1, 0, false), 5, out error), Is.True, error);
            }
            finally { transaction.Dispose(); Object.DestroyImmediate(root); }
        }
    }

    [UnityTest]
    public IEnumerator FullPausedRestoreRecoversFromTransientMaterialFailureAndReplacesActiveRunsAfterAClockRewind()
    {
        var root = new GameObject("restore playback test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            try
            {
                var envelope = PresentationPreviewTestFixture.Create(texture: true);
                AddTimeline(envelope);
                var task = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(PresentationPreviewTestFixture.Png, "image/png")), CancellationToken.None);
                while (!task.IsCompleted) yield return null;
                task.GetAwaiter().GetResult(); transaction.Commit(envelope.RequestId);
                var state = State(envelope, 1, 1000, false); state.ActiveRuns.Add(Run());
                Assert.That(transaction.TryPlayback(state, 1, out var error), Is.True, error);
                var node = root.transform.GetChild(0).Find("Presentation Nodes/node:stage/node:surface");
                Assert.That(node.localPosition.x, Is.EqualTo(2).Within(0.001));
                var renderer = node.GetComponentInChildren<Renderer>(true);
                var replacementMaterial = new Material(renderer.sharedMaterial);
                replacementMaterial.SetColor("_Color", Color.white);
                Object.DestroyImmediate(renderer.sharedMaterial);
                state = State(envelope, 2, 750, false); state.ActiveRuns.Add(Run());
                Assert.That(transaction.TryPlayback(state, 2, out error), Is.False);
                Assert.That(transaction.PlaybackFaulted, Is.True);
                Object.DestroyImmediate(renderer.GetComponent("PresentationVisualOpacity"));
                renderer.sharedMaterial = replacementMaterial;
                state = State(envelope, 3, 500, true); state.ActiveRuns.Add(Run());
                Assert.That(transaction.TryRestore(state, 2, out error), Is.False);
                Assert.That(error, Is.EqualTo("preview.playback-restore-must-pause"));
                state.Clock.Paused = new Paused();
                Assert.That(transaction.TryRestore(state, 2, out error), Is.True, error);
                Assert.That(node.localPosition.x, Is.EqualTo(1).Within(0.001));
                Assert.That(node.GetComponentInChildren<Renderer>(true).sharedMaterial.GetColor("_Color").a, Is.EqualTo(0.5).Within(0.001));
                Assert.That(transaction.TryUpdate(100, out error), Is.True, error);
                Assert.That(node.localPosition.x, Is.EqualTo(1).Within(0.001));
                state = State(envelope, 4, 0, false);
                state.NodeStates[1].Transform.Position.X = 4;
                Assert.That(transaction.TryRestore(state, 101, out error), Is.True, error);
                Assert.That(transaction.TryUpdate(102, out error), Is.True, error);
                Assert.That(node.localPosition.x, Is.EqualTo(4).Within(0.001));
                Assert.That(node.GetComponentInChildren<Renderer>(true).sharedMaterial.GetColor("_Color").a, Is.EqualTo(1).Within(0.001));
                Object.DestroyImmediate(replacementMaterial);
            }
            finally { transaction.Dispose(); Object.DestroyImmediate(root); }
        }
    }

}

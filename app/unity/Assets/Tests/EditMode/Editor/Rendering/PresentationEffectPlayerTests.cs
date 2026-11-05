using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationEffectPlayerTests
{
    [TestCase(false)]
    [TestCase(true)]
    public void WaveUsesTimelineOpacityOnItsEmptyNodeIncludingInitialMidFadeSeek(bool startBeforeFade)
    {
        Assert.IsTrue(PresentationLocalPreviewAdapter.TryCreate(PresentationPreviewTestFixture.Create(), out var input, out string error), error);
        var root = new GameObject("Effects");
        var hierarchy = new PresentationNodeHierarchy();
        var timelines = new PresentationTimelinePlayer();
        using var effects = new PresentationEffectPlayer();
        try
        {
            Assert.IsTrue(hierarchy.TryReplace(input, root.transform, out error), error);
            Assert.IsTrue(hierarchy.Registry.TryGet("node:stage", out var target));
            Assert.IsEmpty(target.GetComponentsInChildren<Renderer>());
            var run = new EffectRunSnapshot
            {
                RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
                NodeId = "node:stage",
                Configuration = new EffectConfiguration
                {
                    Kind = EffectKind.Wave, Size = 1, Speed = 1, DurationMs = 1000,
                    Color = new Unframe.Presentation.SrgbaColor { Alpha = 0.8 },
                },
            };
            if (startBeforeFade)
                Assert.IsTrue(effects.TryUpdate(input, new[] { run }, hierarchy, 1000, out error), error);
            var timeline = new ProjectedTimelineDefinition
            {
                TimelineId = "timeline:wave-opacity", DurationMs = 1000,
                Tracks =
                {
                    new ProjectedTimelineTrack
                    {
                        Target = new TimelineTrackTarget { NodeId = run.NodeId, Property = TimelineProperty.Opacity },
                        Keyframes =
                        {
                            new TimelineKeyframe { TimeMs = 0, EasingToNext = Easing.Linear, Number = new NumberKeyframeValue { Value = 1 } },
                            new TimelineKeyframe { TimeMs = 1000, Number = new NumberKeyframeValue { Value = 0 } },
                        },
                    },
                },
            };
            Assert.IsTrue(timelines.TryStart(timeline, hierarchy, 0, out error), error);
            timelines.Update(0.75);
            Assert.IsTrue(input.TryGetNodeState(run.NodeId, out var canonical));
            Assert.That(canonical.Opacity, Is.EqualTo(1));
            Assert.IsTrue(effects.TryUpdate(input, new[] { run }, hierarchy, 1750, out error), error);
            var line = target.GetComponentInChildren<LineRenderer>();
            var position = line.GetPosition(80);
            var width = line.widthMultiplier;
            foreach (float time in new[] { 0.75f, 0.5f, 0f, 1f, 0f })
            {
                timelines.Update(time, true);
                Assert.IsTrue(effects.TryUpdate(input, new[] { run }, hierarchy, 1750, out error), error);
                Assert.AreSame(line, target.GetComponentInChildren<LineRenderer>());
                Assert.That(line.colorGradient.Evaluate(0.5f).a, Is.EqualTo(0.8f * (1 - time)).Within(0.005f));
                Assert.That(line.colorGradient.Evaluate(1).a, Is.Zero.Within(0.001f));
                Assert.That(line.GetPosition(80), Is.EqualTo(position));
                Assert.That(line.widthMultiplier, Is.EqualTo(width));
                Assert.That(target.transform.localScale, Is.EqualTo(UnityEngine.Vector3.one));
                Assert.That(effects.Count, Is.EqualTo(1));
            }
        }
        finally { timelines.Clear(); effects.Clear(); hierarchy.Clear(); Object.DestroyImmediate(root); }
    }

    [Test]
    public void WaveResolvesItsNodeRestoresFromClockAndReleasesOnStop()
    {
        Assert.IsTrue(PresentationLocalPreviewAdapter.TryCreate(PresentationPreviewTestFixture.Create(), out var input, out string error), error);
        var root = new GameObject("Effects");
        var hierarchy = new PresentationNodeHierarchy();
        using var effects = new PresentationEffectPlayer();
        try
        {
            Assert.IsTrue(hierarchy.TryReplace(input, root.transform, out error), error);
            var run = new EffectRunSnapshot
            {
                RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
                NodeId = "node:stage",
                Configuration = new EffectConfiguration
                {
                    Kind = EffectKind.Wave,
                    Size = 1,
                    Speed = 1,
                    DurationMs = 1000,
                    WaveCycles = 2,
                    Color = new Unframe.Presentation.SrgbaColor { Red = 1, Blue = 1, Alpha = 1 }
                },
            };
            Assert.IsTrue(effects.TryUpdate(input, new[] { run }, hierarchy, 500, out error), error);
            Assert.IsTrue(hierarchy.Registry.TryGet(run.NodeId, out var target));
            var lines = target.GetComponentsInChildren<LineRenderer>();
            Assert.AreEqual(12, lines.Length);
            int points = lines[0].positionCount;
            Assert.IsTrue(effects.TryUpdate(input, new[] { run.Clone() }, hierarchy, 500, out error), error);
            Assert.AreEqual(points, lines[0].positionCount);
            Assert.AreEqual(12, target.GetComponentsInChildren<LineRenderer>().Length);
            Assert.IsTrue(effects.TryUpdate(input, new[] { run }, hierarchy, 1500, out error), error);
            Assert.Greater(lines[0].positionCount, points);
            Assert.IsTrue(effects.TryUpdate(input, System.Array.Empty<EffectRunSnapshot>(), hierarchy, 1500, out error), error);
            Assert.AreEqual(0, effects.Count);
            Assert.AreEqual(0, target.GetComponentsInChildren<LineRenderer>().Length);
        }
        finally { effects.Clear(); hierarchy.Clear(); Object.DestroyImmediate(root); }
    }
    [TestCase(false)]
    [TestCase(true)]
    public void UnsupportedDissolveKeepsTheOtherRunAndCanonicalVisibility(bool skinned)
    {
        Assert.IsTrue(PresentationLocalPreviewAdapter.TryCreate(PresentationPreviewTestFixture.Create(), out var input, out string error), error);
        var root = new GameObject("Effects");
        var hierarchy = new PresentationNodeHierarchy();
        using var effects = new PresentationEffectPlayer();
        try
        {
            Assert.IsTrue(hierarchy.TryReplace(input, root.transform, out error), error);
            Assert.IsTrue(hierarchy.Registry.TryGet("node:stage", out var target));
            if (skinned) target.AddComponent<SkinnedMeshRenderer>();
            var wave = new EffectRunSnapshot
            {
                RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
                NodeId = "node:stage",
                Configuration = new EffectConfiguration
                {
                    Kind = EffectKind.Wave,
                    Size = 1,
                    Speed = 1,
                    DurationMs = 1000,
                    Color = new Unframe.Presentation.SrgbaColor { Alpha = 1 }
                },
            };
            var dissolve = wave.Clone();
            dissolve.RunId.RunSequence = 2;
            dissolve.Configuration.Kind = EffectKind.Dissolve;
            Assert.IsTrue(effects.TryUpdate(input, new[] { dissolve, wave }, hierarchy, 500, out error), error);
            Assert.AreEqual(12, target.GetComponentsInChildren<LineRenderer>().Length);
            Assert.IsTrue(effects.TryUpdate(input, new[] { dissolve, wave }, hierarchy, 1000, out error), error);
            Assert.IsTrue(input.TryGetNodeState("node:stage", out var state));
            state.Visible = false;
            new PresentationNodeStateApplier().Apply(input, hierarchy);
            foreach (var renderer in target.GetComponentsInChildren<Renderer>()) Assert.IsFalse(renderer.enabled);
        }
        finally { effects.Clear(); hierarchy.Clear(); Object.DestroyImmediate(root); }
    }

    [Test]
    public void OneDissolveRunCanOwnMoreThan32StaticMeshes()
    {
        Assert.IsTrue(PresentationLocalPreviewAdapter.TryCreate(PresentationPreviewTestFixture.Create(), out var input, out string error), error);
        var root = new GameObject("Effects");
        var hierarchy = new PresentationNodeHierarchy();
        using var effects = new PresentationEffectPlayer();
        try
        {
            Assert.IsTrue(hierarchy.TryReplace(input, root.transform, out error), error);
            Assert.IsTrue(hierarchy.Registry.TryGet("node:stage", out var target));
            for (int i = 0; i < 33; i++)
            {
                var mesh = GameObject.CreatePrimitive(PrimitiveType.Cube);
                mesh.transform.SetParent(target.transform, false);
            }
            var run = new EffectRunSnapshot
            {
                RunId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 },
                NodeId = "node:stage",
                Configuration = new EffectConfiguration
                {
                    Kind = EffectKind.Dissolve,
                    Size = 1,
                    Speed = 1,
                    DurationMs = 1000,
                    Color = new Unframe.Presentation.SrgbaColor { Alpha = 1 }
                },
            };
            Assert.IsTrue(effects.TryUpdate(input, new[] { run }, hierarchy, 500, out error), error);
            var shader = Resources.Load<Shader>("VisualEffects/VisualDissolve");
            foreach (var renderer in target.GetComponentsInChildren<MeshRenderer>())
                Assert.AreSame(shader, renderer.sharedMaterial.shader);
        }
        finally { effects.Clear(); hierarchy.Clear(); Object.DestroyImmediate(root); }
    }

}

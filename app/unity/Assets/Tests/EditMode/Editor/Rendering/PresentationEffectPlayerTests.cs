using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationEffectPlayerTests
{
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

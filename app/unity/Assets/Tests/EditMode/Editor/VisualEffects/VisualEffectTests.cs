using System;
using NUnit.Framework;
using Unframe.Unity.VisualEffects;
using UnityEngine;

public sealed class VisualEffectTests
{
    [TestCase(110, 0.4f)]
    [TestCase(1000, 0.8f)]
    public void WaveOpacityMultipliesTheOriginalAlphaAndAppearanceWithoutAccumulating(double now, float baseAlpha)
    {
        var stage = new GameObject("Wave stage");
        try
        {
            using var effects = new VisualEffectPlayer();
            var options = new EffectOptions("wave", 1, new Color(1, 1, 1, 0.8f), 1, 1000, 42, 0);
            var handle = effects.PlayWave(options, stage.transform);
            effects.Evaluate(now);
            var line = stage.GetComponentInChildren<LineRenderer>();
            var position = line.GetPosition(10);
            var width = line.widthMultiplier;
            foreach (float opacity in new[] { 0.25f, 0.25f, 0f, 1f, 0.5f, 1f })
            {
                effects.SetWaveOpacity("wave", opacity);
                effects.Evaluate(now);
                Assert.That(line.colorGradient.Evaluate(0.5f).a, Is.EqualTo(baseAlpha * opacity).Within(0.005f));
                Assert.That(line.colorGradient.Evaluate(1).a, Is.Zero.Within(0.001f));
                Assert.That(line.GetPosition(10), Is.EqualTo(position));
                Assert.That(line.widthMultiplier, Is.EqualTo(width));
                Assert.That(stage.transform.localScale, Is.EqualTo(Vector3.one));
                Assert.That(effects.PlayWave(options, stage.transform), Is.SameAs(handle));
                Assert.That(options.Color.a, Is.EqualTo(0.8f));
            }
        }
        finally { UnityEngine.Object.DestroyImmediate(stage); }
    }

    [TestCase(float.NaN)]
    [TestCase(float.PositiveInfinity)]
    [TestCase(float.NegativeInfinity)]
    [TestCase(-0.1f)]
    [TestCase(1.1f)]
    public void WaveRejectsInvalidOpacityWithoutChangingItsCurrentValue(float opacity)
    {
        var stage = new GameObject("Wave stage");
        try
        {
            using var effects = new VisualEffectPlayer();
            effects.PlayWave(new EffectOptions("wave", 1, Color.white, 1, 1000, 42, 0), stage.transform);
            effects.SetWaveOpacity("wave", 0.25f);
            Assert.Throws<ArgumentOutOfRangeException>(() => effects.SetWaveOpacity("wave", opacity));
            effects.Evaluate(1000);
            Assert.That(stage.GetComponentInChildren<LineRenderer>().colorGradient.Evaluate(0.5f).a,
                Is.EqualTo(0.25f).Within(0.005f));
        }
        finally { UnityEngine.Object.DestroyImmediate(stage); }
    }

    [Test]
    public void WaveOpacityRejectsAbsentCancelledAndNonWaveRuns()
    {
        using var effects = new VisualEffectPlayer();
        Assert.Throws<ArgumentException>(() => effects.SetWaveOpacity(null, 1));
        Assert.Throws<ArgumentException>(() => effects.SetWaveOpacity("missing", 1));
        effects.BeginHandGlow(new EffectOptions("hand", 1, Color.white, 1, 1000, 42, 0));
        Assert.Throws<ArgumentException>(() => effects.SetWaveOpacity("hand", 1));
        var handle = effects.PlayWave(new EffectOptions("wave", 1, Color.white, 1, 1000, 42, 0), null);
        handle.Cancel();
        Assert.Throws<ArgumentException>(() => effects.SetWaveOpacity("wave", 1));
    }

    [TestCase(0.2f)]
    [TestCase(0.5f)]
    [TestCase(1f)]
    public void WaveLeadingEdgeHasDenseCurvesAndASoftTaper(float progress)
    {
        var stage = new GameObject("Wave stage");
        try
        {
            using var effects = new VisualEffectPlayer();
            effects.PlayWave(new EffectOptions("wave", 1, Color.white, 1, 1000, 42, 0), stage.transform);
            effects.Evaluate(progress * 1000);
            var line = stage.GetComponentInChildren<LineRenderer>();
            for (var i = 1; i < line.positionCount; i++)
                Assert.That(line.GetPosition(i).x - line.GetPosition(i - 1).x, Is.LessThanOrEqualTo(0.04f));
            Assert.That(line.numCapVertices, Is.GreaterThanOrEqualTo(4));
            Assert.That(line.numCornerVertices, Is.GreaterThanOrEqualTo(2));
            Assert.That(line.widthCurve.Evaluate(0.5f), Is.EqualTo(1).Within(0.001f));
            Assert.That(line.widthCurve.Evaluate(0.97f), Is.InRange(0.2f, 0.8f));
            Assert.That(line.widthCurve.Evaluate(1), Is.Zero.Within(0.001f));
            Assert.That(line.colorGradient.Evaluate(0.5f).a, Is.GreaterThan(0.8f));
            Assert.That(line.colorGradient.Evaluate(1).a, Is.Zero.Within(0.001f));
        }
        finally { UnityEngine.Object.DestroyImmediate(stage); }
    }

    [TestCase(1f, 0.018f)]
    [TestCase(0.48f, 0.00864f)]
    public void WaveStrandWidthAndPositionsFollowTheParentScale(float size, float expectedWidth)
    {
        var stage = new GameObject("Wave stage");
        try
        {
            using var effects = new VisualEffectPlayer();
            effects.PlayWave(new EffectOptions("wave", size, Color.white, 1, 1000, 42, 0), stage.transform);
            var line = stage.GetComponentInChildren<LineRenderer>(true);
            Assert.That(line.widthMultiplier, Is.EqualTo(expectedWidth).Within(0.00001f));
            effects.Evaluate(1000);
            Assert.That(line.widthMultiplier, Is.EqualTo(expectedWidth).Within(0.00001f));
            Assert.That(line.widthCurve.Evaluate(0.5f), Is.EqualTo(1).Within(0.001f));
            Assert.That(line.widthCurve.Evaluate(1), Is.Zero.Within(0.001f));
            Assert.That(line.colorGradient.Evaluate(1).a, Is.Zero.Within(0.001f));
            var localPoint = line.GetPosition(0);
            var width = line.widthMultiplier;
            stage.transform.localScale = Vector3.one * 0.25f;
            effects.Evaluate(1000);
            Assert.That(line.widthMultiplier, Is.EqualTo(width * 0.25f).Within(0.00001f));
            Assert.That(line.transform.TransformPoint(localPoint), Is.EqualTo(localPoint * 0.25f));
            stage.transform.localScale = Vector3.one;
            effects.Evaluate(1000);
            Assert.That(line.widthMultiplier, Is.EqualTo(width).Within(0.00001f));
        }
        finally { UnityEngine.Object.DestroyImmediate(stage); }
    }

    [Test]
    public void WaveHoldsItsFinalShapeUntilCancelled()
    {
        var stage = new GameObject("Wave stage");
        try
        {
            using var effects = new VisualEffectPlayer();
            var options = new EffectOptions("wave", 1, Color.white, 1, 1000, 42, 0);
            var handle = effects.PlayWave(options, stage.transform);
            var completed = false;
            handle.Completed += () => completed = true;
            effects.Evaluate(1000);
            var lines = stage.GetComponentsInChildren<LineRenderer>();
            Assert.That(lines.Length, Is.EqualTo(12));
            Assert.That(effects.ActiveCount, Is.EqualTo(1));
            Assert.That(handle.Progress, Is.EqualTo(1));
            var end = lines[0].GetPosition(lines[0].positionCount - 1);
            var alpha = lines[0].colorGradient.Evaluate(0.5f).a;
            Assert.That(alpha, Is.GreaterThan(0));
            var material = lines[0].sharedMaterial;
            effects.Evaluate(5000);
            Assert.That(lines[0].GetPosition(lines[0].positionCount - 1), Is.EqualTo(end));
            Assert.That(lines[0].colorGradient.Evaluate(0.5f).a, Is.EqualTo(alpha));
            Assert.That(effects.PlayWave(options, stage.transform), Is.SameAs(handle));
            Assert.That(completed, Is.False);
            handle.Cancel();
            Assert.That(effects.ActiveCount, Is.Zero);
            Assert.That(stage.GetComponentsInChildren<LineRenderer>().Length, Is.Zero);
            Assert.That(material == null, Is.True);
            Assert.That(completed, Is.False);
            Assert.DoesNotThrow(() => effects.PlayWave(options, stage.transform));
        }
        finally { UnityEngine.Object.DestroyImmediate(stage); }
    }

    [Test]
    public void WaveRevealsParallelLinesOnAPlaneFromLeftToRight()
    {
        var stage = new GameObject("Wave stage");
        try
        {
            using var effects = new VisualEffectPlayer();
            effects.PlayWave(new EffectOptions("wave", 1, Color.white, 1, 1000, 42, 0), stage.transform);
            effects.Evaluate(500);
            var lines = stage.GetComponentsInChildren<LineRenderer>();
            Assert.That(lines.Length, Is.EqualTo(12));
            var first = lines[0].GetPosition(0);
            var drawn = lines[0].GetPosition(10);
            var count = lines[0].positionCount;
            Assert.That(first.x, Is.EqualTo(-4).Within(0.001f));
            Assert.That(drawn.x, Is.GreaterThan(first.x));
            Assert.That(first.z, Is.Zero.Within(0.001f));
            Assert.That(drawn.z, Is.Zero.Within(0.001f));
            Assert.That(first.y - lines[1].GetPosition(0).y, Is.EqualTo(0.12f).Within(0.001f));
            Assert.That(drawn.y - lines[1].GetPosition(10).y, Is.EqualTo(0.12f).Within(0.001f));
            effects.Evaluate(650);
            Assert.That(lines[0].GetPosition(0), Is.EqualTo(first));
            Assert.That(lines[0].GetPosition(10), Is.EqualTo(drawn));
            Assert.That(lines[0].positionCount, Is.GreaterThan(count));
            effects.Evaluate(900);
            Assert.That(lines[0].endColor.a, Is.Zero.Within(0.001f));
            Assert.That(lines[0].colorGradient.Evaluate(0.5f).a, Is.EqualTo(lines[0].startColor.a).Within(0.001f));
            effects.Evaluate(1000);
            float minY = float.PositiveInfinity, maxY = float.NegativeInfinity;
            for (int i = 0; i < lines[0].positionCount; i++)
            {
                float y = lines[0].GetPosition(i).y;
                minY = Mathf.Min(minY, y);
                maxY = Mathf.Max(maxY, y);
            }
            Assert.That(maxY - minY, Is.GreaterThan(1f).And.LessThanOrEqualTo(1.2f));
            Assert.That(lines[0].startColor.b, Is.EqualTo(0xf5 / 255f).Within(0.01f));
            Assert.That(lines[0].endColor.r, Is.EqualTo(0xdf / 255f).Within(0.01f));
        }
        finally { UnityEngine.Object.DestroyImmediate(stage); }
    }

    [Test]
    public void WaveInstancesCanBePlacedAndCancelledIndependently()
    {
        var left = new GameObject("left");
        var right = new GameObject("right");
        right.transform.position = new Vector3(4, 2, 3);
        right.transform.rotation = Quaternion.Euler(0, 180, 0);
        try
        {
            using var effects = new VisualEffectPlayer();
            var first = effects.PlayWave(new EffectOptions("a", 1, Color.white, 1, 1000, 42, 0), left.transform);
            effects.PlayWave(new EffectOptions("b", 2, Color.white, 1, 1000, 42, 500), right.transform);
            effects.Evaluate(750);
            var a = left.GetComponentInChildren<LineRenderer>();
            var b = right.GetComponentInChildren<LineRenderer>();
            Assert.That(a.transform.parent.parent, Is.SameAs(left.transform));
            Assert.That(b.transform.parent.parent, Is.SameAs(right.transform));
            Assert.That(b.GetPosition(0).x, Is.EqualTo(-8).Within(0.001f));
            Assert.That(b.GetPosition(b.positionCount - 1).x, Is.LessThan(a.GetPosition(a.positionCount - 1).x * 2));
            first.Cancel();
            Assert.That(effects.ActiveCount, Is.EqualTo(1));
            Assert.That(right.GetComponentsInChildren<LineRenderer>().Length, Is.EqualTo(12));
        }
        finally { UnityEngine.Object.DestroyImmediate(left); UnityEngine.Object.DestroyImmediate(right); }
    }

    [Test]
    public void ExternalClockAndSpeedDetermineCompletionOnce()
    {
        using var effects = new VisualEffectPlayer();
        var completed = 0;
        var handle = effects.BeginHandGlow(new EffectOptions("hand", 1, Color.cyan, 2, 1000, 42, 100));
        effects.EndHandGlow("hand", 100);
        handle.Completed += () => completed++;
        effects.Evaluate(350);
        Assert.That(handle.Progress, Is.EqualTo(0.5f));
        effects.Evaluate(600);
        effects.Evaluate(900);
        Assert.That(completed, Is.EqualTo(1));
        Assert.That(effects.ActiveCount, Is.Zero);
    }

    [Test]
    public void InvalidOptionsAreRejectedBeforeAllocation()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new EffectOptions("x", 1, Color.white, 0, 100, 1, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new EffectOptions("x", float.NaN, Color.white, 1, 100, 1, 0));
    }

    [Test]
    public void CancelDoesNotCompleteAndReleasesRunId()
    {
        using var effects = new VisualEffectPlayer();
        var options = new EffectOptions("x", 1, Color.white, 1, 100, 1, 0);
        var first = effects.PlayWave(options, null);
        Assert.That(effects.PlayWave(options, null), Is.SameAs(first));
        var completed = false;
        first.Completed += () => completed = true;
        first.Cancel();
        Assert.That(completed, Is.False);
        Assert.That(effects.ActiveCount, Is.Zero);
        Assert.DoesNotThrow(() => effects.PlayWave(options, null));
    }

    [Test]
    public void EndHandGlowDrainsUsingExternalClock()
    {
        using var effects = new VisualEffectPlayer();
        var handle = effects.BeginHandGlow(new EffectOptions("hand", 1, Color.white, 1, 200, 1, 0));
        effects.UpdatePose("hand", Vector3.zero, 0);
        effects.UpdatePose("hand", Vector3.right, 100);
        effects.EndHandGlow("hand", 100);
        effects.Evaluate(299);
        Assert.That(effects.ActiveCount, Is.EqualTo(1));
        effects.Evaluate(300);
        Assert.That(effects.ActiveCount, Is.Zero);
    }

    [Test]
    public void DissolveRestoresMaterialsBeforeCompletionAndRejectsConcurrentOwnership()
    {
        var target = GameObject.CreatePrimitive(PrimitiveType.Cube);
        var renderer = target.GetComponent<MeshRenderer>();
        var original = renderer.sharedMaterial;
        var shader = Resources.Load<Shader>("VisualEffects/VisualDissolve");
        try
        {
            using var effects = new VisualEffectPlayer();
            var options = new EffectOptions("exit", 1, Color.cyan, 1, 100, 42, 100);
            var handle = effects.PlayDissolve(options, renderer, shader);
            effects.Evaluate(50);
            Assert.That(renderer.sharedMaterial, Is.SameAs(original));
            effects.Evaluate(150);
            Assert.That(renderer.sharedMaterial, Is.Not.SameAs(original));
            Assert.That(renderer.sharedMaterial.GetFloat("_Progress"), Is.EqualTo(0.5f));
            Assert.Throws<InvalidOperationException>(() => effects.PlayDissolve(
                new EffectOptions("other", 1, Color.white, 1, 100, 0, 0), renderer, shader));
            handle.Completed += () =>
            {
                Assert.That(renderer.sharedMaterial, Is.SameAs(original));
                renderer.enabled = false;
            };
            effects.Evaluate(200);
            Assert.That(renderer.enabled, Is.False);
            Assert.That(effects.ActiveCount, Is.Zero);
        }
        finally { UnityEngine.Object.DestroyImmediate(target); }
    }

    [Test]
    public void CompletionExceptionDoesNotLeakMaterialsOrRun()
    {
        var target = GameObject.CreatePrimitive(PrimitiveType.Cube);
        var renderer = target.GetComponent<MeshRenderer>();
        var original = renderer.sharedMaterial;
        try
        {
            using var effects = new VisualEffectPlayer();
            var handle = effects.PlayDissolve(new EffectOptions("exit", 1, Color.white, 1, 100, 0, 0),
                renderer, Resources.Load<Shader>("VisualEffects/VisualDissolve"));
            handle.Completed += () => throw new InvalidOperationException("consumer");
            effects.Evaluate(50);
            Assert.Throws<InvalidOperationException>(() => effects.Evaluate(100));
            Assert.That(effects.ActiveCount, Is.Zero);
            Assert.That(renderer.sharedMaterial, Is.SameAs(original));
        }
        finally { UnityEngine.Object.DestroyImmediate(target); }
    }

    [Test]
    public void DisposeRestoresDissolveAndRejectsFurtherStarts()
    {
        var target = GameObject.CreatePrimitive(PrimitiveType.Cube);
        var renderer = target.GetComponent<MeshRenderer>();
        var original = renderer.sharedMaterial;
        try
        {
            var effects = new VisualEffectPlayer();
            effects.PlayDissolve(new EffectOptions("exit", 1, Color.white, 1, 100, 0, 0),
                renderer, Resources.Load<Shader>("VisualEffects/VisualDissolve"));
            effects.Evaluate(50);
            effects.Dispose();
            Assert.That(renderer.sharedMaterial, Is.SameAs(original));
            Assert.Throws<ObjectDisposedException>(() => effects.PlayWave(
                new EffectOptions("wave", 1, Color.white, 1, 100, 0, 0), null));
        }
        finally { UnityEngine.Object.DestroyImmediate(target); }
    }
    [Test]
    public void RuntimeDissolveKeepsTerminalMaterialUntilCanonicalStop()
    {
        var target = GameObject.CreatePrimitive(PrimitiveType.Cube);
        var renderer = target.GetComponent<MeshRenderer>();
        var original = renderer.sharedMaterial;
        try
        {
            using var effects = new VisualEffectPlayer();
            var handle = effects.PlayDissolve(new EffectOptions("exit", 1, Color.white, 1, 100, 0, 0),
                renderer, Resources.Load<Shader>("VisualEffects/VisualDissolve"), true);
            effects.Evaluate(150);
            Assert.AreEqual(1, effects.ActiveCount);
            Assert.AreEqual(1, handle.Progress);
            Assert.AreNotSame(original, renderer.sharedMaterial);
            handle.Cancel();
            Assert.AreSame(original, renderer.sharedMaterial);
            Assert.AreEqual(0, effects.ActiveCount);
        }
        finally { UnityEngine.Object.DestroyImmediate(target); }
    }

}

using System;
using NUnit.Framework;
using Unframe.Unity.VisualEffects;
using UnityEngine;

public sealed class VisualEffectTests
{
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
            var alpha = lines[0].endColor.a;
            Assert.That(alpha, Is.GreaterThan(0));
            var material = lines[0].sharedMaterial;
            effects.Evaluate(5000);
            Assert.That(lines[0].GetPosition(lines[0].positionCount - 1), Is.EqualTo(end));
            Assert.That(lines[0].endColor.a, Is.EqualTo(alpha));
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
            Assert.That(lines[0].endColor.a, Is.EqualTo(lines[0].startColor.a).Within(0.001f));
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
}

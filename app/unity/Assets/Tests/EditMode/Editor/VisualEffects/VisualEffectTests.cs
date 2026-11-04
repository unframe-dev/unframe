using System;
using NUnit.Framework;
using Unframe.Unity.VisualEffects;
using UnityEngine;

public sealed class VisualEffectTests
{
    [Test]
    public void WavesCrossBehindAndKeepBothEndsMovingWhileFading()
    {
        var stage = new GameObject("Wave stage");
        try
        {
            using var effects = new VisualEffectPlayer();
            effects.PlayWave(new EffectOptions("wave", 1, Color.white, 1, 1000, 42, 0), stage.transform);
            effects.Evaluate(650);
            var lines = stage.GetComponentsInChildren<LineRenderer>();
            Assert.That(lines.Length, Is.EqualTo(12));
            Assert.That(lines[0].positionCount, Is.GreaterThanOrEqualTo(96));
            Assert.That(lines[0].GetPosition(lines[0].positionCount - 1).x, Is.GreaterThan(0));
            Assert.That(lines[6].GetPosition(lines[6].positionCount - 1).x, Is.LessThan(0));
            Assert.That(lines[0].GetPosition(40).z, Is.GreaterThan(0.5f));
            Assert.That(lines[0].startColor, Is.Not.EqualTo(lines[5].startColor));
            var beforeHead = lines[0].GetPosition(95);
            var beforeTail = lines[0].GetPosition(0);
            var alpha = lines[0].startColor.a;
            effects.Evaluate(750);
            Assert.That(lines[0].GetPosition(95).x, Is.GreaterThan(beforeHead.x));
            effects.Evaluate(900);
            Assert.That(lines[0].GetPosition(0).x, Is.GreaterThan(beforeTail.x));
            Assert.That(lines[0].GetPosition(95).x, Is.GreaterThan(beforeHead.x));
            Assert.That(lines[0].startColor.a, Is.LessThan(alpha));
        }
        finally { UnityEngine.Object.DestroyImmediate(stage); }
    }

    [Test]
    public void ExternalClockAndSpeedDetermineCompletionOnce()
    {
        using var effects = new VisualEffectPlayer();
        var completed = 0;
        var handle = effects.PlayWave(new EffectOptions("wave", 1, Color.cyan, 2, 1000, 42, 100), null);
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

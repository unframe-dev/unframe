using System.Reflection;
using NUnit.Framework;
using Unframe.Presentation.V2;
using Unframe.Realtime.V2;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationBakedRenderingEditModeTests
{
    [Test]
    public void BakedShaderIsPackagedWithTwoResidentTextureSlotsAndOpacity()
    {
        Shader shader = Resources.Load<Shader>("BakedSurface");
        Assert.That(shader, Is.Not.Null);
        using (var renderer = new PresentationBakedSurfaceRenderer())
        {
            var material = new Material(shader);
            try
            {
                Assert.That(material.HasProperty("_FromTex"), Is.True);
                Assert.That(material.HasProperty("_ToTex"), Is.True);
                Assert.That(material.HasProperty("_Blend"), Is.True);
                Assert.That(material.HasProperty("_Color"), Is.True);
            }
            finally { Object.DestroyImmediate(material); }
        }
    }

    [Test]
    public void TransitionEasingAndRuntimeClockFollowCanonicalTime()
    {
        MethodInfo ease = typeof(PresentationBakedSurfaceRenderer).GetMethod("Ease", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.That((float)ease.Invoke(null, new object[] { 0.5f, Easing.CubicIn }), Is.EqualTo(0.125f).Within(0.0001f));
        Assert.That((float)ease.Invoke(null, new object[] { 0.5f, Easing.CubicOut }), Is.EqualTo(0.875f).Within(0.0001f));

        MethodInfo sample = typeof(PresentationBakedRuntime).GetMethod("SampleRuntimeTimeMs", BindingFlags.NonPublic | BindingFlags.Static);
        var clock = new RuntimeClockSnapshot { RuntimeTimeMs = 1200, Running = new Running() };
        Assert.That((double)sample.Invoke(null, new object[] { clock, 10d, 10.4d }), Is.EqualTo(1600d).Within(0.001d));
        clock.Paused = new Paused { Reason = PauseReason.ExplicitPause };
        Assert.That((double)sample.Invoke(null, new object[] { clock, 10d, 30d }), Is.EqualTo(1200d));
    }
}

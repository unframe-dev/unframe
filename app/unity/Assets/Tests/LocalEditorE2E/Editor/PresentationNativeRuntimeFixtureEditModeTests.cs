using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationNativeRuntimeFixtureEditModeTests
{
    [Test]
    public void NativeFixtureKeepsPresentationAtWorldIdentityWithAnIndependentRenderRoot()
    {
        var host = new GameObject("Native calibration test");
        Transform presentation = null;
        try
        {
            host.transform.SetPositionAndRotation(new Vector3(2, 3, 4), Quaternion.Euler(15, 30, 45));
            var runtime = host.AddComponent<PresentationBakedRuntime>();
            presentation = PresentationNativeRuntimeFixture.Configure(runtime);
            Assert.That(runtime.CalibrationReady, Is.True);
            Assert.That(presentation, Is.SameAs(runtime.PresentationSpace));
            Assert.That(presentation.parent, Is.Null);
            Assert.That(presentation.IsChildOf(host.transform), Is.False);
            Assert.That(Vector3.Distance(presentation.position, Vector3.zero), Is.LessThan(0.00001f));
            Assert.That(Quaternion.Angle(presentation.rotation, Quaternion.identity), Is.LessThan(0.01f));
            Assert.That(presentation.localScale, Is.EqualTo(Vector3.one));
            Assert.That(presentation.gameObject.activeSelf, Is.False, "Spatial content waits for the session keyframe.");
        }
        finally
        {
            if (presentation != null) Object.DestroyImmediate(presentation.gameObject);
            Object.DestroyImmediate(host);
        }
    }
}

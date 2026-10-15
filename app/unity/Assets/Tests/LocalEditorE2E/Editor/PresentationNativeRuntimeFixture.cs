using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

internal static class PresentationNativeRuntimeFixture
{
    internal static Transform Configure(PresentationBakedRuntime runtime)
    {
        Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(Pose.identity, runtime.transform,
            out var pose, out string error), Is.True, error);
        var calibration = new PresentationCalibrationState();
        Assert.That(calibration.TrySet(pose, out error), Is.True, error);
        runtime.ConfigureCalibration(calibration, runtime.transform);
        return runtime.PresentationSpace;
    }
}

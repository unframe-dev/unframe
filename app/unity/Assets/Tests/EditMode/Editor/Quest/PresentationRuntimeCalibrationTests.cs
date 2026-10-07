using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationRuntimeCalibrationTests
{
    [Test]
    public void RuntimeRootUsesInverseCalibrationAndKeepsRuntimeOriginSeparate()
    {
        var host = new GameObject("Runtime");
        var tracking = new GameObject("Tracking");
        try
        {
            tracking.transform.SetPositionAndRotation(new Vector3(2, 3, 4), Quaternion.Euler(0, 35, 0));
            var marker = new Pose(new Vector3(1, 2, 5), Quaternion.Euler(20, 15, 0));
            Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(marker, tracking.transform, out var pose, out string error), Is.True, error);
            var calibration = new PresentationCalibrationState();
            Assert.That(calibration.TrySet(pose, out error), Is.True, error);
            var runtime = host.AddComponent<PresentationBakedRuntime>();
            runtime.ConfigureCalibration(calibration, tracking.transform);
            runtime.RefreshCalibration();
            Assert.That(runtime.CalibrationReady, Is.True);
            Assert.That(Vector3.Distance(runtime.PresentationSpace.position, marker.position), Is.LessThan(0.00001));
            Assert.That(Quaternion.Angle(runtime.PresentationSpace.rotation, marker.rotation), Is.LessThan(0.01));
            Assert.That(runtime.PresentationSpace.localScale, Is.EqualTo(Vector3.one));
            Assert.That(runtime.PresentationSpace.gameObject.activeSelf, Is.False, "An unconnected runtime must stay hidden.");
            Assert.That(runtime.CanSendInput || runtime.CanSendTracking, Is.False);
            var child = new GameObject("Runtime origin");
            child.transform.SetParent(runtime.PresentationSpace, false);
            child.transform.localPosition = new Vector3(0.4f, 0.5f, 0.6f);
            child.transform.localRotation = Quaternion.Euler(0, 25, 0);
            var node = new GameObject("Node");
            node.transform.SetParent(child.transform, false);
            node.transform.localPosition = new Vector3(0.7f, 0.8f, 0.9f);
            Vector3 expected = marker.position + marker.rotation * (child.transform.localPosition + child.transform.localRotation * node.transform.localPosition);
            runtime.RefreshCalibration();
            runtime.RefreshCalibration();
            Assert.That(Vector3.Distance(node.transform.position, expected), Is.LessThan(0.00001));
            calibration.Invalidate("recentered");
            Assert.That(runtime.CalibrationReady, Is.False);
            Assert.That(runtime.PresentationSpace.gameObject.activeSelf, Is.False);
            Assert.That(calibration.TrySet(pose, out error), Is.True, error);
            Assert.That(runtime.CalibrationReady, Is.True);
            typeof(PresentationBakedRuntime).GetMethod("OnDestroy", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(runtime, null);
            Object.DestroyImmediate(host);
            Assert.That(child == null, Is.True, "Runtime disposal must remove the independent generated space.");
        }
        finally { Object.DestroyImmediate(host); Object.DestroyImmediate(tracking); }
    }

    [Test]
    public void ReplacingCalibrationUnsubscribesTheOldState()
    {
        var host = new GameObject("Runtime");
        var tracking = new GameObject("Tracking");
        try
        {
            var previous = new PresentationCalibrationState();
            var current = new PresentationCalibrationState();
            var pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity);
            Assert.That(previous.TrySet(pose, out _), Is.True);
            Assert.That(current.TrySet(pose, out _), Is.True);
            var runtime = host.AddComponent<PresentationBakedRuntime>();
            runtime.ConfigureCalibration(previous, tracking.transform);
            runtime.ConfigureCalibration(current, tracking.transform);
            tracking.transform.localScale = new Vector3(2, 1, 1);
            previous.Invalidate("old-source-reset");
            Assert.That(current.IsValid, Is.True, "The old source must not invoke Runtime calibration refresh.");
            runtime.RefreshCalibration();
            Assert.That(current.IsValid, Is.False);
        }
        finally { Object.DestroyImmediate(host); Object.DestroyImmediate(tracking); }
    }

    [Test]
    public void InvalidTrackingScaleInvalidatesCalibrationAndStopsInput()
    {
        var host = new GameObject("Runtime");
        var tracking = new GameObject("Tracking");
        try
        {
            var calibration = new PresentationCalibrationState();
            Assert.That(calibration.TrySet(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _), Is.True);
            var runtime = host.AddComponent<PresentationBakedRuntime>();
            runtime.ConfigureCalibration(calibration, tracking.transform);
            tracking.transform.localScale = new Vector3(2, 1, 1);
            runtime.RefreshCalibration();
            Assert.That(calibration.IsValid, Is.False);
            Assert.That(runtime.CalibrationReady, Is.False);
            Assert.That(runtime.CanSendInput || runtime.CanSendTracking, Is.False);
            tracking.transform.localScale = Vector3.one;
            runtime.RefreshCalibration();
            Assert.That(runtime.CalibrationReady, Is.False, "Restoring tracking must not silently recalibrate.");
        }
        finally { Object.DestroyImmediate(host); Object.DestroyImmediate(tracking); }
    }
}

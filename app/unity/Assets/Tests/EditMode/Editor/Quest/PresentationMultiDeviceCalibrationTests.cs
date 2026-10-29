using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using Object = UnityEngine.Object;

public sealed class PresentationMultiDeviceCalibrationTests
{
    [Test]
    public void IndependentTrackingFramesPlaceTheSamePresentationPointRelativeToEachMarker()
    {
        var firstHost = new GameObject("Presenter device");
        var secondHost = new GameObject("Viewer device");
        var firstTracking = new GameObject("Presenter tracking");
        var secondTracking = new GameObject("Viewer tracking");
        try
        {
            firstTracking.transform.SetPositionAndRotation(new Vector3(2, .5f, 1), Quaternion.Euler(0, 25, 0));
            secondTracking.transform.SetPositionAndRotation(new Vector3(-3, 1, 2), Quaternion.Euler(0, -60, 0));
            var firstMarker = new Pose(new Vector3(1, .25f, 3), Quaternion.Euler(0, 10, 0));
            var secondMarker = new Pose(new Vector3(-2, .75f, 4), Quaternion.Euler(0, 75, 0));
            var firstCalibration = Calibrate(firstMarker, firstTracking.transform);
            var secondCalibration = Calibrate(secondMarker, secondTracking.transform);
            Assert.That(firstCalibration.PresentationFromQuestLocal, Is.Not.EqualTo(secondCalibration.PresentationFromQuestLocal));
            var first = firstHost.AddComponent<PresentationBakedRuntime>();
            var second = secondHost.AddComponent<PresentationBakedRuntime>();
            first.ConfigureCalibration(firstCalibration, firstTracking.transform);
            second.ConfigureCalibration(secondCalibration, secondTracking.transform);
            first.RefreshCalibration();
            second.RefreshCalibration();
            var sharedPoint = new Unframe.Presentation.Vector3 { X = .25, Y = .4, Z = -.5 };
            Assert.That(PresentationCoordinateAdapter.TryToUnityPosition(sharedPoint, out Vector3 localPoint), Is.True);
            Vector3 firstWorld = first.PresentationSpace.TransformPoint(localPoint);
            Vector3 secondWorld = second.PresentationSpace.TransformPoint(localPoint);
            Assert.That(Vector3.Distance(firstWorld, firstMarker.position + firstMarker.rotation * localPoint), Is.LessThan(.00001f));
            Assert.That(Vector3.Distance(secondWorld, secondMarker.position + secondMarker.rotation * localPoint), Is.LessThan(.00001f));
            Assert.That(first.CanSendInput || first.CanSendTracking || second.CanSendInput || second.CanSendTracking, Is.False,
                "Calibration alone must not make either disconnected device an active participant.");
        }
        finally
        {
            Object.DestroyImmediate(firstHost);
            Object.DestroyImmediate(secondHost);
            Object.DestroyImmediate(firstTracking);
            Object.DestroyImmediate(secondTracking);
        }
    }

    [Test]
    public void OneDeviceLosingCalibrationDoesNotInvalidateTheOtherDevice()
    {
        var firstHost = new GameObject("First device");
        var secondHost = new GameObject("Second device");
        try
        {
            var firstCalibration = Calibrate(Pose.identity, firstHost.transform);
            var secondCalibration = Calibrate(new Pose(Vector3.forward, Quaternion.Euler(0, 35, 0)), secondHost.transform);
            var first = firstHost.AddComponent<PresentationBakedRuntime>();
            var second = secondHost.AddComponent<PresentationBakedRuntime>();
            first.ConfigureCalibration(firstCalibration, firstHost.transform);
            second.ConfigureCalibration(secondCalibration, secondHost.transform);
            first.RefreshCalibration();
            second.RefreshCalibration();
            ulong retainedRevision = secondCalibration.Revision;
            Vector3 retainedPosition = second.PresentationSpace.position;
            Quaternion retainedRotation = second.PresentationSpace.rotation;
            firstCalibration.Invalidate("first-device-tracking-lost");
            Assert.That(first.CalibrationReady, Is.False);
            Assert.That(first.PresentationSpace.gameObject.activeSelf, Is.False);
            Assert.That(second.CalibrationReady, Is.True);
            Assert.That(secondCalibration.IsValid, Is.True);
            Assert.That(secondCalibration.Revision, Is.EqualTo(retainedRevision));
            Assert.That(second.PresentationSpace.position, Is.EqualTo(retainedPosition));
            Assert.That(second.PresentationSpace.rotation, Is.EqualTo(retainedRotation));
        }
        finally
        {
            Object.DestroyImmediate(firstHost);
            Object.DestroyImmediate(secondHost);
        }
    }

    private static PresentationCalibrationState Calibrate(Pose marker, Transform tracking)
    {
        Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(marker, tracking, out var pose, out string error), Is.True, error);
        var calibration = new PresentationCalibrationState();
        Assert.That(calibration.TrySet(pose, out error), Is.True, error);
        return calibration;
    }
}

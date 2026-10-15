using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using ProtoPose = Unframe.Presentation.Pose;

public sealed class PresentationCalibrationTests
{
    [Test]
    public void StateClonesInputAndOutputAndDoesNotReviseIdenticalCalibration()
    {
        var state = new PresentationCalibrationState();
        int changes = 0;
        state.Changed += () => changes++;
        ProtoPose pose = QuestPresentationTracking.ToCanonicalPose(new Vector3(1, 2, 3), Quaternion.identity);
        Assert.That(state.TrySet(pose, out _), Is.True);
        Assert.That(state.TrySet(pose.Clone(), out _), Is.True);
        pose.Position.X = 9;
        ProtoPose read = state.PresentationFromQuestLocal;
        read.Position.X = 8;
        Assert.That(state.PresentationFromQuestLocal.Position.X, Is.EqualTo(1));
        Assert.That(state.Revision, Is.EqualTo(1));
        Assert.That(changes, Is.EqualTo(1));
    }

    [Test]
    public void InvalidWirePoseCannotReplaceAConfirmedCalibration()
    {
        var state = new PresentationCalibrationState();
        ProtoPose pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity);
        Assert.That(state.TrySet(pose, out _), Is.True);
        pose.Rotation.W = -1;
        Assert.That(state.TrySet(pose, out string error), Is.False);
        Assert.That(error, Is.Not.Empty);
        Assert.That(state.IsValid, Is.True);
        Assert.That(state.Revision, Is.EqualTo(1));
        pose.Rotation.W = 1;
        pose.Position.X = System.BitConverter.Int64BitsToDouble(long.MinValue);
        Assert.That(state.TrySet(pose, out _), Is.False);
        pose.Position.X = double.NaN;
        Assert.That(state.TrySet(pose, out _), Is.False);
    }

    [Test]
    public void InvalidationRemovesPoseAndRepeatedIdenticalInvalidationIsIdempotent()
    {
        var state = new PresentationCalibrationState();
        state.TrySet(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _);
        state.Invalidate("tracking-lost");
        state.Invalidate("tracking-lost");
        Assert.That(state.IsValid, Is.False);
        Assert.That(state.PresentationFromQuestLocal, Is.Null);
        Assert.That(state.Reason, Is.EqualTo("tracking-lost"));
        Assert.That(state.Revision, Is.EqualTo(2));
    }

    [Test]
    public void WorldCalibrationRoundTripsWithTranslatedRotatedTrackingOrigin()
    {
        var root = new GameObject("Quest tracking space");
        try
        {
            root.transform.SetPositionAndRotation(new Vector3(4, 1, -3), Quaternion.Euler(0, 55, 0));
            var marker = new Pose(new Vector3(-2, 0.7f, 5), Quaternion.Euler(8, -32, 3));
            Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(marker, root.transform, out ProtoPose calibration, out _), Is.True);
            Vector3 point = new Vector3(0.3f, 1.2f, -0.4f);
            Assert.That(PresentationCoordinateAdapter.TryToUnityPose(calibration, out Pose canonical), Is.True);
            Vector3 expected = Quaternion.Inverse(marker.rotation) * (root.transform.TransformPoint(point) - marker.position);
            Assert.That(Vector3.Distance(canonical.position + canonical.rotation * point, expected), Is.LessThan(0.00001f));
            Assert.That(PresentationCalibrationMath.TryWorldFromPresentation(calibration, root.transform, out Pose recovered, out _), Is.True);
            Assert.That(Vector3.Distance(recovered.position, marker.position), Is.LessThan(0.00001f));
            Assert.That(Quaternion.Angle(recovered.rotation, marker.rotation), Is.LessThan(0.02f));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void TrackingOriginRejectsScaledAncestorsEvenIfLossyScaleCancels()
    {
        var parent = new GameObject("Parent");
        var root = new GameObject("Quest tracking space");
        try
        {
            root.transform.SetParent(parent.transform, false);
            parent.transform.localScale = Vector3.one * 2;
            root.transform.localScale = Vector3.one * 0.5f;
            Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(Pose.identity, root.transform, out _, out _), Is.False);
            Assert.That(PresentationCalibrationMath.TryWorldFromPresentation(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), root.transform, out _, out _), Is.False);
        }
        finally { Object.DestroyImmediate(parent); }
    }

    [Test]
    public void MathRejectsMissingTrackingOriginAndNonFiniteOrNonUnitWorldPose()
    {
        Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(Pose.identity, null, out _, out _), Is.False);
        var root = new GameObject("Quest tracking space");
        try
        {
            Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(new Pose(new Vector3(float.NaN, 0, 0), Quaternion.identity), root.transform, out _, out _), Is.False);
            Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(new Pose(Vector3.zero, new Quaternion(0, 0, 0, 2)), root.transform, out _, out _), Is.False);
            Assert.That(PresentationCalibrationMath.TryWorldFromPresentation(null, root.transform, out _, out _), Is.False);
        }
        finally { Object.DestroyImmediate(root); }
    }
}

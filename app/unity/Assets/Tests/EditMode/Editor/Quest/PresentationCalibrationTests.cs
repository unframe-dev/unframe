using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using ProtoPose = Unframe.Presentation.Pose;

public sealed class PresentationCalibrationTests
{
    [TestCase(0f)]
    [TestCase(1.4f)]
    [TestCase(1.8f)]
    [TestCase(2.5f)]
    public void PresenterHeightUsesWorldVerticalAndPreservesHorizontalPositionAndRotation(float markerHeight)
    {
        var marker = new Pose(new Vector3(3, markerHeight, -4), Quaternion.Euler(32, 47, 18));
        var original = QuestPresentationTracking.ToCanonicalPose(new Vector3(0.6f, 0.2f, -0.4f), Quaternion.Euler(12, 25, 3));
        Assert.That(PresentationCalibrationMath.TryPresenterOrigin(marker, 1.8f, original, out ProtoPose corrected), Is.True);
        Assert.That(PresentationCoordinateAdapter.TryToUnityPose(original, out Pose before), Is.True);
        Assert.That(PresentationCoordinateAdapter.TryToUnityPose(corrected, out Pose after), Is.True);
        Vector3 oldWorld = marker.position + marker.rotation * before.position;
        Vector3 world = marker.position + marker.rotation * after.position;
        Assert.That(world.y, Is.EqualTo(1.5f).Within(0.00001f));
        Assert.That(world.x, Is.EqualTo(oldWorld.x).Within(0.00001f));
        Assert.That(world.z, Is.EqualTo(oldWorld.z).Within(0.00001f));
        Assert.That(corrected.Rotation, Is.EqualTo(original.Rotation));
        Assert.That(PresentationCalibrationMath.TryPresenterOrigin(marker, 1.8f, corrected, out ProtoPose repeated), Is.True);
        Assert.That(PresentationCoordinateAdapter.TryToUnityPose(repeated, out Pose repeatedPose), Is.True);
        Assert.That(Vector3.Distance(repeatedPose.position, after.position), Is.LessThan(0.00001f));
    }

    [Test]
    public void PlacementRetainsConfirmationSampleAcrossConnectionDelayAndRetries()
    {
        var state = new PresenterOriginPlacement();
        state.Capture(Pose.identity, 1.8f);
        state.BeginSession("session-a");
        state.Capture(new Pose(Vector3.up, Quaternion.identity), 2.2f);
        var origin = new Unframe.Realtime.PresentationOrigin { Pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity) };
        var command = state.Prepare(origin, 4);
        Assert.That(command.PresentationOrigin.Pose.Position.Y, Is.EqualTo(1.5f).Within(0.00001f));
        Assert.That(command.PresentationOrigin.ExpectedPresentationOriginVersion, Is.Zero);
        Assert.That(state.IsConfirmed, Is.False);
        command.PresentationOrigin.Pose.Position.Y = 9;
        var retry = state.Prepare(origin, 5);
        Assert.That(retry.PresentationOrigin.ClientEventId, Is.EqualTo(command.PresentationOrigin.ClientEventId));
        Assert.That(retry.PresentationOrigin.CommandEpoch, Is.EqualTo(4));
        Assert.That(retry.PresentationOrigin.Pose.Position.Y, Is.EqualTo(1.5f).Within(0.00001f));
        var accepted = new Unframe.Realtime.CommandOutcome
        {
            ClientEventId = command.PresentationOrigin.ClientEventId,
            Accepted = new Unframe.Realtime.CommandAccepted { ReliableSequence = 8 }
        };
        Assert.That(state.Confirm(accepted, 7, 1, 5, true), Is.False);
        Assert.That(state.Confirm(accepted, 8, 0, 5, true), Is.False);
        Assert.That(state.Confirm(accepted, 8, 1, 3, true), Is.False);
        Assert.That(state.Confirm(accepted, 8, 1, 5, false), Is.False);
        Assert.That(state.Confirm(accepted, 10, 3, 7, true), Is.True);
        state.Capture(Pose.identity, 2.5f);
        Assert.That(state.IsConfirmed, Is.True);
        Assert.That(state.Prepare(origin, 5), Is.Null);
    }

    [Test]
    public void PlacementCompletesAfterOriginAndSynchronizationApplyWithoutRotatingCommandEpoch()
    {
        var state = new PresenterOriginPlacement();
        state.Capture(Pose.identity, 1.8f);
        var origin = new Unframe.Realtime.PresentationOrigin { Pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity) };
        var command = state.Prepare(origin, 4);
        var outcome = new Unframe.Realtime.CommandOutcome
        {
            ClientEventId = command.PresentationOrigin.ClientEventId,
            Accepted = new Unframe.Realtime.CommandAccepted { ReliableSequence = 8 }
        };
        Assert.That(state.Confirm(outcome, 8, 1, 4, true), Is.True);
        Assert.That(state.IsConfirmed, Is.True);
    }

    [Test]
    public void ExistingSharedOriginRequiresExplicitPlacementInsteadOfAutomaticRecalculation()
    {
        var state = new PresenterOriginPlacement();
        state.Capture(Pose.identity, 1.8f);
        var origin = new Unframe.Realtime.PresentationOrigin { Version = 3, Pose = QuestPresentationTracking.ToCanonicalPose(new Vector3(1, 2, 3), Quaternion.identity) };
        Assert.That(state.Prepare(origin, 4), Is.Null);
        Assert.That(state.IsConfirmed, Is.True);
        state.RequestPlacement();
        Assert.That(state.Prepare(origin, 4), Is.Null);
        state.Capture(Pose.identity, 2.1f);
        var command = state.Prepare(origin, 4).PresentationOrigin;
        Assert.That(command.ExpectedPresentationOriginVersion, Is.EqualTo(3));
        Assert.That(command.Pose.Position.X, Is.EqualTo(1));
        Assert.That(command.Pose.Position.Y, Is.EqualTo(1.8f).Within(0.00001f));
        Assert.That(command.Pose.Position.Z, Is.EqualTo(-3));
        Assert.That(state.IsConfirmed, Is.False);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void RejectedOriginCommandRequiresFreshMeasurementBeforeUsingTheLatestVersion(bool explicitPlacement)
    {
        var state = new PresenterOriginPlacement();
        if (explicitPlacement) state.RequestPlacement();
        state.Capture(Pose.identity, 1.8f);
        var origin = new Unframe.Realtime.PresentationOrigin { Version = explicitPlacement ? 2ul : 0ul, Pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity) };
        var old = state.Prepare(origin, 4);
        Assert.That(state.Reject(old.PresentationOrigin.ClientEventId), Is.True);
        origin.Version = 3;
        Assert.That(state.Prepare(origin, 4), Is.Null);
        state.Capture(Pose.identity, 2.4f);
        var retry = state.Prepare(origin, 4);
        Assert.That(retry.PresentationOrigin.ExpectedPresentationOriginVersion, Is.EqualTo(3));
        Assert.That(retry.PresentationOrigin.ClientEventId, Is.Not.EqualTo(old.PresentationOrigin.ClientEventId));
        Assert.That(retry.PresentationOrigin.Pose.Position.Y, Is.EqualTo(2.1f).Within(0.00001f));
        Assert.That(state.IsConfirmed, Is.False);
    }

    [Test]
    public void SwitchingSessionsRequiresANewMarkerConfirmationAndDiscardsPriorExplicitIntent()
    {
        var state = new PresenterOriginPlacement();
        state.BeginSession("a");
        state.RequestPlacement();
        state.Capture(Pose.identity, 1.8f);
        var initial = new Unframe.Realtime.PresentationOrigin { Pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity) };
        var old = state.Prepare(initial, 4);
        Assert.That(state.BeginSession("b"), Is.True);
        Assert.That(state.Prepare(initial, 4), Is.Null);
        Assert.That(state.Confirm(new Unframe.Realtime.CommandOutcome { ClientEventId = old.PresentationOrigin.ClientEventId, Accepted = new Unframe.Realtime.CommandAccepted { ReliableSequence = 1 } }, 1, 1, 5, true), Is.False);
        state.Capture(Pose.identity, 2.2f);
        Assert.That(state.Prepare(initial, 4).PresentationOrigin.Pose.Position.Y, Is.EqualTo(1.9f).Within(0.00001f));
        state.BeginSession("c");
        state.Capture(Pose.identity, 2.4f);
        initial.Version = 3;
        Assert.That(state.Prepare(initial, 4), Is.Null);
        Assert.That(state.IsConfirmed, Is.True);
    }

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

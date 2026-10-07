using NUnit.Framework;
using UnityEngine;

public sealed class ArucoOriginStabilityEditModeTests
{
    [Test]
    public void ConfirmsOnlyAfterEightSamplesAndOneContinuousSecond()
    {
        var state = new ArucoOriginStability();
        for (int i = 0; i < 7; i++) state.Observe(Pose.identity, i + 1, i * 0.15);
        Assert.That(state.IsConfirmed, Is.False);
        state.Observe(Pose.identity, 8, 1.05);
        Assert.That(state.IsConfirmed, Is.True);
        Assert.That(state.SampleCount, Is.EqualTo(8));

        state.Reset();
        for (int i = 0; i < 8; i++) state.Observe(Pose.identity, i + 1, i * 0.1);
        Assert.That(state.IsConfirmed, Is.False);
        state.Observe(Pose.identity, 9, 1);
        Assert.That(state.IsConfirmed, Is.True);
    }

    [Test]
    public void AveragesPositionAndQuaternionWithoutHemisphereCancellation()
    {
        var state = new ArucoOriginStability();
        Quaternion rotation = Quaternion.Euler(0, 45, 0);
        Quaternion opposite = new Quaternion(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
        state.Observe(new Pose(Vector3.zero, rotation), 1, 0);
        state.Observe(new Pose(new Vector3(0.01f, 0, 0), opposite), 2, 0.2);
        Assert.That(state.Pose.position.x, Is.EqualTo(0.005f).Within(0.00001f));
        Assert.That(Quaternion.Angle(state.Pose.rotation, rotation), Is.LessThan(0.001f));
    }

    [TestCase(0.0201f, 0)]
    [TestCase(0, 3.1f)]
    public void MovementOutsideToleranceStartsANewWindow(float distance, float angle)
    {
        var state = new ArucoOriginStability();
        state.Observe(Pose.identity, 1, 0);
        var moved = new Pose(new Vector3(distance, 0, 0), Quaternion.Euler(0, angle, 0));
        state.Observe(moved, 2, 0.2);
        Assert.That(state.SampleCount, Is.EqualTo(1));
        Assert.That(state.StableDurationSeconds, Is.Zero);
        Assert.That(state.Pose.position, Is.EqualTo(moved.position));
    }

    [Test]
    public void SlowDriftCannotExtendTheWindowIndefinitely()
    {
        var state = new ArucoOriginStability();
        for (int i = 0; i < 8; i++)
            state.Observe(new Pose(new Vector3(i * 0.005f, 0, 0), Quaternion.identity), i + 1, i * 0.15);
        Assert.That(state.IsConfirmed, Is.False);
        Assert.That(state.SampleCount, Is.LessThan(8));
    }

    [Test]
    public void EverySampleMustRemainWithinToleranceOfTheAverage()
    {
        var state = new ArucoOriginStability();
        state.Observe(Pose.identity, 1, 0);
        state.Observe(new Pose(new Vector3(0.019f, 0, 0), Quaternion.identity), 2, 0.1);
        state.Observe(new Pose(new Vector3(0.019f, 0, 0), Quaternion.identity), 3, 0.2);
        state.Observe(new Pose(new Vector3(-0.019f, 0, 0), Quaternion.identity), 4, 0.3);
        Assert.That(state.SampleCount, Is.EqualTo(1));
    }

    [Test]
    public void GapAtTheLimitKeepsTheWindow()
    {
        var state = new ArucoOriginStability();
        state.Observe(Pose.identity, 1, 0);
        state.Observe(Pose.identity, 2, 0.5);
        Assert.That(state.SampleCount, Is.EqualTo(2));
    }

    [Test]
    public void LongObservationGapMissingMarkerAndInvalidQualityResetTheWindow()
    {
        var state = new ArucoOriginStability();
        state.Observe(Pose.identity, 1, 0);
        state.Observe(Pose.identity, 2, 0.501);
        Assert.That(state.SampleCount, Is.EqualTo(1));
        state.ObserveMissing(0.6);
        Assert.That(state.SampleCount, Is.EqualTo(1));
        state.ObserveMissing(1.002);
        Assert.That(state.HasPose, Is.False);
        Assert.That(state.SampleCount, Is.Zero);
        state.Observe(Pose.identity, 3, 1.1);
        state.Observe(Pose.identity, 4, 1.2, false);
        Assert.That(state.SampleCount, Is.EqualTo(1));
        state.Observe(Pose.identity, 5, 1.601, false);
        Assert.That(state.SampleCount, Is.Zero);
        Assert.That(state.HasPose, Is.False);
    }

    [Test]
    public void ShortAmbiguousFramesDoNotDiscardStableValidObservations()
    {
        var state = new ArucoOriginStability();
        long timestamp = 0;
        foreach (double now in new[] { 0d, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8 })
        {
            bool valid = now != 0.4 && now != 1.2;
            state.Observe(valid ? Pose.identity : new Pose(Vector3.one, Quaternion.Euler(90, 0, 0)),
                ++timestamp, now, valid);
        }
        Assert.That(state.IsConfirmed, Is.True);
        Assert.That(state.SampleCount, Is.EqualTo(8));
        Assert.That(state.Pose.position, Is.EqualTo(Vector3.zero));
        Assert.That(Quaternion.Angle(state.Pose.rotation, Quaternion.identity), Is.LessThan(0.001));
    }

    [Test]
    public void InvalidFramesCannotCountTowardConfirmationOrExtendTheObservationGap()
    {
        var state = new ArucoOriginStability();
        for (int i = 0; i < 7; i++) state.Observe(Pose.identity, i + 1, i * 0.2);
        state.Observe(Pose.identity, 8, 1.4, false);
        Assert.That(state.SampleCount, Is.EqualTo(7));
        Assert.That(state.IsConfirmed, Is.False);
        state.Observe(Pose.identity, 9, 1.6, false);
        state.Observe(Pose.identity, 10, 1.701, false);
        Assert.That(state.SampleCount, Is.Zero);
        Assert.That(state.IsConfirmed, Is.False);
    }

    [Test]
    public void DuplicateOrOlderTimestampDoesNotCountAsANewObservation()
    {
        var state = new ArucoOriginStability();
        Assert.That(state.Observe(Pose.identity, 10, 0), Is.True);
        Assert.That(state.Observe(Pose.identity, 10, 0.2), Is.False);
        Assert.That(state.Observe(Pose.identity, 9, 0.3), Is.False);
        Assert.That(state.SampleCount, Is.EqualTo(1));
        Assert.That(state.StableDurationSeconds, Is.Zero);
    }

    [Test]
    public void InvalidPoseAndTimeCannotEstablishAnOrigin()
    {
        var state = new ArucoOriginStability();
        Assert.That(state.Observe(new Pose(new Vector3(float.NaN, 0, 0), Quaternion.identity), 1, 0), Is.False);
        Assert.That(state.Observe(new Pose(Vector3.zero, new Quaternion(0, 0, 0, 0)), 2, 0.1), Is.False);
        Assert.That(state.Observe(Pose.identity, 3, double.NaN), Is.False);
        Assert.That(state.HasPose, Is.False);
    }

    [Test]
    public void ConfirmedOriginIsFixedUntilExplicitReset()
    {
        var state = new ArucoOriginStability();
        for (int i = 0; i < 8; i++) state.Observe(Pose.identity, i + 1, i * 0.15);
        var moved = new Pose(Vector3.one, Quaternion.Euler(0, 90, 0));
        state.Observe(moved, 9, 2);
        state.ObserveMissing(3);
        Assert.That(state.IsConfirmed, Is.True);
        Assert.That(state.Pose.position, Is.EqualTo(Vector3.zero));
        Assert.That(Quaternion.Angle(state.Pose.rotation, Quaternion.identity), Is.LessThan(0.001f));
        state.Reset();
        Assert.That(state.IsConfirmed, Is.False);
        Assert.That(state.HasPose, Is.False);
        Assert.That(state.Observe(moved, 1, 0), Is.True);
        Assert.That(state.Pose.position, Is.EqualTo(Vector3.one));
    }
}

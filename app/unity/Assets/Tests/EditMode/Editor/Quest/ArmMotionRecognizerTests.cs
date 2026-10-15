using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class ArmMotionRecognizerTests
{
    private static ArmMotionFrame Frame(Vector3 left, Vector3 right, Vector3 head = default,
        bool leftAvailable = true, bool rightAvailable = true, Quaternion rotation = default)
    {
        if (rotation.Equals(default(Quaternion))) rotation = Quaternion.identity;
        return new ArmMotionFrame(head, rotation, true, left + head, leftAvailable, right + head, rightAvailable);
    }

    private static ArmMotionRecognizer Armed(ArmMotionPreset preset, Vector3 left = default, Vector3 right = default)
    {
        var recognizer = new ArmMotionRecognizer();
        recognizer.Configure(preset);
        Assert.That(recognizer.Start(0.25, Frame(left, right)), Is.True);
        return recognizer;
    }

    [Test]
    public void StartRequiresTrackingAndPinsTheInitialPosition()
    {
        var recognizer = new ArmMotionRecognizer();
        recognizer.Configure(ArmMotionPreset.SwipeRight);
        Assert.That(recognizer.Observe(0, Frame(Vector3.zero, Vector3.zero)), Is.False);
        Assert.That(recognizer.Diagnostics.Phase, Is.EqualTo(ArmMotionPhase.WaitingTrigger));
        Assert.That(recognizer.Start(0.1, new ArmMotionFrame(Vector3.zero, Quaternion.identity, false,
            Vector3.zero, true, Vector3.zero, true)), Is.False);
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.HeadTrackingUnavailable));
        recognizer.Reset();
        Assert.That(recognizer.Start(0.35, Frame(Vector3.right, Vector3.zero)), Is.True);
        Assert.That(recognizer.Diagnostics.Phase, Is.EqualTo(ArmMotionPhase.Ready));
        recognizer.Observe(0.45, Frame(Vector3.right, Vector3.zero));
        Assert.That(recognizer.Start(0.5, Frame(Vector3.right * 1.1f, Vector3.zero)), Is.False);
        recognizer.Observe(0.55, Frame(new Vector3(1.1f, 0.02f, 0), Vector3.zero));
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.DistanceTooSmall));
        Assert.That(recognizer.Diagnostics.LeftDistanceMeters, Is.EqualTo(0.1f).Within(0.001));
        Assert.That(recognizer.Diagnostics.LeftOffAxisMeters, Is.EqualTo(0.02f).Within(0.001));
        Assert.That(recognizer.Diagnostics.LeftSpeedMetersPerSecond, Is.EqualTo(0.5f).Within(0.001));
        Assert.That(recognizer.Observe(0.65, Frame(Vector3.right * 1.32f, Vector3.zero)), Is.True);
        Assert.That(recognizer.Diagnostics.Phase, Is.EqualTo(ArmMotionPhase.Matched));
    }

    [Test]
    public void DiagnosticsExposeResetReasonAndBothHandDistances()
    {
        var recognizer = Armed(ArmMotionPreset.SpreadHands, Vector3.left * 0.1f, Vector3.right * 0.1f);
        recognizer.Observe(0.55, Frame(Vector3.left * 0.3f, Vector3.right * 0.3f));
        Assert.That(recognizer.Diagnostics.InitialSpanMeters, Is.EqualTo(0.2f).Within(0.001));
        Assert.That(recognizer.Diagnostics.CurrentSpanMeters, Is.EqualTo(0.6f).Within(0.001));
        Assert.That(recognizer.Diagnostics.LeftRadialDistanceMeters, Is.EqualTo(0.2f).Within(0.001));
        Assert.That(recognizer.Diagnostics.RightRadialDistanceMeters, Is.EqualTo(0.2f).Within(0.001));
        recognizer.Reset();
        recognizer.Start(0.6, Frame(Vector3.left * 0.1f, Vector3.right * 0.1f));
        recognizer.Observe(1.2, Frame(Vector3.left * 0.3f, Vector3.right * 0.3f));
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.FrameGap));
        recognizer.Reset();
        recognizer.Start(double.NaN, Frame(Vector3.zero, Vector3.zero));
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.InvalidTimestamp));
    }

    [Test]
    public void DiagnosticsKeepGestureHeadingAndExposeWindowExpiry()
    {
        var recognizer = new ArmMotionRecognizer();
        recognizer.Configure(ArmMotionPreset.PushForward, 0.5f, 0.4);
        var heading = Quaternion.Euler(0, 90, 0);
        recognizer.Start(0.25, Frame(Vector3.zero, Vector3.zero, rotation: heading));
        recognizer.Observe(0.55, Frame(Vector3.right * 0.32f, Vector3.zero));
        Assert.That(recognizer.Diagnostics.LeftDisplacement.z, Is.EqualTo(0.32f).Within(0.001));
        Assert.That(recognizer.Diagnostics.LeftFrameSpeedMetersPerSecond, Is.EqualTo(0.32f / 0.3f).Within(0.001));
        recognizer.Observe(0.75, Frame(Vector3.right * 0.6f, Vector3.zero));
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.WindowExpired));
        Assert.That(recognizer.Start(0.8, Frame(Vector3.zero, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(0.9, Frame(Vector3.right, Vector3.zero)), Is.False);
        Assert.That(recognizer.Diagnostics.WindowElapsedSeconds, Is.EqualTo(0.5).Within(0.001));
        Assert.That(recognizer.Diagnostics.MinimumDistanceMeters, Is.EqualTo(0.5f));
        Assert.That(recognizer.Diagnostics.WindowSeconds, Is.EqualTo(0.4));
    }

    [TestCase(ArmMotionPreset.SwipeLeft, -1, 0, 0)]
    [TestCase(ArmMotionPreset.SwipeRight, 1, 0, 0)]
    [TestCase(ArmMotionPreset.SwipeDown, 0, -1, 0)]
    [TestCase(ArmMotionPreset.SwipeUp, 0, 1, 0)]
    [TestCase(ArmMotionPreset.PushForward, 0, 0, 1)]
    [TestCase(ArmMotionPreset.PullBackward, 0, 0, -1)]
    public void EitherHandCanPerformTheSelectedDirection(ArmMotionPreset preset, float x, float y, float z)
    {
        Vector3 motion = new Vector3(x, y, z) * 0.32f;
        Assert.That(Armed(preset).Observe(0.55, Frame(motion, Vector3.zero)), Is.True);
        Assert.That(Armed(preset).Observe(0.55, Frame(Vector3.zero, motion)), Is.True);
        Assert.That(Armed(preset).Observe(0.55, Frame(-motion, Vector3.zero)), Is.False);
    }

    [TestCase(ArmMotionPreset.SpreadHands, 0.1f, 0.3f)]
    [TestCase(ArmMotionPreset.CloseHands, 0.3f, 0.1f)]
    public void BothHandsMustMoveToChangeTheirSeparation(ArmMotionPreset preset, float from, float to)
    {
        var left = Vector3.left * from;
        var right = Vector3.right * from;
        Assert.That(Armed(preset, left, right).Observe(0.55,
            Frame(Vector3.left * to, Vector3.right * to)), Is.True);
        Assert.That(Armed(preset, left, right).Observe(0.55,
            Frame(Vector3.left * (2 * to - from), right)), Is.False);
        Assert.That(Armed(preset, left, right).Observe(0.55,
            Frame(Vector3.left * to, Vector3.right * to, rightAvailable: false)), Is.False);
    }

    [TestCase(ArmMotionPreset.SpreadHands)]
    [TestCase(ArmMotionPreset.CloseHands)]
    public void HandsCanChangeTheSeparationAxis(ArmMotionPreset preset)
    {
        Vector3 closeLeft = Vector3.down * 0.05f;
        Vector3 closeRight = Vector3.up * 0.05f;
        Vector3 wideLeft = Vector3.left * 0.35f;
        Vector3 wideRight = Vector3.right * 0.35f;
        bool spread = preset == ArmMotionPreset.SpreadHands;
        var recognizer = Armed(preset, spread ? closeLeft : wideLeft, spread ? closeRight : wideRight);
        Assert.That(recognizer.Observe(0.55,
            Frame(spread ? wideLeft : closeLeft, spread ? wideRight : closeRight)), Is.True);
    }

    [TestCase(ArmMotionPreset.SpreadHands, 0.30f, 0.41f)]
    [TestCase(ArmMotionPreset.CloseHands, 0.25f, 0.14f)]
    public void SeparationGestureUsesRelativeDistanceAtAnyStartingWidth(ArmMotionPreset preset, float from, float to)
    {
        var recognizer = Armed(preset, Vector3.left * from, Vector3.right * from);
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.left * to, Vector3.right * to)), Is.True);
        Assert.That(recognizer.Diagnostics.MinimumDistanceMeters, Is.EqualTo(0.20f));
        Assert.That(recognizer.Diagnostics.MinimumEachHandDistanceMeters, Is.EqualTo(0.04f));
        Assert.That(recognizer.Diagnostics.MinimumSpeedMetersPerSecond, Is.EqualTo(0.10f));
        Assert.That(recognizer.Diagnostics.WindowSeconds, Is.EqualTo(2.0));
    }

    [TestCase(ArmMotionPreset.SpreadHands, 1)]
    [TestCase(ArmMotionPreset.CloseHands, -1)]
    public void BothHandsMayMoveUnequalDistances(ArmMotionPreset preset, int sign)
    {
        var left = Vector3.left * 0.30f;
        var right = Vector3.right * 0.30f;
        Assert.That(Armed(preset, left, right).Observe(0.55,
            Frame(left + Vector3.left * (0.05f * sign), right + Vector3.right * (0.17f * sign))), Is.True);
    }

    [TestCase(ArmMotionPreset.SpreadHands, 1)]
    [TestCase(ArmMotionPreset.CloseHands, -1)]
    public void RelaxedSeparationStillRejectsOneHandJitterAndOppositeDirection(ArmMotionPreset preset, int sign)
    {
        var left = Vector3.left * 0.30f;
        var right = Vector3.right * 0.30f;
        Assert.That(Armed(preset, left, right).Observe(0.55,
            Frame(left + Vector3.left * (0.25f * sign), right)), Is.False);
        Assert.That(Armed(preset, left, right).Observe(0.55,
            Frame(left + Vector3.left * (0.22f * sign), right + Vector3.right * (0.02f * sign))), Is.False);
        Assert.That(Armed(preset, left, right).Observe(0.55,
            Frame(left - Vector3.left * (0.11f * sign), right - Vector3.right * (0.11f * sign))), Is.False);
    }

    [TestCase(ArmMotionPreset.SpreadHands, 1)]
    [TestCase(ArmMotionPreset.CloseHands, -1)]
    public void SeparationCanCompleteSlowlyWithinTwoSeconds(ArmMotionPreset preset, int sign)
    {
        var recognizer = Armed(preset, Vector3.left * 0.30f, Vector3.right * 0.30f);
        for (int sample = 1; sample <= 6; sample++)
        {
            float width = 0.30f + sign * 0.11f * sample / 6;
            Assert.That(recognizer.Observe(0.25 + sample * 0.30,
                Frame(Vector3.left * width, Vector3.right * width)), Is.EqualTo(sample == 6));
        }
    }

    [Test]
    public void SingleArmKeepsItsExistingSpeedAndWindow()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        Assert.That(recognizer.Diagnostics.MinimumSpeedMetersPerSecond, Is.EqualTo(0.25f));
        Assert.That(recognizer.Diagnostics.WindowSeconds, Is.EqualTo(1.20));
        recognizer.Observe(0.65, Frame(Vector3.right * 0.10f, Vector3.zero));
        recognizer.Observe(1.05, Frame(Vector3.right * 0.20f, Vector3.zero));
        Assert.That(recognizer.Observe(1.40, Frame(Vector3.right * 0.28f, Vector3.zero)), Is.False);
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.SpeedTooLow));
    }

    [Test]
    public void ConfiguredDistanceAndWindowGovernRecognition()
    {
        var recognizer = new ArmMotionRecognizer();
        recognizer.Configure(ArmMotionPreset.SwipeRight, 0.5f, 0.4);
        recognizer.Start(0.25, Frame(Vector3.zero, Vector3.zero));
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.right * 0.32f, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(0.75, Frame(Vector3.right * 0.6f, Vector3.zero)), Is.False);
        recognizer.Configure(ArmMotionPreset.SpreadHands, 0.5f, 1.2);
        recognizer.Start(1.25, Frame(Vector3.left * 0.1f, Vector3.right * 0.1f));
        Assert.That(recognizer.Observe(1.55, Frame(Vector3.left * 0.3f, Vector3.right * 0.3f)), Is.False);
        Assert.That(recognizer.Observe(1.65, Frame(Vector3.left * 0.4f, Vector3.right * 0.4f)), Is.True);
    }

    [Test]
    public void SmallSlowAndOffAxisMovementsDoNotTrigger()
    {
        Assert.That(Armed(ArmMotionPreset.SwipeRight).Observe(0.55,
            Frame(Vector3.right * 0.12f, Vector3.zero)), Is.False);
        Assert.That(Armed(ArmMotionPreset.SwipeRight).Observe(1.8,
            Frame(Vector3.right * 0.32f, Vector3.zero)), Is.False);
        Assert.That(Armed(ArmMotionPreset.SwipeRight).Observe(0.55,
            Frame(new Vector3(0.32f, 0.4f, 0), Vector3.zero)), Is.False);
    }

    [Test]
    public void OneTrackedHandIsEnoughForSingleArmGestures()
    {
        var recognizer = new ArmMotionRecognizer();
        recognizer.Configure(ArmMotionPreset.SwipeRight);
        recognizer.Start(0.25, Frame(Vector3.zero, Vector3.zero, leftAvailable: false));
        Assert.That(recognizer.Observe(0.55,
            Frame(Vector3.zero, Vector3.right * 0.32f, leftAvailable: false)), Is.True);
    }

    [Test]
    public void ASlowMovementAndMovementWithoutStartDoNotTrigger()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        recognizer.Observe(0.6, Frame(Vector3.right * 0.1f, Vector3.zero));
        recognizer.Observe(1.0, Frame(Vector3.right * 0.2f, Vector3.zero));
        Assert.That(recognizer.Observe(1.4,
            Frame(Vector3.right * 0.28f, Vector3.zero)), Is.False);
        recognizer = new ArmMotionRecognizer();
        recognizer.Configure(ArmMotionPreset.SwipeRight);
        recognizer.Observe(0, Frame(Vector3.zero, Vector3.zero));
        Assert.That(recognizer.Observe(0.3,
            Frame(Vector3.right * 0.32f, Vector3.zero)), Is.False);
    }

    [Test]
    public void WalkingAndTurningTheHeadDoNotCountAsAnArmMotion()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        Assert.That(recognizer.Observe(0.55,
            Frame(Vector3.zero, Vector3.zero, Vector3.right * 0.5f)), Is.False);
        Assert.That(recognizer.Observe(0.65, Frame(Vector3.zero, Vector3.zero,
            Vector3.right * 0.5f, rotation: Quaternion.Euler(0, 90, 0))), Is.False);
    }

    [Test]
    public void RecognitionUsesHeadingAtGestureStart()
    {
        var recognizer = new ArmMotionRecognizer();
        recognizer.Configure(ArmMotionPreset.PushForward);
        var heading = Quaternion.Euler(0, 90, 0);
        recognizer.Start(0.25, Frame(Vector3.zero, Vector3.zero, rotation: heading));
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.right * 0.32f, Vector3.zero,
            rotation: Quaternion.identity)), Is.True);
    }

    [Test]
    public void HoldingAfterOneGestureCannotRestartUntilReset()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        Vector3 position = Vector3.right * 0.32f;
        Assert.That(recognizer.Observe(0.55, Frame(position, Vector3.zero)), Is.True);
        Assert.That(recognizer.Observe(0.6, Frame(position, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(0.85, Frame(position, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(1.1, Frame(position * 2, Vector3.zero)), Is.False);
        Assert.That(recognizer.Start(1.2, Frame(position, Vector3.zero)), Is.False);
        recognizer.Reset();
        Assert.That(recognizer.Start(1.25, Frame(position, Vector3.zero)), Is.True);
        Assert.That(recognizer.Observe(1.55, Frame(position * 2, Vector3.zero)), Is.True);
    }

    [Test]
    public void WindowStartsAtPressAndDoesNotRefreshWhileStationary()
    {
        var recognizer = new ArmMotionRecognizer();
        recognizer.Configure(ArmMotionPreset.SwipeRight, 0.28f, 0.4);
        Assert.That(recognizer.Start(1, Frame(Vector3.zero, Vector3.zero)), Is.True);
        Assert.That(recognizer.Observe(1.3, Frame(Vector3.zero, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(1.45, Frame(Vector3.right * 0.32f, Vector3.zero)), Is.False);
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.WindowExpired));
        Assert.That(recognizer.Observe(1.5, Frame(Vector3.zero, Vector3.zero)), Is.False);
        Assert.That(recognizer.Start(1.6, Frame(Vector3.zero, Vector3.zero)), Is.False);
        recognizer.Reset();
        Assert.That(recognizer.Start(1.7, Frame(Vector3.zero, Vector3.zero)), Is.True);
        Assert.That(recognizer.Observe(1.9, Frame(Vector3.right * 0.32f, Vector3.zero)), Is.True);
    }

    [Test]
    public void TrackingRecoveryCannotRestartTheHeldGesture()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        recognizer.Observe(0.4, new ArmMotionFrame(Vector3.zero, Quaternion.identity, false,
            Vector3.zero, true, Vector3.zero, true));
        Assert.That(recognizer.Diagnostics.Phase, Is.EqualTo(ArmMotionPhase.Failed));
        Assert.That(recognizer.Start(0.5, Frame(Vector3.zero, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(0.6, Frame(Vector3.right * 0.32f, Vector3.zero)), Is.False);
        Assert.That(recognizer.Diagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.HeadTrackingUnavailable));
    }

    [Test]
    public void TrackingLossAndInvalidClockDiscardThePendingMotion()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        recognizer.Observe(0.4, Frame(Vector3.right * 0.1f, Vector3.zero));
        recognizer.Observe(0.45, Frame(Vector3.zero, Vector3.zero, leftAvailable: false));
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.right * 0.4f, Vector3.zero)), Is.False);
        recognizer = Armed(ArmMotionPreset.SwipeRight);
        Assert.That(recognizer.Observe(double.NaN, Frame(Vector3.right * 0.4f, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(0.1, Frame(Vector3.right * 0.4f, Vector3.zero)), Is.False);
    }

    [Test]
    public void NonFiniteTrackingAndPresetChangeRequireFreshStart()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        recognizer.Observe(0.4, Frame(new Vector3(float.NaN, 0, 0), Vector3.zero));
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.right * 0.4f, Vector3.zero)), Is.False);
        recognizer = Armed(ArmMotionPreset.SwipeRight);
        recognizer.Configure(ArmMotionPreset.PushForward);
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.forward * 0.4f, Vector3.zero)), Is.False);
    }
}

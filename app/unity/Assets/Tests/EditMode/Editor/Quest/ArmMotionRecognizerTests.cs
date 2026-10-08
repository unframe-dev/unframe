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
        recognizer.Observe(0, Frame(left, right));
        recognizer.Observe(0.25, Frame(left, right));
        return recognizer;
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

    [TestCase(ArmMotionPreset.SpreadHands, 0.4f, 0.6f)]
    [TestCase(ArmMotionPreset.CloseHands, 0.25f, 0.05f)]
    public void SeparationGestureMustCrossBetweenCloseAndWide(ArmMotionPreset preset, float from, float to)
    {
        Assert.That(Armed(preset, Vector3.left * from, Vector3.right * from).Observe(0.55,
            Frame(Vector3.left * to, Vector3.right * to)), Is.False);
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
        recognizer.Observe(0, Frame(Vector3.zero, Vector3.zero, leftAvailable: false));
        recognizer.Observe(0.25, Frame(Vector3.zero, Vector3.zero, leftAvailable: false));
        Assert.That(recognizer.Observe(0.55,
            Frame(Vector3.zero, Vector3.right * 0.32f, leftAvailable: false)), Is.True);
    }

    [Test]
    public void ASlowMovementAndMovementWithoutInitialRestDoNotTrigger()
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
        recognizer.Observe(0, Frame(Vector3.zero, Vector3.zero, rotation: heading));
        recognizer.Observe(0.25, Frame(Vector3.zero, Vector3.zero, rotation: heading));
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.right * 0.32f, Vector3.zero,
            rotation: Quaternion.identity)), Is.True);
    }

    [Test]
    public void HoldingAfterOneGestureDoesNotRepeatAndRestAllowsAnotherGesture()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        Vector3 position = Vector3.right * 0.32f;
        Assert.That(recognizer.Observe(0.55, Frame(position, Vector3.zero)), Is.True);
        Assert.That(recognizer.Observe(0.6, Frame(position, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(0.85, Frame(position, Vector3.zero)), Is.False);
        Assert.That(recognizer.Observe(1.1, Frame(position * 2, Vector3.zero)), Is.True);
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
    public void NonFiniteTrackingAndPresetChangeRequireFreshRest()
    {
        var recognizer = Armed(ArmMotionPreset.SwipeRight);
        recognizer.Observe(0.4, Frame(new Vector3(float.NaN, 0, 0), Vector3.zero));
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.right * 0.4f, Vector3.zero)), Is.False);
        recognizer = Armed(ArmMotionPreset.SwipeRight);
        recognizer.Configure(ArmMotionPreset.PushForward);
        Assert.That(recognizer.Observe(0.55, Frame(Vector3.forward * 0.4f, Vector3.zero)), Is.False);
    }
}

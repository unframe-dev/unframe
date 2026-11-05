using NUnit.Framework;
using UnityEngine;
using Unframe.Unity.VisualEffects.Gestures;

public sealed class VisualGestureRecognizerTests
{
    private static GestureSample Sample(double time, Vector3 position, bool valid = true) =>
        new GestureSample(time, position, Vector3.zero, Vector3.forward, valid);

    [Test]
    public void ThrowRequiresWindupAndEmitsOnce()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, new Vector3(0, 0, .4f))));
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(1, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(1.1, new Vector3(.1f, 0, -.2f))));
        var result = recognizer.Update(Sample(1.2, new Vector3(.1f, 0, .2f)));
        Assert.AreEqual(VisualGesture.Throw, result.Kind);
        Assert.AreEqual(GestureHand.Right, result.Hand);
        Assert.IsNull(recognizer.Update(Sample(1.3, new Vector3(.1f, 0, .6f))));
    }

    [Test]
    public void VerticalThrowAndTrackingRecoveryDoNotFire()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Left, Sample(0, Vector3.zero));
        recognizer.Update(Sample(.1, new Vector3(-.1f, 0, -.2f)));
        Assert.IsNull(recognizer.Update(Sample(.2, new Vector3(-.1f, .5f, .2f))));
        Assert.IsTrue(recognizer.IsCapturing);
        recognizer.Begin(VisualGesture.Throw, GestureHand.Left, Sample(.25, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.3, Vector3.zero, false)));
        Assert.IsFalse(recognizer.IsCapturing);
        Assert.IsNull(recognizer.Update(Sample(.4, Vector3.forward)));
    }

    [TestCase(1)]
    [TestCase(-1)]
    public void CircleRecognizesEitherDirection(int direction)
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Circle, GestureHand.Right, Sample(0, new Vector3(.2f, 0, 0)));
        GestureRecognition result = null;
        for (int i = 1; i <= 48 && result == null; i++)
        {
            float angle = direction * i * Mathf.PI * 2 / 48;
            result = recognizer.Update(Sample(i / 48.0, new Vector3(.2f * Mathf.Cos(angle), .2f * Mathf.Sin(angle), 0)));
        }
        Assert.IsNotNull(result);
        Assert.AreEqual(VisualGesture.Circle, result.Kind);
    }

    private static Vector3 EllipsePoint(float major, float minor, float rotationDegrees, float angle, float depth = 0)
    {
        Vector3 point = new Vector3(major * Mathf.Cos(angle), minor * Mathf.Sin(angle), 0);
        point = Quaternion.Euler(0, 0, rotationDegrees) * point;
        point.z = depth * Mathf.Sin(angle);
        return point;
    }

    private static GestureRecognition DrawEllipse(VisualGestureRecognizer recognizer, float major, float minor,
        float rotationDegrees = 0, int direction = 1, double startedAt = 0, float degrees = 360, float depth = 0)
    {
        Assert.IsTrue(recognizer.Begin(VisualGesture.Circle, GestureHand.Right,
            Sample(startedAt, EllipsePoint(major, minor, rotationDegrees, 0, depth))));
        for (int i = 1; i <= 96; i++)
        {
            float angle = direction * degrees * Mathf.Deg2Rad * i / 96;
            var result = recognizer.Update(Sample(startedAt + i / 96.0,
                EllipsePoint(major, minor, rotationDegrees, angle, depth)));
            if (result != null) return result;
        }
        return null;
    }

    [TestCase(0f, 1)]
    [TestCase(0f, -1)]
    [TestCase(45f, 1)]
    [TestCase(45f, -1)]
    [TestCase(90f, 1)]
    [TestCase(90f, -1)]
    public void CircleAcceptsTwoToOneEllipsesAtDifferentOrientations(float rotationDegrees, int direction)
    {
        var recognizer = new VisualGestureRecognizer();

        var result = DrawEllipse(recognizer, .24f, .12f, rotationDegrees, direction);

        Assert.IsNotNull(result);
        Assert.AreEqual(VisualGesture.Circle, result.Kind);
    }

    [Test]
    public void CircleAcceptsModerateEllipticalBias()
    {
        var recognizer = new VisualGestureRecognizer();
        Assert.IsNotNull(DrawEllipse(recognizer, .24f, .16f, 25));
    }

    [Test]
    public void CircleRejectsAFlattenedLoopAndAspectLimitCanBeAdjusted()
    {
        var recognizer = new VisualGestureRecognizer();
        Assert.IsNull(DrawEllipse(recognizer, .32f, .08f));

        var permissive = new VisualGestureRecognizer(new GestureRecognitionSettings { CircleMaxAspectRatio = 4 });
        Assert.IsNotNull(DrawEllipse(permissive, .3f, .1f, 45));
    }

    [Test]
    public void CircleAspectSettingIsValidatedAndCapturedAtBegin()
    {
        var invalid = new VisualGestureRecognizer(new GestureRecognitionSettings { CircleMaxAspectRatio = .99f });
        Assert.Catch<System.ArgumentException>(() => invalid.Begin(VisualGesture.Circle, GestureHand.Right,
            Sample(0, new Vector3(.24f, 0, 0))));

        var settings = new GestureRecognitionSettings { CircleMaxAspectRatio = 1.25f };
        var recognizer = new VisualGestureRecognizer(settings);
        recognizer.Begin(VisualGesture.Circle, GestureHand.Right, Sample(0, new Vector3(.24f, 0, 0)));
        settings.CircleMaxAspectRatio = 2.5f;
        for (int i = 1; i <= 96; i++)
            Assert.IsNull(recognizer.Update(Sample(i / 96.0,
                EllipsePoint(.24f, .12f, 0, i * Mathf.PI * 2 / 96))));

        Assert.IsNotNull(DrawEllipse(recognizer, .24f, .12f, startedAt: 2));
    }

    [Test]
    public void EllipseRecognitionKeepsTheOriginalWorldPath()
    {
        var recognizer = new VisualGestureRecognizer();
        var result = DrawEllipse(recognizer, .24f, .12f, 45);

        Assert.IsNotNull(result);
        Assert.AreEqual(EllipsePoint(.24f, .12f, 45, 0), result.WorldPath[0]);
        foreach (Vector3 point in result.WorldPath)
        {
            Vector3 unrotated = Quaternion.Euler(0, 0, -45) * point;
            float ellipseEquation = unrotated.x * unrotated.x / (.24f * .24f)
                + unrotated.y * unrotated.y / (.12f * .12f);
            Assert.That(ellipseEquation, Is.EqualTo(1).Within(.001));
        }
    }

    [Test]
    public void EllipseToleranceDoesNotAcceptUnclosedOrDeepPaths()
    {
        Assert.IsNull(DrawEllipse(new VisualGestureRecognizer(), .24f, .12f, degrees: 270));
        Assert.IsNull(DrawEllipse(new VisualGestureRecognizer(), .24f, .12f, depth: .15f));
    }

    [Test]
    public void EllipseToleranceDoesNotAcceptASquare()
    {
        var recognizer = new VisualGestureRecognizer();
        var corners = new[]
        {
            new Vector3(.2f, .2f, 0), new Vector3(-.2f, .2f, 0), new Vector3(-.2f, -.2f, 0),
            new Vector3(.2f, -.2f, 0), new Vector3(.2f, .2f, 0)
        };
        recognizer.Begin(VisualGesture.Circle, GestureHand.Right, Sample(0, corners[0]));
        for (int i = 1; i <= 96; i++)
        {
            int edge = (i - 1) / 24;
            float progress = ((i - 1) % 24 + 1) / 24f;
            Assert.IsNull(recognizer.Update(Sample(i / 96.0,
                Vector3.Lerp(corners[edge], corners[edge + 1], progress))));
        }
    }

    [Test]
    public void BackAndForthIsNotCircle()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Circle, GestureHand.Left, Sample(0, Vector3.zero));
        for (int i = 1; i <= 48; i++)
            Assert.IsNull(recognizer.Update(Sample(i / 48.0, new Vector3(.3f * Mathf.Sin(i * Mathf.PI / 24), 0, 0))));
    }

    [Test]
    public void SettingsAreCapturedAndInvalidTimeCancels()
    {
        var settings = new GestureRecognitionSettings();
        var recognizer = new VisualGestureRecognizer(settings);
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        settings.ThrowMinSpeed = 100;
        recognizer.Update(Sample(.1, new Vector3(.1f, 0, -.2f)));
        Assert.IsNotNull(recognizer.Update(Sample(.2, new Vector3(.1f, 0, .2f))));
        recognizer.Begin(VisualGesture.Circle, GestureHand.Right, Sample(1, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(1, Vector3.one)));
        Assert.IsFalse(recognizer.IsCapturing);
    }
    [Test]
    public void CirclePathIsAnIndependentReadOnlyWorldSpaceCopy()
    {
        var recognizer = new VisualGestureRecognizer();
        var origin = new Vector3(3, 2, 4);
        recognizer.Begin(VisualGesture.Circle, GestureHand.Right,
            new GestureSample(0, origin + new Vector3(.2f, 0, 0), origin, Vector3.forward, true));
        GestureRecognition result = null;
        for (int i = 1; i <= 48 && result == null; i++)
        {
            float angle = i * Mathf.PI * 2 / 48;
            result = recognizer.Update(new GestureSample(i / 48.0,
                origin + new Vector3(.2f * Mathf.Cos(angle), .2f * Mathf.Sin(angle), 0), origin, Vector3.forward, true));
        }
        Assert.IsNotNull(result);
        Assert.That(result.WorldPath.Count, Is.InRange(16, 512));
        Assert.AreEqual(origin + new Vector3(.2f, 0, 0), result.WorldPath[0]);
        var count = result.WorldPath.Count;
        recognizer.Cancel();
        recognizer.Begin(VisualGesture.Circle, GestureHand.Left, Sample(2, Vector3.zero));
        Assert.AreEqual(count, result.WorldPath.Count);
        Assert.AreEqual(origin + new Vector3(.2f, 0, 0), result.WorldPath[0]);
        Assert.Throws<System.NotSupportedException>(() =>
            ((System.Collections.Generic.IList<Vector3>)result.WorldPath)[0] = Vector3.zero);
    }

    [TestCase(-1)]
    [TestCase(1)]
    public void HoldingWindupDoesNotDiluteForwardSpeed(int side)
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, side < 0 ? GestureHand.Left : GestureHand.Right, Sample(0, Vector3.zero));
        for (int i = 1; i <= 6; i++)
            Assert.IsNull(recognizer.Update(Sample(i * .1, new Vector3(side * .1f, 0, -.2f))));
        var result = recognizer.Update(Sample(.7, new Vector3(side * .1f, 0, .2f)));
        Assert.IsNotNull(result);
        Assert.That(result.ForwardSpeed, Is.EqualTo(4).Within(.001));
    }

    [Test]
    public void DeeperWindupUpdatesForwardDistanceOrigin()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        recognizer.Update(Sample(.1, new Vector3(.1f, 0, -.2f)));
        recognizer.Update(Sample(.2, new Vector3(.1f, 0, -.5f)));
        var result = recognizer.Update(Sample(.3, new Vector3(.1f, 0, -.2f)));
        Assert.IsNotNull(result);
        Assert.That(result.ForwardSpeed, Is.EqualTo(3).Within(.001));
    }

    [Test]
    public void SlowSwingAndTrackingGapStillDoNotRecognize()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        recognizer.Update(Sample(.1, new Vector3(.1f, 0, -.2f)));
        for (int i = 1; i <= 10; i++)
            Assert.IsNull(recognizer.Update(Sample(.1 + i * .1, new Vector3(.1f, 0, -.2f + i * .025f))));
        Assert.IsNull(recognizer.Update(Sample(1.5, new Vector3(.1f, 0, .5f))));
        Assert.IsFalse(recognizer.IsCapturing);
    }

    [Test]
    public void SuccessfulThrowStopsCaptureAndNextCaptureStartsCleanly()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, new Vector3(.1f, 0, -.2f))));
        Assert.IsTrue(recognizer.IsCapturing);
        var result = recognizer.Update(Sample(.2, new Vector3(.1f, 0, .2f)));
        Assert.IsNotNull(result);
        Assert.That(result.ForwardSpeed, Is.EqualTo(4).Within(.001));
        Assert.IsFalse(recognizer.IsCapturing);
        Assert.IsTrue(recognizer.Begin(VisualGesture.Circle, GestureHand.Left, Sample(1, Vector3.zero)));
        Assert.IsTrue(recognizer.IsCapturing);
        Assert.IsNull(recognizer.Update(Sample(1.1, Vector3.zero)));
    }

    [Test]
    public void TrackingLossAndTimeoutStopCaptureUntilRestarted()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Circle, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, Vector3.zero, false)));
        Assert.IsFalse(recognizer.IsCapturing);
        Assert.IsTrue(recognizer.Begin(VisualGesture.Circle, GestureHand.Right, Sample(1, Vector3.zero)));
        for (int i = 1; i <= 20; i++)
            Assert.IsNull(recognizer.Update(Sample(1 + i * .1, Vector3.zero)));
        Assert.IsNull(recognizer.Update(Sample(3.1, Vector3.zero)));
        Assert.IsFalse(recognizer.IsCapturing);
    }

    [Test]
    public void CircleResultKeepsMeasuredRadiusAndAcceptedSamples()
    {
        var recognizer = new VisualGestureRecognizer();
        var result = DrawEllipse(recognizer, .2f, .2f);
        Assert.IsNotNull(result);
        Assert.That(result.CircleRadius, Is.EqualTo(.2f).Within(.02));
        Assert.That(result.WorldPath.Count, Is.GreaterThanOrEqualTo(16));
        Assert.IsFalse(recognizer.IsCapturing);
    }

    [Test]
    public void InsufficientBackwardMovementDoesNotArmThrow()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, new Vector3(.1f, .02f, -.1f))));
        Assert.IsTrue(recognizer.IsCapturing);
        Assert.IsNull(recognizer.Update(Sample(.2, new Vector3(.2f, .02f, .2f))));
        Assert.IsTrue(recognizer.IsCapturing);
        Assert.IsNull(recognizer.Update(Sample(.3, new Vector3(.1f, 0, -.2f))));
        Assert.IsNotNull(recognizer.Update(Sample(.4, new Vector3(.2f, .02f, .2f))));
    }

    [TestCase(GestureHand.Left)]
    [TestCase(GestureHand.Right)]
    public void StraightBackwardWindupAndForwardThrowNeedsNoSidewaysMovement(GestureHand hand)
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, hand, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, Vector3.back * .2f)));
        var result = recognizer.Update(Sample(.2, Vector3.forward * .2f));
        Assert.IsNotNull(result);
        Assert.AreEqual(hand, result.Hand);
        Assert.That(result.ForwardSpeed, Is.EqualTo(4).Within(.001));
    }

    [TestCase(0f)]
    [TestCase(90f)]
    [TestCase(180f)]
    [TestCase(270f)]
    public void BackAndForwardAreRelativeToInitialHorizontalGaze(float yawDegrees)
    {
        var recognizer = new VisualGestureRecognizer();
        Vector3 forward = Quaternion.Euler(0, yawDegrees, 0) * Vector3.forward;
        Vector3 head = new Vector3(4, 1.6f, -3);
        Vector3 start = head + forward * .5f;
        Vector3 gaze = forward + Vector3.up * .5f;
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, new GestureSample(0, start, head, gaze, true));
        Assert.IsNull(recognizer.Update(new GestureSample(.1, start - forward * .2f, head, gaze, true)));
        var result = recognizer.Update(new GestureSample(.2, start + forward * .2f, head, gaze, true));
        Assert.IsNotNull(result);
        Assert.That(Vector3.Distance(result.Direction, forward), Is.LessThan(.0001f));
    }

    [TestCase(0f, .2f)]
    [TestCase(.3f, 0f)]
    [TestCase(.3f, -.2f)]
    public void ForwardSidewaysAndObliqueWindupsDoNotArmThrow(float x, float z)
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, new Vector3(x, 0, z))));
        Assert.IsNull(recognizer.Update(Sample(.2, new Vector3(x, 0, .3f))));
    }

    [Test]
    public void HeadTurnDuringCaptureDoesNotRotateTheThrowReference()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right,
            new GestureSample(0, Vector3.zero, Vector3.zero, Vector3.right, true));
        Assert.IsNull(recognizer.Update(new GestureSample(.1, Vector3.left * .2f,
            Vector3.zero, Vector3.left, true)));
        var result = recognizer.Update(new GestureSample(.2, Vector3.right * .2f,
            Vector3.zero, Vector3.left, true));
        Assert.IsNotNull(result);
        Assert.AreEqual(Vector3.right, result.Direction);
    }

    [TestCase(.15f, 0f)]
    [TestCase(0f, .15f)]
    [TestCase(.15f, .15f)]
    public void ForwardThrowCanUseAnOffsetPathAfterWindup(float sideways, float upwards)
    {
        var recognizer = new VisualGestureRecognizer();
        Vector3 offset = new Vector3(sideways, upwards, 0);
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, Vector3.back * .2f)));
        Assert.IsNull(recognizer.Update(Sample(.2, offset * .5f + Vector3.back * .2f)));
        Assert.IsNull(recognizer.Update(Sample(.3, offset + Vector3.back * .2f)));
        Assert.IsTrue(recognizer.IsCapturing);
        Assert.IsNull(recognizer.Update(Sample(.4, offset + Vector3.back * .2f)));

        var result = recognizer.Update(Sample(.5, offset + Vector3.forward * .005f));

        Assert.IsNotNull(result);
        Assert.That(result.ForwardSpeed, Is.EqualTo(2.05f).Within(.001));
    }

    [TestCase(.22f, 0f)]
    [TestCase(0f, .22f)]
    public void ShortDirectionDeviationDoesNotCancelAndLaterForwardMotionCanRecognize(float sideways, float upwards)
    {
        var recognizer = new VisualGestureRecognizer();
        Vector3 offset = new Vector3(sideways, upwards, 0);
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, Vector3.back * .25f)));
        Assert.IsNull(recognizer.Update(Sample(.2, Vector3.back * .2f)));
        Assert.IsNull(recognizer.Update(Sample(.3, offset + Vector3.back * .12f)));
        Assert.IsTrue(recognizer.IsCapturing);
        Assert.IsNull(recognizer.Update(Sample(.4, offset + Vector3.back * .11f)));

        var result = recognizer.Update(Sample(.5, offset + Vector3.forward * .04f));

        Assert.IsNotNull(result);
    }

    [TestCase(.4f, 0f)]
    [TestCase(0f, .4f)]
    public void SustainedSidewaysOrUpwardReleaseDoesNotRecognizeEvenWithEnoughForwardSpeed(float sideways, float upwards)
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Right, Sample(0, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(.1, Vector3.back * .2f)));
        for (int i = 1; i <= 3; i++)
            Assert.IsNull(recognizer.Update(Sample(.1 + i * .1,
                new Vector3(sideways * i, upwards * i, -.2f + .25f * i))));
        Assert.IsTrue(recognizer.IsCapturing);
    }

}

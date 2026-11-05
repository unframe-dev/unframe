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
        Assert.IsNull(recognizer.Update(Sample(1.1, new Vector3(.25f, 0, -.2f))));
        var result = recognizer.Update(Sample(1.2, new Vector3(.25f, 0, .2f)));
        Assert.AreEqual(VisualGesture.Throw, result.Kind);
        Assert.AreEqual(GestureHand.Right, result.Hand);
        Assert.IsNull(recognizer.Update(Sample(1.3, new Vector3(.25f, 0, .6f))));
    }

    [Test]
    public void VerticalThrowAndTrackingRecoveryDoNotFire()
    {
        var recognizer = new VisualGestureRecognizer();
        recognizer.Begin(VisualGesture.Throw, GestureHand.Left, Sample(0, Vector3.zero));
        recognizer.Update(Sample(.1, new Vector3(-.25f, 0, -.2f)));
        Assert.IsNull(recognizer.Update(Sample(.2, new Vector3(-.25f, .5f, .2f))));
        Assert.IsFalse(recognizer.IsCapturing);
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
        recognizer.Update(Sample(.1, new Vector3(.25f, 0, -.2f)));
        Assert.IsNotNull(recognizer.Update(Sample(.2, new Vector3(.25f, 0, .2f))));
        recognizer.Begin(VisualGesture.Circle, GestureHand.Right, Sample(1, Vector3.zero));
        Assert.IsNull(recognizer.Update(Sample(1, Vector3.one)));
        Assert.IsFalse(recognizer.IsCapturing);
    }
}

using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestGestureRecognitionTests
{
    private static Vector3 At(double x = 0, double y = 0, double z = 0) => new Vector3 { X = x, Y = y, Z = z };

    [Test]
    public void ThrowWinsOverTheWindupPullAndKeepsCapturedContext()
    {
        var input = new QuestGestureRecognition();
        var context = new InputContext { InputEpoch = 7 };
        input.Reset(context, new PresenterRecognitionCatalog { Gestures = { GestureKind.Throw, GestureKind.PullBackward } });
        context.InputEpoch = 8;
        Assert.IsNull(input.SampleHands(0, At(), null, At(z: -1), true, false, At()));
        Assert.IsNull(input.SampleHands(.1, At(-.2, 0, .3), null, At(z: -1), true, false, At()));
        var result = input.SampleHands(.25, At(-.2, 0, -.2), null, At(z: -1), true, false, At());
        Assert.AreEqual(GestureKind.Throw, result?.Gesture);
        Assert.AreEqual(7, result.Context.InputEpoch);
        Assert.IsNull(input.SampleHands(.3, At(-.2, 0, -.5), null, At(z: -1), true, false, At()));
    }

    [Test]
    public void TrackingLossAndContextChangesCancelHeldCapture()
    {
        var input = new QuestGestureRecognition();
        var catalog = new PresenterRecognitionCatalog { Gestures = { GestureKind.Throw } };
        input.Reset(new InputContext { InputEpoch = 1 }, catalog);
        input.SampleHands(0, At(), null, At(z: -1), true, false, At());
        input.SampleHands(.1, null, null, At(z: -1), true, false, At());
        input.Reset(new InputContext { InputEpoch = 2 }, catalog);
        Assert.IsNull(input.SampleHands(.2, At(-.2, 0, .3), null, At(z: -1), true, false, At()));
        Assert.IsNull(input.SampleHands(.3, At(-.2, 0, -.2), null, At(z: -1), true, false, At()));
    }
    [Test]
    public void CircleWinsOverASwipeAndResetRequiresAReleasedTrigger()
    {
        var input = new QuestGestureRecognition();
        var catalog = new PresenterRecognitionCatalog { Gestures = { GestureKind.Circle, GestureKind.SwipeLeft, GestureKind.SwipeRight } };
        input.Reset(new InputContext { InputEpoch = 3 }, catalog);
        input.SampleHands(0, At(.2), null, At(z: -1), true, false, At());
        PresenterRecognitionResult result = null;
        for (int i = 1; i <= 40 && result == null; i++)
        {
            double angle = i / 40d * System.Math.PI * 2;
            result = input.SampleHands(i * .025, At(.2 * System.Math.Cos(angle), .2 * System.Math.Sin(angle)),
                null, At(z: -1), true, false, At());
        }
        Assert.AreEqual(GestureKind.Circle, result?.Gesture);
        input.Reset(new InputContext { InputEpoch = 4 }, catalog);
        Assert.IsNull(input.SampleHands(1.1, At(.2), null, At(z: -1), true, false, At()));
        Assert.IsNull(input.SampleHands(1.2, At(-.3), null, At(z: -1), true, false, At()));
    }

    [Test]
    public void EllipticalCircleUsesTheExistingGestureResultAndCapturedContext()
    {
        var input = new QuestGestureRecognition();
        var context = new InputContext { InputEpoch = 12 };
        input.Reset(context, new PresenterRecognitionCatalog { Gestures = { GestureKind.Circle } });
        input.SampleHands(0, null, At(.24), At(z: -1), false, true, At());
        context.InputEpoch = 13;
        PresenterRecognitionResult result = null;
        for (int i = 1; i <= 96 && result == null; i++)
        {
            double angle = i / 96d * System.Math.PI * 2;
            result = input.SampleHands(i / 96d, null,
                At(.24 * System.Math.Cos(angle), .12 * System.Math.Sin(angle)),
                At(z: -1), false, true, At());
        }
        Assert.AreEqual(GestureKind.Circle, result?.Gesture);
        Assert.AreEqual(12, result.Context.InputEpoch);
    }

    [Test]
    public void CompetingSwipeIsEmittedOnlyAfterRelease()
    {
        var input = new QuestGestureRecognition();
        input.Reset(new InputContext { InputEpoch = 3 },
            new PresenterRecognitionCatalog { Gestures = { GestureKind.Circle, GestureKind.SwipeLeft } });
        input.SampleHands(0, At(), null, At(z: -1), true, false, At());
        Assert.IsNull(input.SampleHands(.1, At(-.3), null, At(z: -1), true, false, At()));
        Assert.AreEqual(GestureKind.SwipeLeft,
            input.SampleHands(.15, At(-.3), null, At(z: -1), false, false, At())?.Gesture);
    }

    [Test]
    public void StraightBackwardAndForwardThrowUsesTheExistingGestureResult()
    {
        var input = new QuestGestureRecognition();
        input.Reset(new InputContext { InputEpoch = 9 },
            new PresenterRecognitionCatalog { Gestures = { GestureKind.Throw } });
        Assert.IsNull(input.SampleHands(0, null, At(), At(z: -1), false, true, At()));
        Assert.IsNull(input.SampleHands(.1, null, At(z: .2), At(z: -1), false, true, At()));
        var result = input.SampleHands(.2, null, At(z: -.2), At(z: -1), false, true, At());
        Assert.AreEqual(GestureKind.Throw, result?.Gesture);
        Assert.AreEqual(9, result.Context.InputEpoch);
    }

    [Test]
    public void OffsetForwardPathStillUsesTheExistingGestureResult()
    {
        var input = new QuestGestureRecognition();
        input.Reset(new InputContext { InputEpoch = 10 },
            new PresenterRecognitionCatalog { Gestures = { GestureKind.Throw } });
        Assert.IsNull(input.SampleHands(0, null, At(), At(z: -1), false, true, At()));
        Assert.IsNull(input.SampleHands(.1, null, At(z: .2), At(z: -1), false, true, At()));
        Assert.IsNull(input.SampleHands(.2, null, At(.075, .075, .2), At(z: -1), false, true, At()));
        Assert.IsNull(input.SampleHands(.3, null, At(.15, .15, .2), At(z: -1), false, true, At()));
        Assert.IsNull(input.SampleHands(.4, null, At(.15, .15, .2), At(z: -1), false, true, At()));

        var result = input.SampleHands(.5, null, At(.15, .15, -.005), At(z: -1), false, true, At());

        Assert.AreEqual(GestureKind.Throw, result?.Gesture);
        Assert.AreEqual(10, result.Context.InputEpoch);
    }

}

using System;
using System.Collections.Generic;
using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using Unframe.Unity.VisualEffects.Gestures;
using UnityVector = UnityEngine.Vector3;

public sealed class GesturePositionSamplerTests
{
    private static GestureSample At(double time, bool tracked = true) =>
        new GestureSample(time, new UnityVector(1, 2, 3), UnityVector.zero, UnityVector.forward, tracked);

    [Test]
    public void IntervalIsIndependentForEachHandAndGestureAndDoesNotCatchUp()
    {
        var sampler = new GesturePositionSampler();
        Assert.IsNotNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(0)));
        Assert.IsNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(.02)));
        Assert.IsNotNull(sampler.Sample(VisualGesture.Throw, GestureHand.Right, At(.02)));
        Assert.IsNotNull(sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(.02)));
        Assert.IsNotNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(1)));
        Assert.IsNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(1)));
        Assert.IsNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(1.01)));
    }

    [Test]
    public void DisabledTrackingLossAndClockReversalClearTheSchedule()
    {
        var sampler = new GesturePositionSampler();
        sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(1));
        Assert.IsNull(sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(1.01, false)));
        Assert.IsNotNull(sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(1.02)));
        Assert.IsNull(sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(.5)));
        Assert.IsNotNull(sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(.51)));
        sampler.Enabled = false;
        Assert.IsNull(sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(.52)));
        sampler.Enabled = true;
        Assert.IsNotNull(sampler.Sample(VisualGesture.Circle, GestureHand.Left, At(.53)));
    }

    [TestCase(0d)]
    [TestCase(-1d)]
    [TestCase(double.NaN)]
    [TestCase(double.PositiveInfinity)]
    public void InvalidIntervalsAreRejected(double interval)
    {
        var sampler = new GesturePositionSampler();
        Assert.Throws<ArgumentOutOfRangeException>(() => sampler.IntervalSeconds = interval);
    }

    [Test]
    public void EnabledCatalogEmitsWithoutTriggerAndKeepsItsContextAndUnityCoordinates()
    {
        var input = new QuestGestureRecognition { PositionSampleIntervalSeconds = .1 };
        var received = new List<PresenterGesturePositionSample>();
        input.PositionSampleReady += received.Add;
        var context = new InputContext { InputEpoch = 3 };
        input.Reset(context, new PresenterRecognitionCatalog { Gestures = { GestureKind.Circle } });
        context.InputEpoch = 99;
        var hand = new Vector3 { X = 1, Y = 2, Z = 3 };
        input.SampleHands(0, hand, null, new Vector3 { Z = -1 }, false, false, new Vector3());
        Assert.AreEqual(1, received.Count);
        Assert.AreEqual(VisualGesture.Circle, received[0].Sample.Gesture);
        Assert.AreEqual(GestureHand.Left, received[0].Sample.Hand);
        Assert.AreEqual(new UnityVector(1, 2, -3), received[0].Sample.Position);
        Assert.AreEqual(3, received[0].Context.InputEpoch);
        received[0].Context.InputEpoch = 77;
        Assert.AreEqual(3, received[0].Context.InputEpoch);
        input.SampleHands(.02, hand, null, new Vector3 { Z = -1 }, false, false, new Vector3());
        Assert.AreEqual(1, received.Count);
        input.Reset(null, null);
        input.SampleHands(.2, hand, hand, new Vector3 { Z = -1 }, false, false, new Vector3());
        Assert.AreEqual(1, received.Count);
    }

    [Test]
    public void IntervalChangeStartsANewSamplingSchedule()
    {
        var sampler = new GesturePositionSampler();
        Assert.IsNotNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(0)));
        Assert.IsNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(.01)));
        sampler.IntervalSeconds = .1;
        Assert.IsNotNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(.02)));
        Assert.IsNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(.07)));
        Assert.IsNotNull(sampler.Sample(VisualGesture.Throw, GestureHand.Left, At(.13)));
    }

    [Test]
    public void BothEnabledGesturesEmitForBothHandsAndCatalogRemovalStopsNotifications()
    {
        var input = new QuestGestureRecognition();
        var received = new List<PresenterGesturePositionSample>();
        input.PositionSampleReady += received.Add;
        input.Reset(new InputContext { InputEpoch = 1 },
            new PresenterRecognitionCatalog { Gestures = { GestureKind.Throw, GestureKind.Circle } });
        var hand = new Vector3();
        input.SampleHands(0, hand, hand, new Vector3 { Z = -1 }, false, false, hand);
        Assert.AreEqual(4, received.Count);
        Assert.AreEqual(VisualGesture.Throw, received[0].Sample.Gesture);
        Assert.AreEqual(GestureHand.Left, received[0].Sample.Hand);
        Assert.AreEqual(VisualGesture.Circle, received[3].Sample.Gesture);
        Assert.AreEqual(GestureHand.Right, received[3].Sample.Hand);
        input.Reset(new InputContext { InputEpoch = 2 },
            new PresenterRecognitionCatalog { Gestures = { GestureKind.SwipeLeft } });
        input.SampleHands(.1, hand, hand, new Vector3 { Z = -1 }, false, false, hand);
        Assert.AreEqual(4, received.Count);
    }

    [Test]
    public void UnsubscribedSamplerDoesNotConsumeTheFirstNotificationAfterSubscription()
    {
        var input = new QuestGestureRecognition();
        var hand = new Vector3();
        input.Reset(new InputContext { InputEpoch = 1 }, new PresenterRecognitionCatalog { Gestures = { GestureKind.Circle } });
        input.SampleHands(0, hand, null, new Vector3 { Z = -1 }, false, false, hand);
        var received = new List<PresenterGesturePositionSample>();
        input.PositionSampleReady += received.Add;
        input.SampleHands(.01, hand, null, new Vector3 { Z = -1 }, false, false, hand);
        Assert.AreEqual(1, received.Count);
    }
}

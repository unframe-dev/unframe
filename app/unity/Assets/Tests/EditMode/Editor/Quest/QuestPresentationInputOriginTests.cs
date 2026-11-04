using System;
using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestPresentationInputOriginTests
{
    [Test]
    public void InitialZeroOriginIsRetainedByTypedPresenterCommands()
    {
        var context = new InputContext { InputEpoch = 1, GroupId = "main", GroupEntryEpoch = 1, StepId = "start", StepEntryEpoch = 1 };
        Assert.That(QuestPresentationInput.CreateControl(RuntimeControlKind.Pause, 0, 1).RuntimeControl.PresentationOriginVersion, Is.Zero);
        Assert.That(QuestPresentationInput.CreateLogical("next", 0, context, 1).LogicalInput.PresentationOriginVersion, Is.Zero);
        Assert.That(QuestPresentationInput.CreateSurfaceInteraction("surface", "continue", 0, context, 1).SurfaceInteraction.PresentationOriginVersion, Is.Zero);
        var recognizer = new PresenterRecognition();
        recognizer.Reset(context, new PresenterRecognitionCatalog { Gestures = { GestureKind.SwipeLeft } });
        var origin = new Vector3();
        var forward = new Vector3 { Z = -1 };
        recognizer.SampleHands(0, origin, null, forward, true, false);
        recognizer.SampleHands(0.2, origin, null, forward, true, false);
        recognizer.SampleHands(0.25, new Vector3 { X = -0.08 }, null, forward, true, false);
        var gesture = recognizer.SampleHands(0.3, new Vector3 { X = -0.3 }, null, forward, true, false);
        Assert.That(gesture, Is.Not.Null);
        Assert.That(QuestPresentationInput.CreateRecognition(gesture, 0, 1).GestureInput.PresentationOriginVersion, Is.Zero);
    }

    [Test]
    public void InitialOriginDoesNotPermitAnUnsynchronizedCommandEpoch()
    {
        Assert.Throws<ArgumentException>(() => QuestPresentationInput.CreateControl(RuntimeControlKind.Pause, 0, 0));
    }

    [Test]
    public void GestureTriggersRequireAFreshPressAfterBlockedInput()
    {
        var triggers = new QuestPresentationGestureTriggers();
        triggers.Sample(true, false, false, false, false, out bool left, out bool right);
        Assert.That(left || right, Is.False);
        triggers.Sample(true, false, true, false, false, out left, out right);
        Assert.That(left || right, Is.False);
        triggers.Sample(false, false, true, false, false, out left, out right);
        triggers.Sample(true, false, true, true, false, out left, out right);
        Assert.That(left || right, Is.False, "A menu click cannot also start a gesture.");
        triggers.Sample(true, false, true, false, false, out left, out right);
        Assert.That(left || right, Is.False);
        triggers.Sample(false, false, true, false, false, out left, out right);
        triggers.Sample(true, true, true, false, false, out left, out right);
        Assert.That(left && right, Is.True);
        triggers.Sample(true, true, false, false, false, out left, out right);
        triggers.Sample(true, true, true, false, false, out left, out right);
        Assert.That(left || right, Is.False, "Resuming input must not reuse a held trigger.");
    }
}

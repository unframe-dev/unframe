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
        recognizer.SampleHands(0, origin, null, forward);
        recognizer.SampleHands(0.2, origin, null, forward);
        recognizer.SampleHands(0.25, new Vector3 { X = -0.08 }, null, forward);
        var gesture = recognizer.SampleHands(0.3, new Vector3 { X = -0.3 }, null, forward);
        Assert.That(gesture, Is.Not.Null);
        Assert.That(QuestPresentationInput.CreateRecognition(gesture, 0, 1).GestureInput.PresentationOriginVersion, Is.Zero);
    }

    [Test]
    public void InitialOriginDoesNotPermitAnUnsynchronizedCommandEpoch()
    {
        Assert.Throws<ArgumentException>(() => QuestPresentationInput.CreateControl(RuntimeControlKind.Pause, 0, 0));
    }
}

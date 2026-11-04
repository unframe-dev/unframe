using System;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public static class PresenterAuthorityTests
{
#if UNITY_EDITOR
    [NUnit.Framework.Test]
#endif
    public static void Run()
    {
        var sync = new PresenterInputSynchronizationState();
        var required = new PresenterInputSynchronization
        {
            Phase = InputSynchronizationPhase.Required,
            Reason = InputSynchronizationReason.Connected,
            SynchronizationRevision = 2,
            CommandEpoch = 3,
            NextCommandEpoch = 4,
            ReliableSequence = 10,
            InputContext = new InputContext { InputEpoch = 5, GroupId = "g", GroupEntryEpoch = 1, StepId = "s", StepEntryEpoch = 2 },
            RecognitionCatalog = new PresenterRecognitionCatalog(),
        };
        Require(sync.Receive(required), "valid required rejected");
        Require(!sync.Ready && sync.CommandEpoch == 3, "next epoch used before READY");
        Require(sync.TryCreateAck(9) == null, "ACK preceded reliable cut");
        var ack = sync.TryCreateAck(12);
        Require(ack?.CommandEpoch == 4, "ACK lost next epoch");
        Require(ack.AppliedReliableSequence == 10, "ACK must confirm the synchronization cut even when later reliable events are applied");
        var ready = required.Clone(); ready.Phase = InputSynchronizationPhase.Ready; ready.CommandEpoch = 4; ready.ClearNextCommandEpoch();
        Require(sync.Receive(ready) && sync.Ready && sync.CommandEpoch == 4, "READY did not activate new epoch");
        Require(!sync.Receive(required), "old REQUIRED replaced READY");
        CheckCapturedContext();
        CheckGestures();
        CheckTriggerCapture();
        CheckZones();
        sync.Disconnect();
        Require(!sync.Ready && sync.TryCreateAck(10) == null, "disconnect retained pending input");
    }
    private static void CheckCapturedContext()
    {
        var context = new InputContext { InputEpoch = 3, GroupId = "g", GroupEntryEpoch = 1, StepId = "s", StepEntryEpoch = 1 };
        var command = QuestPresentationInput.CreateLogical("next", 1, context, 7);
        context.InputEpoch = 9;
        Require(command.LogicalInput.InputContext.InputEpoch == 3 && command.LogicalInput.CommandEpoch == 7
            && command.LogicalInput.ClientEventId.StartsWith("7:"), "button command lost captured context");
        var catalog = new PresenterRecognitionCatalog { Gestures = { GestureKind.SwipeRight, GestureKind.PushForward } };
        var recognition = new PresenterRecognition(); recognition.Reset(context, catalog);
        var origin = new Vector3(); var ahead = new Vector3 { Z = -1 };
        recognition.SampleHands(0, origin, null, ahead, true, false);
        recognition.SampleHands(0.25, new Vector3 { X = 0.08 }, null, ahead, true, false);
        var result = recognition.SampleHands(0.3, new Vector3 { X = 0.3 }, null, new Vector3 { X = 1 }, true, false);
        Require(result?.Gesture == GestureKind.SwipeRight, "head rotation reclassified an active movement");
        recognition.Reset(new InputContext { InputEpoch = 10 }, catalog);
        recognition.SampleHands(0.31, new Vector3 { X = 0.3 }, null, ahead, true, false);
        Require(recognition.SampleHands(0.4, new Vector3 { X = 0.6 }, null, ahead, true, false) == null, "epoch change relabeled an active movement");
    }

    private static void CheckGestures()
    {
        var context = new InputContext { InputEpoch = 5, GroupId = "g", GroupEntryEpoch = 1, StepId = "s", StepEntryEpoch = 2 };
        var catalog = new PresenterRecognitionCatalog();
        for (int i = 1; i <= 8; i++) catalog.Gestures.Add((GestureKind)i);
        var vectors = new[] { new Vector3 { X = -0.4f }, new Vector3 { X = 0.4f }, new Vector3 { Y = -0.4f }, new Vector3 { Y = 0.4f }, new Vector3 { Z = -0.4f }, new Vector3 { Z = 0.4f } };
        for (int i = 0; i < vectors.Length; i++)
        {
            var recognizer = new PresenterRecognition();
            recognizer.Reset(context, catalog);
            var start = new Vector3(); var forward = new Vector3 { Z = -1 };
            recognizer.SampleHands(0, start, null, forward, true, false);
            var result = recognizer.SampleHands(0.3, vectors[i], null, forward, true, false);
            Require(result?.Gesture == (GestureKind)(i + 1) && result.Context.InputEpoch == 5, "gesture fixture misclassified " + i);
            Require(recognizer.SampleHands(0.4, vectors[i], null, forward, true, false) == null, "one motion emitted twice");
        }
        foreach (bool spread in new[] { true, false })
        {
            var recognizer = new PresenterRecognition(); recognizer.Reset(context, catalog);
            var left = new Vector3 { X = -0.3f }; var right = new Vector3 { X = 0.3f }; var forward = new Vector3 { Z = -1 };
            recognizer.SampleHands(0, left, right, forward, true, true);
            var result = recognizer.SampleHands(0.3, new Vector3 { X = spread ? -0.5f : -0.1f }, new Vector3 { X = spread ? 0.5f : 0.1f }, forward, true, true);
            Require(result?.Gesture == (spread ? GestureKind.SpreadHands : GestureKind.CloseHands), "two hand gesture misclassified");
        }
    }
    private static void CheckTriggerCapture()
    {
        var catalog = new PresenterRecognitionCatalog { Gestures = { GestureKind.SwipeLeft, GestureKind.SwipeRight, GestureKind.SpreadHands } };
        var ahead = new Vector3 { Z = -1 };
        PresenterRecognition Create()
        {
            var value = new PresenterRecognition();
            value.Reset(new InputContext { InputEpoch = 1 }, catalog);
            return value;
        }
        Vector3 At(float x, float y = 0) => new Vector3 { X = x, Y = y };

        var recognition = Create();
        recognition.SampleHands(0, At(0), At(1), ahead, false, false);
        Require(recognition.SampleHands(.1, At(-.4f), At(1), ahead, false, false) == null, "motion without a trigger was recognized");
        recognition.SampleHands(.2, At(-.4f), At(1), ahead, true, false);
        Require(recognition.SampleHands(.3, At(-.5f), null, ahead, true, false) == null, "movement before trigger was counted");
        Require(recognition.SampleHands(.4, At(-.7f), At(4), ahead, true, false)?.Gesture == GestureKind.SwipeLeft,
            "unused hand tracking or movement interfered with trigger capture");
        Require(recognition.SampleHands(.5, At(-1), null, ahead, true, false) == null, "a held trigger emitted twice");
        recognition.SampleHands(.6, At(-1), null, ahead, false, false);
        recognition.SampleHands(.7, At(-1), null, ahead, true, false);
        Require(recognition.SampleHands(.8, At(-.6f), null, ahead, true, false)?.Gesture == GestureKind.SwipeRight,
            "repress did not start at a fresh position");

        recognition = Create();
        recognition.SampleHands(0, At(-1), At(0), ahead, false, true);
        Require(recognition.SampleHands(.1, At(5), At(.3f), ahead, false, true)?.Gesture == GestureKind.SwipeRight,
            "right trigger did not isolate the right hand");

        recognition = Create();
        recognition.SampleHands(0, At(0), null, ahead, true, false);
        Require(recognition.SampleHands(.1, At(-.4f), null, ahead, false, false) == null, "release emitted a gesture");
        Require(recognition.SampleHands(.2, At(-.8f), null, ahead, false, false) == null, "released capture kept recognizing");
        recognition.SampleHands(.3, At(-.8f), null, ahead, true, false);
        Require(recognition.SampleHands(1.2, At(-1.2f), null, ahead, true, false) == null, "expired capture emitted");
        Require(recognition.SampleHands(1.3, At(-1.6f), null, ahead, true, false) == null, "held trigger restarted after expiry");

        recognition = Create();
        recognition.SampleHands(0, At(0), null, ahead, true, false);
        recognition.SampleHands(.1, null, null, ahead, true, false);
        Require(recognition.SampleHands(.2, At(-.4f), null, ahead, true, false) == null, "tracking recovery reused a lost capture");
        recognition.Reset(new InputContext { InputEpoch = 2 }, catalog);
        Require(recognition.SampleHands(.3, At(-.8f), null, ahead, true, false) == null, "reset reused a held trigger");
        recognition.SampleHands(.4, At(-.8f), null, ahead, false, false);
        recognition.SampleHands(.5, At(-.8f), null, ahead, true, false);
        Require(recognition.SampleHands(.6, At(-1.2f), null, ahead, true, false)?.Context.InputEpoch == 2,
            "fresh press did not use the new input context");

        recognition = Create();
        var triggers = new QuestPresentationGestureTriggers();
        triggers.Sample(true, false, true, false, false, out bool leftHeld, out bool rightHeld);
        recognition.SampleHands(0, At(0), null, ahead, leftHeld, rightHeld);
        triggers.Sample(true, false, false, false, false, out leftHeld, out rightHeld);
        recognition.SampleHands(.1, null, null, null, leftHeld, rightHeld);
        recognition.Reset(null, null);
        triggers.Sample(false, false, false, false, false, out leftHeld, out rightHeld);
        recognition.SampleHands(.2, null, null, null, leftHeld, rightHeld);
        recognition.Reset(new InputContext { InputEpoch = 3 }, catalog);
        triggers.Sample(true, false, true, false, false, out leftHeld, out rightHeld);
        recognition.SampleHands(.3, At(0), null, ahead, leftHeld, rightHeld);
        triggers.Sample(true, false, true, false, false, out leftHeld, out rightHeld);
        Require(recognition.SampleHands(.4, At(-.3f), null, ahead, leftHeld, rightHeld)?.Gesture == GestureKind.SwipeLeft,
            "a release while input was blocked swallowed the next fresh press");

        recognition = Create();
        recognition.SampleHands(0, At(-.3f), At(.3f), ahead, true, false);
        recognition.SampleHands(.1, At(-.5f), At(.3f), ahead, true, true);
        Require(recognition.SampleHands(.2, At(-.7f), At(.5f), ahead, true, true)?.Gesture == GestureKind.SpreadHands,
            "second trigger did not capture a fresh two-hand start");
        recognition = Create();
        recognition.SampleHands(0, At(-.3f), At(.3f), ahead, true, true);
        Require(recognition.SampleHands(.1, At(-.6f), At(.6f), ahead, true, false) == null,
            "a two-hand gesture survived releasing one trigger");

        recognition = new PresenterRecognition();
        recognition.Reset(new InputContext { InputEpoch = 1 }, new PresenterRecognitionCatalog { Gestures = { GestureKind.SwipeLeft } });
        recognition.SampleHands(0, At(0), null, ahead, true, false);
        Require(recognition.SampleHands(.1, At(0, .2f), null, ahead, true, false) == null, "unrequested gesture emitted");
        Require(recognition.SampleHands(.2, At(-.4f, .2f), null, ahead, true, false)?.Gesture == GestureKind.SwipeLeft,
            "unrequested preparation consumed the capture");
    }

    private static void CheckZones()
    {
        var recognizer = new PresenterRecognition();
        var catalog = new PresenterRecognitionCatalog(); catalog.Zones.Add(new PresenterRecognitionZone { ZoneId = "zone", Center = new Vector3() });
        recognizer.Reset(new InputContext { InputEpoch = 1 }, catalog);
        Require(recognizer.SampleWaist(new Vector3()).Count == 0, "initial enter emitted");
        Require(recognizer.SampleWaist(null).Count == 0, "tracking loss emitted exit");
        Require(recognizer.SampleWaist(new Vector3 { X = 2 }).Count == 0, "tracking recovery emitted exit");
        Require(recognizer.SampleWaist(new Vector3 { X = 1 }).Count == 1, "2m boundary did not enter");
    }
    private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
}

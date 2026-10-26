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
        recognition.SampleHands(0, origin, null, ahead); recognition.SampleHands(0.2, origin, null, ahead);
        recognition.SampleHands(0.25, new Vector3 { X = 0.08 }, null, ahead);
        var result = recognition.SampleHands(0.3, new Vector3 { X = 0.3 }, null, new Vector3 { X = 1 });
        Require(result?.Gesture == GestureKind.SwipeRight, "head rotation reclassified an active movement");
        recognition.Reset(new InputContext { InputEpoch = 10 }, catalog);
        recognition.SampleHands(0.31, new Vector3 { X = 0.3 }, null, ahead);
        Require(recognition.SampleHands(0.4, new Vector3 { X = 0.6 }, null, ahead) == null, "epoch change relabeled an active movement");
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
            recognizer.SampleHands(0, start, null, forward);
            recognizer.SampleHands(0.2, start, null, forward);
            var result = recognizer.SampleHands(0.3, vectors[i], null, forward);
            Require(result?.Gesture == (GestureKind)(i + 1) && result.Context.InputEpoch == 5, "gesture fixture misclassified " + i);
            Require(recognizer.SampleHands(0.4, vectors[i], null, forward) == null, "one motion emitted twice");
        }
        foreach (bool spread in new[] { true, false })
        {
            var recognizer = new PresenterRecognition(); recognizer.Reset(context, catalog);
            var left = new Vector3 { X = -0.3f }; var right = new Vector3 { X = 0.3f }; var forward = new Vector3 { Z = -1 };
            recognizer.SampleHands(0, left, right, forward); recognizer.SampleHands(0.2, left, right, forward);
            var result = recognizer.SampleHands(0.3, new Vector3 { X = spread ? -0.5f : -0.1f }, new Vector3 { X = spread ? 0.5f : 0.1f }, forward);
            Require(result?.Gesture == (spread ? GestureKind.SpreadHands : GestureKind.CloseHands), "two hand gesture misclassified");
        }
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

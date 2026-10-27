using System.Collections;
using System.Collections.Generic;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Preview;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class UnframePreviewBridgeEditModeTests
{
    [UnityTest]
    public IEnumerator PlaybackAcknowledgesTheExactSequenceAndRejectsUpdatesAfterInvalidation()
    {
        var root = new GameObject("UnframePreview");
        try
        {
            var bridge = root.AddComponent<UnframePreview>();
            var events = new List<PresentationPreviewEvent>();
            bridge.Notification += events.Add;
            bridge.Configure("{\"token\":\"preview-token\"}");
            var input = PresentationPreviewTestFixture.Create();
            bridge.Prepare(JsonFormatter.Default.Format(input));
            while (events.Count == 0) yield return null;
            bridge.Commit(input.RequestId);
            var state = new LocalPreviewPlaybackState
            {
                RequestId = input.RequestId,
                Sequence = 9007199254740993UL,
                CurrentGroupId = "group:first",
                NodeStates = { input.InitialState.NodeStates },
                SurfaceStates = { input.InitialState.SurfaceStates },
                Clock = new RuntimeClockSnapshot { Paused = new Paused() },
            };
            bridge.Playback(JsonFormatter.Default.Format(state));
            Assert.That(events[2].kind, Is.EqualTo("playback"));
            Assert.That(events[2].requestId, Is.EqualTo(input.RequestId));
            Assert.That(events[2].sequence, Is.EqualTo("9007199254740993"));
            bridge.Invalidate(""); state.Sequence++;
            bridge.Playback(JsonFormatter.Default.Format(state));
            Assert.That(events[3].kind, Is.EqualTo("failed"));
            Assert.That(events[3].message, Is.EqualTo("preview.playback-request-mismatch"));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [UnityTest]
    public IEnumerator PrepareAndExplicitCommitNotifyTheMatchingIdentityWhileInvalidInputKeepsTheScene()
    {
        var root = new GameObject("UnframePreview");
        try
        {
            var bridge = root.AddComponent<UnframePreview>();
            var events = new List<PresentationPreviewEvent>();
            bridge.Notification += events.Add;
            bridge.Configure("{\"token\":\"secret-preview-token\"}");
            var input = PresentationPreviewTestFixture.Create();
            bridge.Prepare(JsonFormatter.Default.Format(input));
            while (events.Count == 0) yield return null;
            Assert.That(events[0].kind, Is.EqualTo("prepared"));
            Assert.That(events[0].requestId, Is.EqualTo(input.RequestId));
            Assert.That(events[0].buildIdentity, Is.EqualTo("build:a"));
            Assert.That(root.transform.GetChild(0).gameObject.activeSelf, Is.False);
            bridge.Commit(input.RequestId);
            Assert.That(events[1].kind, Is.EqualTo("committed"));
            Assert.That(events[1].buildIdentity, Is.EqualTo("build:a"));
            Assert.That(root.transform.GetChild(0).gameObject.activeSelf, Is.True);
            bridge.Prepare("{");
            while (events.Count < 3) yield return null;
            Assert.That(events[2].kind, Is.EqualTo("failed"));
            Assert.That(events[2].message, Does.Not.Contain("secret-preview-token"));
            Assert.That(root.transform.childCount, Is.EqualTo(1));
            Assert.That(root.transform.GetChild(0).gameObject.activeSelf, Is.True);
        }
        finally { Object.DestroyImmediate(root); }
    }
    [UnityTest]
    public IEnumerator RejectionsRestoresAndUpdateFaultsNotifyTheirRequestAndSequence()
    {
        var root = new GameObject("UnframePreview");
        try
        {
            var bridge = root.AddComponent<UnframePreview>();
            var events = new List<PresentationPreviewEvent>();
            bridge.Notification += events.Add;
            bridge.Configure("{\"token\":\"preview-token\"}");
            var input = PresentationPreviewTestFixture.Create();
            bridge.Prepare(JsonFormatter.Default.Format(input));
            while (events.Count == 0) yield return null;
            bridge.Commit(input.RequestId);
            var state = new LocalPreviewPlaybackState
            {
                RequestId = input.RequestId,
                Sequence = 1,
                CurrentGroupId = "group:first",
                NodeStates = { input.InitialState.Clone().NodeStates },
                SurfaceStates = { input.InitialState.Clone().SurfaceStates },
                Clock = new RuntimeClockSnapshot { Paused = new Paused() },
            };
            bridge.Playback(JsonFormatter.Default.Format(state));
            state.Sequence = 2; state.CurrentGroupId = "invalid group";
            bridge.Playback(JsonFormatter.Default.Format(state));
            Assert.That(events[3].outcome, Is.EqualTo("rejected"));
            Assert.That(events[3].phase, Is.EqualTo("apply"));
            Assert.That(events[3].sequence, Is.EqualTo("2"));
            state.CurrentGroupId = "group:first";
            state.NodeStates[1].Transform.Position.X = 3;
            bridge.Restore(JsonFormatter.Default.Format(state));
            Assert.That(events[4].kind, Is.EqualTo("restored"));
            Assert.That(events[4].sequence, Is.EqualTo("2"));
            Object.DestroyImmediate(root.GetComponentInChildren<MeshRenderer>(true));
            typeof(UnframePreview).GetMethod("Update", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).Invoke(bridge, null);
            Assert.That(events[5].kind, Is.EqualTo("failed"));
            Assert.That(events[5].outcome, Is.EqualTo("failed"));
            Assert.That(events[5].phase, Is.EqualTo("update"));
            Assert.That(events[5].requestId, Is.EqualTo(input.RequestId));
            Assert.That(events[5].sequence, Is.EqualTo("2"));
            typeof(UnframePreview).GetMethod("Update", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).Invoke(bridge, null);
            Assert.That(events.Count, Is.EqualTo(6), "faulted scenes must not keep updating or notifying");
            state.Sequence = 3;
            bridge.Restore(JsonFormatter.Default.Format(state));
            Assert.That(events[6].outcome, Is.EqualTo("failed"));
            Assert.That(events[6].phase, Is.EqualTo("restore"));
            Assert.That(events[6].requestId, Is.EqualTo(input.RequestId));
            Assert.That(events[6].sequence, Is.EqualTo("3"));
        }
        finally { Object.DestroyImmediate(root); }
    }

}

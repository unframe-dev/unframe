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
}

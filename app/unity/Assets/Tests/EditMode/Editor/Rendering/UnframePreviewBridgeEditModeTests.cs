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
    [Test]
    public void UnconfiguredPreparationRejectsTheMatchingRequestImmediately()
    {
        var root = new GameObject("UnframePreview");
        try
        {
            var bridge = root.AddComponent<UnframePreview>();
            var events = new List<PresentationPreviewEvent>();
            bridge.Notification += events.Add;
            var input = PresentationPreviewTestFixture.Create();
            bridge.Prepare(JsonFormatter.Default.Format(input));
            Assert.That(events.Count, Is.EqualTo(1));
            Assert.That(events[0].kind, Is.EqualTo("failed"));
            Assert.That(events[0].requestId, Is.EqualTo(input.RequestId));
            Assert.That(events[0].message, Is.EqualTo("preview.not-configured"));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void InvalidProtobufPreparationRejectsTheMatchingRequestImmediately()
    {
        var root = new GameObject("UnframePreview");
        try
        {
            var bridge = root.AddComponent<UnframePreview>();
            var events = new List<PresentationPreviewEvent>();
            bridge.Notification += events.Add;
            bridge.Configure("{\"token\":\"preview-token\"}");
            string requestId = new string('a', 32);
            bridge.Prepare("{\"requestId\":\"" + requestId + "\",\"unknownField\":true}");
            Assert.That(events.Count, Is.EqualTo(1));
            Assert.That(events[0].kind, Is.EqualTo("failed"));
            Assert.That(events[0].requestId, Is.EqualTo(requestId));
            Assert.That(events[0].message, Is.EqualTo("preview.input-invalid"));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void PreparationDiagnosticsExcludeConfigurationAndInvalidRequestIdentity()
    {
        var root = new GameObject("UnframePreview");
        var messages = new List<string>();
        Application.LogCallback collect = (message, stack, type) =>
        {
            if (message.StartsWith("[Unity Preview]")) messages.Add(message);
        };
        Application.logMessageReceived += collect;
        try
        {
            var bridge = root.AddComponent<UnframePreview>();
            bridge.Configure("{\"token\":\"secret-preview-token\"}");
            var input = PresentationPreviewTestFixture.Create();
            input.RequestId = "private-presentation-content";
            bridge.Prepare(JsonFormatter.Default.Format(input));
            Assert.That(messages, Is.Not.Empty);
            Assert.That(messages.Exists(message => message.Contains("stage=prepare-failed")), Is.True);
            foreach (string message in messages)
            {
                Assert.That(message, Does.Not.Contain("secret-preview-token"));
                Assert.That(message, Does.Not.Contain("private-presentation-content"));
            }
        }
        finally
        {
            Application.logMessageReceived -= collect;
            Object.DestroyImmediate(root);
        }
    }

    [UnityTest]
    public IEnumerator MalformedPreparationInvalidatesThePreviousPreparedCandidate()
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
            Assert.That(events[0].kind, Is.EqualTo("prepared"));
            bridge.Prepare("{");
            Assert.That(events[1].kind, Is.EqualTo("failed"));
            bridge.Commit(input.RequestId);
            Assert.That(events[2].kind, Is.EqualTo("failed"));
            Assert.That(events[2].message, Is.EqualTo("preview.prepared-request-mismatch"));
            Assert.That(root.transform.childCount, Is.Zero);
        }
        finally { Object.DestroyImmediate(root); }
    }

    [UnityTest]
    public IEnumerator CameraResetLeavesOverheadAndKeepsGuidesHiddenOnTheNextSpatialFrame()
    {
        var root = new GameObject("UnframePreview");
        var cameraObject = new GameObject("Preview Camera");
        var previousMainCameras = new List<Camera>();
        foreach (Camera camera in Object.FindObjectsByType<Camera>(FindObjectsSortMode.None))
        {
            if (!camera.CompareTag("MainCamera")) continue;
            previousMainCameras.Add(camera);
            camera.tag = "Untagged";
        }
        cameraObject.tag = "MainCamera";
        try
        {
            var camera = cameraObject.AddComponent<Camera>();
            var controls = cameraObject.AddComponent<PresentationPreviewCamera>();
            var bridge = root.AddComponent<UnframePreview>();
            var events = new List<PresentationPreviewEvent>();
            bridge.Notification += events.Add;
            bridge.Configure("{\"token\":\"preview-token\"}");
            var input = PresentationPreviewTestFixture.Create();
            bridge.Prepare(JsonFormatter.Default.Format(input));
            while (events.Count == 0) yield return null;
            bridge.Commit(input.RequestId);
            bridge.Playback(JsonFormatter.Default.Format(new LocalPreviewPlaybackState
            {
                RequestId = input.RequestId,
                Sequence = 1,
                CurrentGroupId = "group:first",
                NodeStates = { input.InitialState.NodeStates },
                SurfaceStates = { input.InitialState.SurfaceStates },
                Clock = new RuntimeClockSnapshot { Paused = new Paused() },
            }));
            string spatial = "{\"requestId\":\"" + input.RequestId + "\",\"sequence\":\"1\",\"presenterPosition\":[2,1,3],\"presenterRotation\":[0,0,0,1],\"zones\":[]}";
            bridge.View("overhead");
            bridge.Spatial(spatial);
            Transform guides = root.transform.Find("Preview spatial guides");
            Assert.That(guides.gameObject.activeSelf, Is.True);
            Assert.That(camera.orthographic, Is.True);
            bridge.ResetCamera("");
            Assert.That(controls.IsOverhead, Is.False);
            Assert.That(cameraObject.transform.position, Is.EqualTo(new Vector3(0, 1.6f, -4)));
            Assert.That(Quaternion.Angle(cameraObject.transform.rotation, Quaternion.identity), Is.LessThan(0.001f));
            Assert.That(guides.gameObject.activeSelf, Is.False);
            bridge.Spatial(spatial);
            Assert.That(events[4].kind, Is.EqualTo("spatial"));
            Assert.That(guides.gameObject.activeSelf, Is.False);
            Assert.That(root.transform.Find("Preview floor/Origin marker").gameObject.activeInHierarchy, Is.True);
        }
        finally
        {
            Object.DestroyImmediate(root); Object.DestroyImmediate(cameraObject);
            foreach (Camera camera in previousMainCameras)
                if (camera != null) camera.tag = "MainCamera";
        }
    }

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

    [UnityTest]
    public IEnumerator SpatialAcknowledgesOnlyTheAppliedRequestAndSequenceAndPreservesGuidesOnRejection()
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
            var playback = new LocalPreviewPlaybackState
            {
                RequestId = input.RequestId,
                Sequence = 1,
                CurrentGroupId = "group:first",
                NodeStates = { input.InitialState.NodeStates },
                SurfaceStates = { input.InitialState.SurfaceStates },
                Clock = new RuntimeClockSnapshot { Paused = new Paused() },
            };
            bridge.Playback(JsonFormatter.Default.Format(playback));
            string spatial = "{\"requestId\":\"" + input.RequestId + "\",\"sequence\":\"1\",\"presenterPosition\":[2,1,3],\"presenterRotation\":[0,0,0,1],\"zones\":[]}";
            bridge.View("overhead");
            bridge.Spatial(spatial);
            Assert.That(events[3].kind, Is.EqualTo("spatial"));
            Assert.That(events[3].sequence, Is.EqualTo("1"));
            Transform guides = root.transform.Find("Preview spatial guides");
            Assert.That(guides.gameObject.activeSelf, Is.True);
            Vector3 position = guides.Find("Presenter").localPosition;
            bridge.Spatial(spatial.Replace("\"sequence\":\"1\"", "\"sequence\":\"2\""));
            Assert.That(events[4].outcome, Is.EqualTo("rejected"));
            Assert.That(events[4].phase, Is.EqualTo("spatial"));
            Assert.That(guides.Find("Presenter").localPosition, Is.EqualTo(position));
            bridge.Spatial(spatial.Replace("[2,1,3]", "[2,1]"));
            Assert.That(events[5].message, Is.EqualTo("preview.spatial-input-invalid"));
            Assert.That(guides.Find("Presenter").localPosition, Is.EqualTo(position));
            bridge.Invalidate("");
            Assert.That(guides.gameObject.activeSelf, Is.False);
            bridge.Spatial(spatial);
            Assert.That(events[6].message, Is.EqualTo("preview.spatial-request-mismatch"));
        }
        finally { Object.DestroyImmediate(root); }
    }

}

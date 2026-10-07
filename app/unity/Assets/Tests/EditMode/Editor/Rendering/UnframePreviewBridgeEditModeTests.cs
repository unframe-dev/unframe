using System.Collections;
using System.Collections.Generic;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class UnframePreviewBridgeEditModeTests
{
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

using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;

public sealed class QuestArmMotionDebugViewTests
{
    [Test]
    public void DiagnosticPanelShowsInputFailureNearTheCenterWithoutInterceptingUi()
    {
        var eye = new GameObject("Diagnostic eye", typeof(Camera));
        var host = new GameObject("Diagnostic source");
        try
        {
            var motion = host.AddComponent<QuestLocalArmMotionControls>();
            motion.ProcessFrame(1, new ArmMotionFrame(Vector3.zero, Quaternion.identity, true,
                Vector3.left, true, Vector3.right, true));
            var view = host.AddComponent<QuestArmMotionDebugView>();
            view.Configure(eye.transform, null, motion);
            view.Refresh(true);
            Assert.That(view.DisplayText, Does.Contain("Gate: controls-missing"));
            Assert.That(view.DisplayText, Does.Contain("Frames: 1"));
            Assert.That(view.DisplayText, Does.Contain("Usable pose H:1 L:1 R:1"));
            Assert.That(view.DisplayText, Does.Contain("Held buttons:"));
            Assert.That(view.DisplayText, Does.Contain("Trigger: None | waiting release: no"));
            Assert.That(view.DisplayText, Does.Not.Contain("Still:"));
            Assert.That(view.DisplayText, Does.Contain("Last match #0"));
            Assert.That(view.DisplayText, Does.Not.Contain("Both hands:"));
            Assert.That(view.Panel.transform.parent, Is.EqualTo(eye.transform));
            Assert.That(view.Panel.transform.localPosition.x, Is.InRange(0.1f, 0.3f));
            Assert.That(view.Panel.transform.localPosition.z, Is.InRange(0.9f, 1.2f));
            Assert.That(view.Panel.GetComponent<GraphicRaycaster>(), Is.Null);
            foreach (var graphic in view.Panel.GetComponentsInChildren<Graphic>())
                Assert.That(graphic.raycastTarget, Is.False);
            view.Refresh(false);
            Assert.That(view.Panel.activeSelf, Is.False);
            view.Refresh(true);
            Assert.That(view.Panel.activeSelf, Is.True);
        }
        finally
        {
            Object.DestroyImmediate(host);
            Object.DestroyImmediate(eye);
        }
    }
}

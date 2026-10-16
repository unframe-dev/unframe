using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class PresentationEditorRehearsalTests
{
    [Test]
    public void RehearsalPlaysAllMotionEventsAndRestartReturnsToOpening()
    {
        var host = new GameObject("editor-rehearsal-test");
        try
        {
            var rehearsal = host.AddComponent<PresentationEditorRehearsal>();
            Assert.That(rehearsal.Restart(out string error), Is.True, error);
            var runner = host.GetComponent<LocalPresentationFixtureRunner>();
            Assert.That(runner.ReliableEventCount, Is.EqualTo(25));
            Assert.That(runner.AppliedEventCount, Is.EqualTo(1));
            Assert.That(runner.KeyboardAdvanceEnabled, Is.False);
            for (int i = 1; i < 25; i++)
                Assert.That(rehearsal.Advance(out error), Is.True, error);
            Assert.That(rehearsal.Advance(out error), Is.False);
            Assert.That(runner.AppliedEventCount, Is.EqualTo(25));
            Assert.That(rehearsal.Restart(out error), Is.True, error);
            Assert.That(runner.AppliedEventCount, Is.EqualTo(1));
            Assert.That(runner.Hierarchy.Registry.TryGet("node:main-panel", out GameObject panel), Is.True);
            Assert.That(panel.activeInHierarchy, Is.True);
        }
        finally { Object.DestroyImmediate(host); }
    }
}

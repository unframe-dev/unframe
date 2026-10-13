using System.Reflection;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class QuestPresentationUiControllerTests
{
    [Test]
    public void UiTriggerRemainsConsumedUntilReleaseEvenWhenThePointerLeavesTheButton()
    {
        var eye = new GameObject("UI trigger eye");
        var host = new GameObject("UI trigger test");
        try
        {
            var controller = host.AddComponent<QuestPresentationUiController>();
            controller.Configure(eye.transform, null, null, null, null, null, null, null);
            typeof(QuestPresentationUiController).GetMethod("Awake",
                BindingFlags.Instance | BindingFlags.NonPublic).Invoke(controller, null);
            var view = host.GetComponent<QuestPresentationFlowView>();
            view.Render(controller.Flow.State);
            var audience = view.FindButton("Audience").transform;
            var ray = new Ray(audience.position - audience.forward, audience.forward);
            controller.ProcessPointer(true, ray);
            Assert.That(controller.MotionTriggerConsumed, Is.True);
            Assert.That(controller.Flow.State.Page, Is.EqualTo(PresentationUiPage.RoomCode));
            controller.ProcessPointer(true, null);
            Assert.That(controller.MotionTriggerConsumed, Is.True);
            controller.ProcessPointer(false, null);
            Assert.That(controller.MotionTriggerConsumed, Is.False);
            controller.ProcessPointer(true, new Ray(Vector3.zero, Vector3.back));
            Assert.That(controller.MotionTriggerConsumed, Is.False);
        }
        finally
        {
            Object.DestroyImmediate(host);
            Object.DestroyImmediate(eye);
        }
    }

    [Test]
    public void UiProcessesPointerBeforeDefaultOrderMotionControls()
    {
        var order = typeof(QuestPresentationUiController).GetCustomAttribute<DefaultExecutionOrder>();
        Assert.That(order, Is.Not.Null);
        Assert.That(order.order, Is.LessThan(0));
    }

    [Test]
    public void ExitClearsLoadedFixtureAndReturnsToRoleSelection()
    {
        var host = new GameObject("UI controller test");
        try
        {
            var runner = host.AddComponent<LocalPresentationFixtureRunner>();
            var controller = host.AddComponent<QuestPresentationUiController>();
            controller.Configure(null, null, null, null, null, runner, null, null);
            Assert.That(controller.JoinPreview(PresentationUiRole.Audience, "123456"), Is.True);
            Assert.That(runner.HasLoadedFixture, Is.True);
            Assert.That(controller.Flow.RequestExit(), Is.True);
            controller.LeavePresentation();
            Assert.That(runner.HasLoadedFixture, Is.False);
            Assert.That(controller.Flow.State.Page, Is.EqualTo(PresentationUiPage.RoleSelection));
        }
        finally { Object.DestroyImmediate(host); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void ExitConfirmationOnlyPreservesVisibilityForAnAlreadyStartedPresentation(bool started)
    {
        var host = new GameObject("UI visibility test");
        try
        {
            var runner = host.AddComponent<LocalPresentationFixtureRunner>();
            var binding = host.AddComponent<ArucoPresentationOriginBinding>();
            var controller = host.AddComponent<QuestPresentationUiController>();
            controller.Configure(null, null, null, null, null, runner, null, binding);
            Assert.That(controller.JoinPreview(PresentationUiRole.Audience, "123456"), Is.True);
            Assert.That(controller.Flow.MarkCalibrationComplete(), Is.True);
            if (started) Assert.That(controller.Flow.EnterPresentation(), Is.True);
            Assert.That(controller.Flow.RequestExit(), Is.True);
            typeof(QuestPresentationUiController).GetMethod("Refresh",
                BindingFlags.Instance | BindingFlags.NonPublic).Invoke(controller, null);
            Assert.That(binding.PresentationVisible, Is.EqualTo(started));
            controller.Flow.CancelExit();
            typeof(QuestPresentationUiController).GetMethod("Refresh",
                BindingFlags.Instance | BindingFlags.NonPublic).Invoke(controller, null);
            Assert.That(binding.PresentationVisible, Is.EqualTo(started));
        }
        finally { Object.DestroyImmediate(host); }
    }

    [Test]
    public void AudienceCannotAdvanceLocalFixture()
    {
        var host = new GameObject("UI audience test");
        try
        {
            var runner = host.AddComponent<LocalPresentationFixtureRunner>();
            var controller = host.AddComponent<QuestPresentationUiController>();
            controller.Configure(null, null, null, null, null, runner, null, null);
            controller.JoinPreview(PresentationUiRole.Audience, "123456");
            controller.Flow.MarkCalibrationComplete();
            controller.Flow.EnterPresentation();
            var before = runner.AppliedEventCount;
            controller.AdvancePresentation();
            Assert.That(runner.AppliedEventCount, Is.EqualTo(before));
        }
        finally { Object.DestroyImmediate(host); }
    }
}

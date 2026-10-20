using NUnit.Framework;
using System;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestOnboardingFlowTests
{
    [Test]
    public async Task PresenterStartsBeforeWaitingForFirstFrame()
    {
        bool started = false;
        bool ready = false;
        Assert.That(QuestOnboardingStart.CanAdvance(QuestOnboardingRole.Presenter, true, true, false), Is.True);
        Assert.That(QuestOnboardingStart.CanAdvance(QuestOnboardingRole.Audience, true, true, false), Is.False);
        await QuestOnboardingStart.BeginPresenterAsync(
            () => { started = true; ready = true; return Task.CompletedTask; },
            () => ready, () => true, () => false, () => "Running", () => Task.CompletedTask,
            TimeSpan.FromSeconds(1), CancellationToken.None);
        Assert.That(started, Is.True);
    }

    [Test]
    public async Task PausedPresenterResumesBeforeWaitingForFirstFrame()
    {
        bool resumed = false;
        await QuestOnboardingStart.BeginPresenterAsync(
            () => Task.CompletedTask,
            () => resumed, () => true, () => false, () => "Paused",
            () => { resumed = true; return Task.CompletedTask; },
            TimeSpan.FromSeconds(1), CancellationToken.None);
        Assert.That(resumed, Is.True);
    }

    [Test]
    public async Task PausedPresenterWithExistingFrameStillResumes()
    {
        bool resumed = false;
        await QuestOnboardingStart.BeginPresenterAsync(
            () => Task.CompletedTask,
            () => true, () => true, () => false, () => "Paused",
            () => { resumed = true; return Task.CompletedTask; },
            TimeSpan.FromSeconds(1), CancellationToken.None);
        Assert.That(resumed, Is.True);
    }
    [Test]
    public void RoleRoutesAndBackKeepAudienceOutOfPresentationSelection()
    {
        var flow = new QuestOnboardingFlow();
        flow.SelectRole(QuestOnboardingRole.Audience);
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.RoomCode));
        flow.GoTo(QuestOnboardingPage.Authentication);
        flow.Back();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.RoomCode));
        flow.DebugNext();
        Assert.That(flow.IsDebugPreview, Is.False);
    }

    [Test]
    public void PresenterDebugTraversalIsExplicitlyAPreviewAndResetClearsIt()
    {
        var flow = new QuestOnboardingFlow();
        flow.SelectRole(QuestOnboardingRole.Presenter);
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        for (int i = 0; i < 4; i++) flow.DebugNext();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Ready));
        Assert.That(flow.IsDebugPreview, Is.True);
        flow.Reset();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(flow.IsDebugPreview, Is.False);
    }
}

using NUnit.Framework;
using System;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestOnboardingFlowTests
{
    [Test]
    public void CanceledStartDoesNotSendAStartOrResumeRequest()
    {
        using (var cancellation = new CancellationTokenSource())
        {
            cancellation.Cancel();
            bool started = false, resumed = false;
            Assert.That(async () => await QuestOnboardingStart.BeginPresenterAsync(
                () => { started = true; return Task.CompletedTask; },
                () => true, () => true, () => false, () => "Paused",
                () => { resumed = true; return Task.CompletedTask; },
                TimeSpan.FromSeconds(1), cancellation.Token), Throws.InstanceOf<OperationCanceledException>());
            Assert.That(started, Is.False);
            Assert.That(resumed, Is.False);
        }
    }

    [Test]
    public void CalibrationIsRequiredBeforeEitherRoleCanEnter()
    {
        Assert.That(QuestOnboardingStart.CanAdvance(QuestOnboardingRole.Presenter, false, true, true), Is.False);
        Assert.That(QuestOnboardingStart.CanAdvance(QuestOnboardingRole.Audience, false, true, true), Is.False);
    }

    [Test]
    public void ReturningAuthenticationPreservesRoleAndBackAbandonsTheRoom()
    {
        var flow = new QuestOnboardingFlow();
        flow.SelectRole(QuestOnboardingRole.Audience);
        flow.RequireAuthentication();
        Assert.That(flow.IsReturningToRoom, Is.True);
        Assert.That(flow.Role, Is.EqualTo(QuestOnboardingRole.Audience));
        flow.Back();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(flow.IsReturningToRoom, Is.False);
    }

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
            () => resumed, () => true, () => false, () => resumed ? "Running" : "Paused",
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
            () => true, () => true, () => false, () => resumed ? "Running" : "Paused",
            () => { resumed = true; return Task.CompletedTask; },
            TimeSpan.FromSeconds(1), CancellationToken.None);
        Assert.That(resumed, Is.True);
    }

    [Test]
    public async Task PausedReadyFrameAndCompletedWriteDoNotFinishPresenterStart()
    {
        string playback = "Paused";
        bool wroteResume = false;
        Task begin = QuestOnboardingStart.BeginPresenterAsync(
            () => Task.CompletedTask, () => true, () => true, () => false, () => playback,
            () => { wroteResume = true; return Task.CompletedTask; }, TimeSpan.FromSeconds(2), CancellationToken.None);
        await Task.Delay(150);
        Assert.That(wroteResume, Is.True);
        Assert.That(begin.IsCompleted, Is.False, "A paused Snapshot and a successful transport write are not proof that playback started.");
        playback = "Running";
        await begin;
    }

    [Test]
    public async Task PresenterStartTimesOutWhenAcceptedResumeDoesNotReachRunning()
    {
        Exception failure = null;
        try
        {
            await QuestOnboardingStart.BeginPresenterAsync(
            () => Task.CompletedTask, () => true, () => true, () => false, () => "Paused",
            () => Task.CompletedTask, TimeSpan.FromMilliseconds(30), CancellationToken.None);
        }
        catch (Exception exception) { failure = exception; }
        Assert.That(failure, Is.TypeOf<InvalidOperationException>());
    }

    [Test]
    public void PresenterStartPropagatesRejectedResumeEvenWithAnExistingReadyFrame()
    {
        var rejection = new InvalidOperationException("command-rejected");
        Assert.That(Assert.ThrowsAsync<InvalidOperationException>(async () => await QuestOnboardingStart.BeginPresenterAsync(
            () => Task.CompletedTask, () => true, () => true, () => false, () => "Paused",
            () => Task.FromException(rejection), TimeSpan.FromSeconds(1), CancellationToken.None)), Is.SameAs(rejection));
    }

    [Test]
    public void AFailedConnectionCannotCompletePresenterStartFromAnOldReadyFrame()
    {
        Assert.ThrowsAsync<InvalidOperationException>(async () => await QuestOnboardingStart.BeginPresenterAsync(
            () => Task.CompletedTask, () => true, () => true, () => true, () => "Running",
            () => Task.CompletedTask, TimeSpan.FromSeconds(1), CancellationToken.None));
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
    }

    [Test]
    public void ResetReturnsPresenterToRoleSelection()
    {
        var flow = new QuestOnboardingFlow();
        flow.SelectRole(QuestOnboardingRole.Presenter);
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        flow.GoTo(QuestOnboardingPage.Ready);
        flow.Reset();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(flow.Role, Is.EqualTo(QuestOnboardingRole.None));
    }
}

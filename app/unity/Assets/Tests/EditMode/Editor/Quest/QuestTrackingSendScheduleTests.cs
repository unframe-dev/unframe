using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestTrackingSendScheduleTests
{
    [Test]
    public void PositionRequestsAdvanceTheExistingFrameAndCoalesceAcrossHandsAndGestures()
    {
        var schedule = new QuestTrackingSendSchedule();
        Assert.That(schedule.TryBeginFrame(1, true, false), Is.True);
        for (int i = 0; i < 4; i++) schedule.RequestPositionSample();
        Assert.That(schedule.TryBeginFrame(1.02, true, false), Is.True);
        Assert.That(schedule.TryBeginFrame(1.02, true, false), Is.False);
        Assert.That(schedule.TryBeginFrame(1.101, true, false), Is.False);
        Assert.That(schedule.TryBeginFrame(1.121, true, false), Is.True);
    }
    [Test]
    public void RequestsDuringAnInFlightSendAreDroppedInsteadOfReplayed()
    {
        var schedule = new QuestTrackingSendSchedule();
        Assert.That(schedule.TryBeginFrame(1, true, false), Is.True);
        schedule.RequestPositionSample();
        Assert.That(schedule.TryBeginFrame(1.02, true, true), Is.False);
        Assert.That(schedule.TryBeginFrame(1.03, true, false), Is.False);
        Assert.That(schedule.TryBeginFrame(1.11, true, false), Is.True);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void InvalidatedRequestsCannotSurviveReadinessLossOrExplicitReset(bool reset)
    {
        var schedule = new QuestTrackingSendSchedule();
        schedule.TryBeginFrame(1, true, false);
        schedule.RequestPositionSample();
        if (reset) schedule.DiscardRequests();
        else Assert.That(schedule.TryBeginFrame(1.02, false, false), Is.False);
        Assert.That(schedule.TryBeginFrame(1.03, true, false), Is.False);
        Assert.That(schedule.TryBeginFrame(1.11, true, false), Is.True);
    }

    [Test]
    public void FasterPositionRequestsNeverExceedTheRealtimeRollingSecondLimit()
    {
        var schedule = new QuestTrackingSendSchedule();
        var sent = new System.Collections.Generic.List<double>();
        for (int millisecond = 0; millisecond < 3000; millisecond++)
        {
            double now = millisecond / 1000d;
            schedule.RequestPositionSample();
            if (schedule.TryBeginFrame(now, true, false)) sent.Add(now);
            int count = sent.FindAll(time => time > now - 1).Count;
            Assert.That(count, Is.LessThanOrEqualTo(90));
        }
        Assert.That(sent.Count, Is.GreaterThan(200));
        Assert.That(schedule.TryBeginFrame(3.1, true, false), Is.True);
    }

    [Test]
    public void RequestsInsideTheFrameRateLimitAreNotQueued()
    {
        var schedule = new QuestTrackingSendSchedule();
        schedule.TryBeginFrame(1, true, false);
        schedule.RequestPositionSample();
        Assert.That(schedule.TryBeginFrame(1.001, true, false), Is.False);
        Assert.That(schedule.TryBeginFrame(1.02, true, false), Is.False);
    }
}

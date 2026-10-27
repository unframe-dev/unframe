using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestPresentationUiStateTests
{
    [TestCase("Unknown", false, false)]
    [TestCase("Running", false, true)]
    [TestCase("Paused", true, false)]
    [TestCase("Ended", false, false)]
    public void PlaybackActionsFollowAuthoritativeState(string playback, bool resume, bool pause)
    {
        var state = new QuestPresentationUiState(false, true, true, playback);
        Assert.That(state.CanResume, Is.EqualTo(resume));
        Assert.That(state.CanPause, Is.EqualTo(pause));
    }

    [Test]
    public void AudienceAndViewerCannotControlPlayback()
    {
        Assert.That(new QuestPresentationUiState(true, true, true, "Running").CanPause, Is.False);
        Assert.That(new QuestPresentationUiState(false, false, true, "Running").CanPause, Is.False);
        Assert.That(new QuestPresentationUiState(false, true, false, "Paused").CanResume, Is.False);
    }

    [TestCase("None", false)]
    [TestCase("Unknown", false)]
    [TestCase("Paused", true)]
    [TestCase("Ended", false)]
    public void StartRequiresAnAuthoritativePausedClock(string playback, bool expected)
    {
        Assert.That(new QuestPresentationUiState(false, true, true, playback).CanStart, Is.EqualTo(expected));
    }
}

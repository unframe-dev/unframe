using NUnit.Framework;

public sealed class ArucoDetectionMetricsTests
{
    [Test]
    public void CompletionKeepsEveryDurationAndCountsEveryOutcomeSeparately()
    {
        var metrics = new ArucoDetectionMetrics();
        var timings = new ArucoDetectionTimings(30, 4, 6, 45, 8, 115);
        foreach (var outcome in new[] { ArucoDetectionOutcome.Accepted, ArucoDetectionOutcome.TimedOut,
            ArucoDetectionOutcome.Invalidated, ArucoDetectionOutcome.Failed })
        {
            metrics.Begin();
            metrics.Complete(outcome, timings);
        }
        Assert.That(metrics.Requests, Is.EqualTo(4));
        Assert.That(metrics.Accepted, Is.EqualTo(1));
        Assert.That(metrics.TimedOut, Is.EqualTo(1));
        Assert.That(metrics.Invalidated, Is.EqualTo(1));
        Assert.That(metrics.Failed, Is.EqualTo(1));
        Assert.That(metrics.LastOutcome, Is.EqualTo(ArucoDetectionOutcome.Failed));
        Assert.That(metrics.LastTimings.ReadbackMilliseconds, Is.EqualTo(30));
        Assert.That(metrics.LastTimings.CopyMilliseconds, Is.EqualTo(4));
        Assert.That(metrics.LastTimings.PreprocessingMilliseconds, Is.EqualTo(6));
        Assert.That(metrics.LastTimings.DetectionMilliseconds, Is.EqualTo(45));
        Assert.That(metrics.LastTimings.PoseMilliseconds, Is.EqualTo(8));
        Assert.That(metrics.LastTimings.TotalMilliseconds, Is.EqualTo(115));
    }
}

using NUnit.Framework;

public sealed class PassthroughCameraPreviewHealthTests
{
    [Test]
    public void ReportsStalledWhenCameraNeverDeliversAFrame()
    {
        var health = new PassthroughCameraPreviewHealth();
        health.Reset(100);
        Assert.That(health.GetState(109), Is.EqualTo(PassthroughCameraFeedState.Waiting));
        Assert.That(health.GetState(111), Is.EqualTo(PassthroughCameraFeedState.Stalled));
    }

    [Test]
    public void FrozenTextureDoesNotCountAsNewFrames()
    {
        var health = new PassthroughCameraPreviewHealth();
        health.Reset(100);
        Assert.That(health.ObserveFrame(1000, 101), Is.True);
        Assert.That(health.ObserveFrame(1000, 104), Is.False);
        Assert.That(health.ObserveFrame(999, 104), Is.False);
        Assert.That(health.FrameCount, Is.EqualTo(1));
        Assert.That(health.GetState(104), Is.EqualTo(PassthroughCameraFeedState.Stalled));
    }

    [Test]
    public void RecoversWhenFramesResume()
    {
        var health = new PassthroughCameraPreviewHealth();
        health.Reset(0);
        health.ObserveFrame(1000, 1);
        Assert.That(health.GetState(4), Is.EqualTo(PassthroughCameraFeedState.Stalled));
        health.ObserveFrame(2000, 4);
        Assert.That(health.GetState(4), Is.EqualTo(PassthroughCameraFeedState.Live));
    }

    [Test]
    public void RestartInvalidatesThePreviousFeed()
    {
        var health = new PassthroughCameraPreviewHealth();
        health.Reset(0);
        health.ObserveFrame(1000, 1);
        health.Reset(10);
        Assert.That(health.FrameCount, Is.Zero);
        Assert.That(health.GetState(10), Is.EqualTo(PassthroughCameraFeedState.Waiting));
        Assert.That(health.ObserveFrame(1000, 11), Is.True);
    }

    [Test]
    public void RejectsUninitializedCameraTimestamps()
    {
        var health = new PassthroughCameraPreviewHealth();
        health.Reset(0);
        Assert.That(health.ObserveFrame(0, 1), Is.False);
        Assert.That(health.FrameCount, Is.Zero);
    }
}

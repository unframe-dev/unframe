public enum PassthroughCameraFeedState
{
    Waiting,
    Live,
    Stalled
}

public sealed class PassthroughCameraPreviewHealth
{
    private double startedAt;
    private double lastFrameAt;
    private long lastCaptureTimestamp;

    public int FrameCount { get; private set; }

    public void Reset(double now)
    {
        startedAt = now;
        lastFrameAt = now;
        lastCaptureTimestamp = 0;
        FrameCount = 0;
    }

    public bool ObserveFrame(long captureTimestampTicks, double now)
    {
        if (captureTimestampTicks <= lastCaptureTimestamp)
        {
            return false;
        }

        lastCaptureTimestamp = captureTimestampTicks;
        lastFrameAt = now;
        FrameCount++;
        return true;
    }

    public PassthroughCameraFeedState GetState(double now)
    {
        if (FrameCount == 0)
        {
            return now - startedAt < 10 ? PassthroughCameraFeedState.Waiting : PassthroughCameraFeedState.Stalled;
        }

        return now - lastFrameAt < 2 ? PassthroughCameraFeedState.Live : PassthroughCameraFeedState.Stalled;
    }
}

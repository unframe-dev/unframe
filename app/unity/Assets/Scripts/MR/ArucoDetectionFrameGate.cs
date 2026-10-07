public sealed class ArucoDetectionFrameGate
{
    private long lastTimestamp;
    private double nextAt;
    public bool Busy { get; private set; }
    public int Generation { get; private set; }

    public bool TryBegin(long timestamp, double now, out int generation)
    {
        generation = Generation;
        if (Busy || timestamp <= lastTimestamp || now < nextAt) return false;
        Busy = true;
        lastTimestamp = timestamp;
        nextAt = now + 0.2;
        return true;
    }

    public void Invalidate()
    {
        Generation++;
        lastTimestamp = 0;
        nextAt = 0;
    }

    public bool Complete(int generation)
    {
        Busy = false;
        return generation == Generation;
    }
}

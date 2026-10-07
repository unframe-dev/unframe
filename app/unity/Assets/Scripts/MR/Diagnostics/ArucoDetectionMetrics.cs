public enum ArucoDetectionPhase { Idle, Readback, Processing }
public enum ArucoDetectionOutcome { None, Accepted, TimedOut, Invalidated, Failed }

public readonly struct ArucoDetectionTimings
{
    public double ReadbackMilliseconds { get; }
    public double CopyMilliseconds { get; }
    public double PreprocessingMilliseconds { get; }
    public double DetectionMilliseconds { get; }
    public double PoseMilliseconds { get; }
    public double TotalMilliseconds { get; }

    public ArucoDetectionTimings(double readback, double copy, double preprocessing,
        double detection, double pose, double total)
    {
        ReadbackMilliseconds = readback;
        CopyMilliseconds = copy;
        PreprocessingMilliseconds = preprocessing;
        DetectionMilliseconds = detection;
        PoseMilliseconds = pose;
        TotalMilliseconds = total;
    }
}

public sealed class ArucoDetectionMetrics
{
    public int Requests { get; private set; }
    public int Accepted { get; private set; }
    public int TimedOut { get; private set; }
    public int Invalidated { get; private set; }
    public int Failed { get; private set; }
    public ArucoDetectionOutcome LastOutcome { get; private set; }
    public ArucoDetectionTimings LastTimings { get; private set; }

    public void Begin() => Requests++;
    public void Complete(ArucoDetectionOutcome outcome, ArucoDetectionTimings timings)
    {
        LastOutcome = outcome;
        LastTimings = timings;
        switch (outcome)
        {
            case ArucoDetectionOutcome.Accepted: Accepted++; break;
            case ArucoDetectionOutcome.TimedOut: TimedOut++; break;
            case ArucoDetectionOutcome.Invalidated: Invalidated++; break;
            case ArucoDetectionOutcome.Failed: Failed++; break;
        }
    }
}

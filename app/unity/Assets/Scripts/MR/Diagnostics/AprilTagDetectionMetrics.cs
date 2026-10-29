public enum AprilTagDetectionPhase { Idle, Readback, Processing }
public enum AprilTagDetectionOutcome { None, Accepted, TimedOut, Invalidated, Failed }

public readonly struct AprilTagDetectionTimings
{
    public double ReadbackMilliseconds { get; }
    public double CopyMilliseconds { get; }
    public double PreprocessingMilliseconds { get; }
    public double DetectionMilliseconds { get; }
    public double PoseMilliseconds { get; }
    public double TotalMilliseconds { get; }

    public AprilTagDetectionTimings(double readback, double copy, double preprocessing,
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

public sealed class AprilTagDetectionMetrics
{
    public int Requests { get; private set; }
    public int Accepted { get; private set; }
    public int TimedOut { get; private set; }
    public int Invalidated { get; private set; }
    public int Failed { get; private set; }
    public AprilTagDetectionOutcome LastOutcome { get; private set; }
    public AprilTagDetectionTimings LastTimings { get; private set; }

    public void Begin() => Requests++;
    public void Complete(AprilTagDetectionOutcome outcome, AprilTagDetectionTimings timings)
    {
        LastOutcome = outcome;
        LastTimings = timings;
        switch (outcome)
        {
            case AprilTagDetectionOutcome.Accepted: Accepted++; break;
            case AprilTagDetectionOutcome.TimedOut: TimedOut++; break;
            case AprilTagDetectionOutcome.Invalidated: Invalidated++; break;
            case AprilTagDetectionOutcome.Failed: Failed++; break;
        }
    }
}

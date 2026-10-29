public enum AprilTagCameraAction
{
    None,
    Start,
    Stop,
    Defer
}

public sealed class AprilTagCameraSessionState
{
    public bool Active { get; set; }
    public bool Supported { get; set; }
    public bool PermissionGranted { get; set; }
    public bool Paused { get; set; }
    public bool TrackingAvailable { get; set; }
    public bool AlignmentConfirmed { get; set; }
    public bool CanRequestPermission => Active && Supported && !Paused;
    public bool CanStartAlignment => CanRequestPermission && PermissionGranted && TrackingAvailable;
    public bool ShouldRunCamera => CanStartAlignment && !AlignmentConfirmed;
    public AprilTagCameraAction GetAction(bool cameraEnabled, bool restart = false)
    {
        // MRUK retains the paused camera's restart state until its resume callback runs.
        if (Paused) return AprilTagCameraAction.Defer;
        if (!ShouldRunCamera) return cameraEnabled ? AprilTagCameraAction.Stop : AprilTagCameraAction.None;
        return restart || !cameraEnabled ? AprilTagCameraAction.Start : AprilTagCameraAction.None;
    }
}

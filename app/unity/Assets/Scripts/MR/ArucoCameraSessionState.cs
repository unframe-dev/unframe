public enum ArucoCameraAction
{
    None,
    Start,
    Stop,
    Defer
}

public sealed class ArucoCameraSessionState
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
    public ArucoCameraAction GetAction(bool cameraEnabled, bool restart = false)
    {
        // MRUK retains the paused camera's restart state until its resume callback runs.
        if (Paused) return ArucoCameraAction.Defer;
        if (!ShouldRunCamera) return cameraEnabled ? ArucoCameraAction.Stop : ArucoCameraAction.None;
        return restart || !cameraEnabled ? ArucoCameraAction.Start : ArucoCameraAction.None;
    }
}

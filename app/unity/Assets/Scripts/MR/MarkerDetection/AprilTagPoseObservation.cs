public sealed class AprilTagPoseObservation
{
    public AprilTagMarkerDetectionFrame Frame { get; }
    public AprilTagMarkerPoseEstimate Estimate { get; }
    public AprilTagCameraGeometry Geometry { get; }

    public AprilTagPoseObservation(AprilTagMarkerDetectionFrame frame, AprilTagMarkerPoseEstimate estimate, AprilTagCameraGeometry geometry)
    {
        Frame = frame;
        Estimate = estimate;
        Geometry = geometry;
    }
}

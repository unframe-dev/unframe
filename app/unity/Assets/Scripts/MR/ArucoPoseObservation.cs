public sealed class ArucoPoseObservation
{
    public ArucoMarkerDetectionFrame Frame { get; }
    public ArucoMarkerPoseEstimate Estimate { get; }
    public ArucoCameraGeometry Geometry { get; }

    public ArucoPoseObservation(ArucoMarkerDetectionFrame frame, ArucoMarkerPoseEstimate estimate, ArucoCameraGeometry geometry)
    {
        Frame = frame;
        Estimate = estimate;
        Geometry = geometry;
    }
}

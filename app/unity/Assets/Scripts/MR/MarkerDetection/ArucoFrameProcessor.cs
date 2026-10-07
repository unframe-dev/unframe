using System;
using System.Diagnostics;
#if UNFRAME_OPENCV_FOR_UNITY
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ImgprocModule;
#endif

#if UNFRAME_OPENCV_FOR_UNITY
public interface IArucoFrameProcessor : IDisposable
{
    ArucoFrameProcessingResult Process(Mat rgba, long timestamp, ArucoCameraGeometry geometry);
}

#endif

public sealed class ArucoFrameProcessingResult
{
    public ArucoMarkerDetectionFrame Frame { get; }
    public ArucoMarkerPoseEstimate Estimate { get; }
    public double PreprocessingMilliseconds { get; }
    public double PoseMilliseconds { get; }

    public ArucoFrameProcessingResult(ArucoMarkerDetectionFrame frame, ArucoMarkerPoseEstimate estimate,
        double preprocessingMilliseconds, double poseMilliseconds)
    {
        Frame = frame;
        Estimate = estimate;
        PreprocessingMilliseconds = preprocessingMilliseconds;
        PoseMilliseconds = poseMilliseconds;
    }
}

#if UNFRAME_OPENCV_FOR_UNITY
public sealed class ArucoFrameProcessor : IArucoFrameProcessor
{
    private readonly ArucoMarkerDetector detector = new ArucoMarkerDetector();
    private readonly ArucoMarkerPoseEstimator poseEstimator = new ArucoMarkerPoseEstimator();
    private readonly Mat gray = new Mat();

    public ArucoFrameProcessingResult Process(Mat rgba, long timestamp, ArucoCameraGeometry geometry)
    {
        var clock = Stopwatch.StartNew();
        // GPU pixels use Unity's lower-left origin; OpenCV corners use the upper-left origin.
        Core.flip(rgba, rgba, 0);
        Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY);
        double preprocessing = clock.Elapsed.TotalMilliseconds;
        var frame = detector.Detect(gray, timestamp);
        clock.Restart();
        ArucoMarkerPoseEstimate estimate = null;
        int index = Array.IndexOf(frame.MarkerIds, ArucoMarkerPoseEstimator.TargetMarkerId);
        if (index >= 0)
        {
            estimate = poseEstimator.Estimate(frame.CornersPixels, index * 8, geometry.Fx, geometry.Fy, geometry.Cx, geometry.Cy);
            if (estimate.IsValid && !CornersInsideImage(frame, index))
                estimate = new ArucoMarkerPoseEstimate(false, "marker near image edge", estimate.CameraPose,
                    estimate.ReprojectionErrorPixels, estimate.AlternativeReprojectionErrorPixels, estimate.CandidateCount);
        }
        return new ArucoFrameProcessingResult(frame, estimate, preprocessing, clock.Elapsed.TotalMilliseconds);
    }

    private static bool CornersInsideImage(ArucoMarkerDetectionFrame frame, int marker)
    {
        for (int i = marker * 8; i < marker * 8 + 8; i += 2)
            if (frame.CornersPixels[i] < 3 || frame.CornersPixels[i] > frame.Resolution.x - 3
                || frame.CornersPixels[i + 1] < 3 || frame.CornersPixels[i + 1] > frame.Resolution.y - 3) return false;
        return true;
    }

    public void Dispose()
    {
        detector.Dispose();
        gray.Dispose();
    }
}
#endif

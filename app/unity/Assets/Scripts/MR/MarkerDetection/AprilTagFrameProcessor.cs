using System;
using System.Diagnostics;
#if UNFRAME_OPENCV_FOR_UNITY
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ImgprocModule;
#endif

#if UNFRAME_OPENCV_FOR_UNITY
public interface IAprilTagFrameProcessor : IDisposable
{
    AprilTagFrameProcessingResult Process(Mat rgba, long timestamp, AprilTagCameraGeometry geometry);
}

#endif

public sealed class AprilTagFrameProcessingResult
{
    public AprilTagMarkerDetectionFrame Frame { get; }
    public AprilTagMarkerPoseEstimate Estimate { get; }
    public double PreprocessingMilliseconds { get; }
    public double PoseMilliseconds { get; }

    public AprilTagFrameProcessingResult(AprilTagMarkerDetectionFrame frame, AprilTagMarkerPoseEstimate estimate,
        double preprocessingMilliseconds, double poseMilliseconds)
    {
        Frame = frame;
        Estimate = estimate;
        PreprocessingMilliseconds = preprocessingMilliseconds;
        PoseMilliseconds = poseMilliseconds;
    }
}

#if UNFRAME_OPENCV_FOR_UNITY
public sealed class AprilTagFrameProcessor : IAprilTagFrameProcessor
{
    private readonly AprilTagMarkerDetector detector = new AprilTagMarkerDetector();
    private readonly AprilTagMarkerPoseEstimator poseEstimator;
    private readonly Mat gray = new Mat();

    public AprilTagFrameProcessor(int markerSizeMillimeters = 150)
    {
        poseEstimator = new AprilTagMarkerPoseEstimator(markerSizeMillimeters);
    }

    public AprilTagFrameProcessingResult Process(Mat rgba, long timestamp, AprilTagCameraGeometry geometry)
    {
        var clock = Stopwatch.StartNew();
        // GPU pixels use Unity's lower-left origin; OpenCV corners use the upper-left origin.
        Core.flip(rgba, rgba, 0);
        Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY);
        double preprocessing = clock.Elapsed.TotalMilliseconds;
        var frame = detector.Detect(gray, timestamp);
        clock.Restart();
        AprilTagMarkerPoseEstimate estimate = null;
        int index = Array.IndexOf(frame.MarkerIds, AprilTagMarkerPoseEstimator.TargetMarkerId);
        if (index >= 0)
        {
            estimate = poseEstimator.Estimate(frame.CornersPixels, index * 8, geometry.Fx, geometry.Fy, geometry.Cx, geometry.Cy);
            if (estimate.IsValid && !CornersInsideImage(frame, index))
                estimate = new AprilTagMarkerPoseEstimate(false, "marker near image edge", estimate.CameraPose,
                    estimate.ReprojectionErrorPixels, estimate.AlternativeReprojectionErrorPixels, estimate.CandidateCount);
        }
        return new AprilTagFrameProcessingResult(frame, estimate, preprocessing, clock.Elapsed.TotalMilliseconds);
    }

    private static bool CornersInsideImage(AprilTagMarkerDetectionFrame frame, int marker)
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

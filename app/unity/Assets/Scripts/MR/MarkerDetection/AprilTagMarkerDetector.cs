using UnityEngine;
#if UNFRAME_OPENCV_FOR_UNITY
using System;
using System.Collections.Generic;
using Stopwatch = System.Diagnostics.Stopwatch;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ObjdetectModule;
#endif

public sealed class AprilTagMarkerDetectionFrame
{
    public long CaptureTimestampTicks { get; }
    public Vector2Int Resolution { get; }
    public int[] MarkerIds { get; }
    public float[] CornersPixels { get; }
    public double ProcessingMilliseconds { get; }

    public AprilTagMarkerDetectionFrame(long timestamp, Vector2Int resolution, int[] ids, float[] corners, double milliseconds)
    {
        CaptureTimestampTicks = timestamp;
        Resolution = resolution;
        MarkerIds = ids;
        CornersPixels = corners;
        ProcessingMilliseconds = milliseconds;
    }
}

public sealed class AprilTagMarkerDetector
#if UNFRAME_OPENCV_FOR_UNITY
    : IDisposable
#endif
{
    public const string DictionaryName = "DICT_APRILTAG_36h11";
#if UNFRAME_OPENCV_FOR_UNITY
    private readonly Dictionary dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_APRILTAG_36h11);
    private readonly DetectorParameters parameters = new DetectorParameters();
    private readonly ArucoDetector detector;
    private readonly Mat ids = new Mat();
    private readonly List<Mat> corners = new List<Mat>();
    private bool disposed;

    public AprilTagMarkerDetector()
    {
        parameters.set_cornerRefinementMethod(Objdetect.CORNER_REFINE_SUBPIX);
        detector = new ArucoDetector(dictionary, parameters);
    }

    public AprilTagMarkerDetectionFrame Detect(Mat grayscale, long timestamp)
    {
        if (disposed) throw new ObjectDisposedException(nameof(AprilTagMarkerDetector));
        if (grayscale == null || grayscale.empty() || grayscale.type() != CvType.CV_8UC1)
            throw new ArgumentException("A non-empty 8-bit grayscale image is required.", nameof(grayscale));
        if (timestamp <= 0) throw new ArgumentOutOfRangeException(nameof(timestamp));
        var watch = Stopwatch.StartNew();
        try
        {
            detector.detectMarkers(grayscale, corners, ids);
            var markerIds = new int[(int)ids.total()];
            var pixels = new float[markerIds.Length * 8];
            if (markerIds.Length > 0) ids.get(0, 0, markerIds);
            var quad = new float[8];
            for (int i = 0; i < markerIds.Length; i++)
            {
                corners[i].get(0, 0, quad);
                // OpenCV's AprilTag dictionary is rotated 180 degrees from the Audience print convention.
                for (int corner = 0; corner < 4; corner++)
                {
                    int source = (corner + 2) % 4 * 2;
                    pixels[i * 8 + corner * 2] = quad[source];
                    pixels[i * 8 + corner * 2 + 1] = quad[source + 1];
                }
            }
            return new AprilTagMarkerDetectionFrame(timestamp, new Vector2Int(grayscale.cols(), grayscale.rows()),
                markerIds, pixels, watch.Elapsed.TotalMilliseconds);
        }
        finally
        {
            foreach (Mat corner in corners) corner.Dispose();
            corners.Clear();
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        detector.Dispose();
        parameters.Dispose();
        dictionary.Dispose();
        ids.Dispose();
    }
#endif
}

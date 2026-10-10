#if !UNFRAME_OPENCV_FOR_UNITY
using NUnit.Framework;
using UnityEngine;

public sealed class ArucoOptionalBackendTests
{
    [Test]
    public void MissingBackendShowsSetupRequirementAndNeverProducesAnObservation()
    {
        var host = new GameObject("ArUco Without Optional Backend");
        var texture = new Texture2D(2, 2);
        try
        {
            var detection = host.AddComponent<ArucoCameraMarkerDetection>();
            StringAssert.Contains("DISABLED", detection.Summary);
            StringAssert.Contains("OpenCV for Unity", detection.Summary);
            StringAssert.Contains("UNFRAME_OPENCV_FOR_UNITY", detection.Summary);
            detection.SubmitFrame(texture, 1, new ArucoCameraGeometry(1, 1, 1, 1, Pose.identity));
            Assert.That(detection.IsProcessing, Is.False);
            Assert.That(detection.ProcessedFrames, Is.Zero);
            Assert.That(detection.Metrics.Requests, Is.Zero);
            Assert.That(detection.CurrentFrame, Is.Null);
            Assert.That(detection.CurrentObservation, Is.Null);
            detection.ClearFeed();
            detection.DrainReadbackBeforeCameraStops();
            StringAssert.Contains("DISABLED", detection.Summary);
        }
        finally
        {
            Object.DestroyImmediate(texture);
            Object.DestroyImmediate(host);
        }
    }
}
#endif

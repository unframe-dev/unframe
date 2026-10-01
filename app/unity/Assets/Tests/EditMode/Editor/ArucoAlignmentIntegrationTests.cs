using System.Collections;
using NUnit.Framework;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ObjdetectModule;
using OpenCVForUnity.UnityIntegration;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class ArucoAlignmentIntegrationTests
{
    [UnityTest]
    public IEnumerator FullResolutionSnapshotProducesPoseAndDropsClearedWork()
    {
        if (!SystemInfo.supportsAsyncGPUReadback) Assert.Ignore("Run with a graphics device; omit -nographics.");
        var host = new GameObject("Detection Integration Test");
        var detection = host.AddComponent<ArucoCameraMarkerDetection>();
        var texture = new Texture2D(1280, 960, TextureFormat.RGBA32, false, true);
        try
        {
            using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50))
            using (var marker = new Mat())
            using (var image = new Mat(960, 1280, CvType.CV_8UC1, new Scalar(255)))
            {
                Objdetect.generateImageMarker(dictionary, 0, 320, marker, 1);
                using (var roi = image.submat(280, 600, 440, 760)) marker.copyTo(roi);
                OpenCVMatUnityUtils.MatToTexture2D(image, texture);
            }
            var geometry = new ArucoCameraGeometry(960, 960, 640, 480, Pose.identity);
            detection.SubmitFrame(texture, 1, geometry);
            double deadline = Time.realtimeSinceStartupAsDouble + 5;
            while (detection.ProcessedFrames == 0 && Time.realtimeSinceStartupAsDouble < deadline) yield return null;
            Assert.That(detection.ProcessedFrames, Is.EqualTo(1), detection.Summary);
            Assert.That(detection.CurrentFrame.Resolution, Is.EqualTo(new Vector2Int(1280, 960)));
            Assert.That(detection.CurrentFrame.CornersPixels[0], Is.EqualTo(440).Within(2));
            Assert.That(detection.CurrentFrame.CornersPixels[1], Is.EqualTo(280).Within(2));
            Assert.That(detection.CurrentObservation.Estimate.IsValid, Is.True, detection.CurrentObservation.Estimate.RejectionReason);
            Assert.That(detection.CurrentObservation.Estimate.CameraPose.position.z, Is.EqualTo(0.6).Within(0.01));
            detection.ClearFeed();
            detection.SubmitFrame(texture, 2, geometry);
            detection.DrainReadbackBeforeCameraStops();
            for (int i = 0; i < 5; i++) yield return null;
            Assert.That(detection.CurrentObservation, Is.Null);
            Assert.That(detection.ProcessedFrames, Is.EqualTo(1));
        }
        finally
        {
            detection.DrainReadbackBeforeCameraStops();
            Object.DestroyImmediate(host);
            Object.DestroyImmediate(texture);
        }
    }

    [UnityTest]
    public IEnumerator ConfirmedOriginIsVisibleAndResetHidesIt()
    {
        var host = new GameObject("Origin Integration Test");
        var alignment = host.AddComponent<ArucoOriginAlignment>();
        try
        {
            yield return null;
            var expected = new Pose(new Vector3(1, 2, 3), Quaternion.Euler(10, 20, 30));
            for (int i = 0; i < 8; i++)
            {
                var frame = new ArucoMarkerDetectionFrame(i + 1, new Vector2Int(640, 480), new[] { 0 }, new float[8], 1);
                var estimate = new ArucoMarkerPoseEstimate(true, null, expected, 0.1, 1, 2);
                alignment.Observe(new ArucoPoseObservation(frame, estimate, new ArucoCameraGeometry(450, 450, 320, 240, Pose.identity)), i * 0.2);
            }
            Assert.That(alignment.IsConfirmed, Is.True);
            var origin = GameObject.Find("ArUco ID 0 Origin (20 cm)");
            Assert.That(origin, Is.Not.Null);
            Assert.That(Vector3.Distance(origin.transform.position, expected.position), Is.LessThan(0.001));
            int resetEvents = 0;
            alignment.ResetRequested += () => resetEvents++;
            alignment.ResetAlignment("Test realignment");
            Assert.That(alignment.IsConfirmed, Is.False);
            Assert.That(origin.activeSelf, Is.False);
            Assert.That(resetEvents, Is.EqualTo(1));
        }
        finally { Object.DestroyImmediate(host); }
        yield return null;
    }
}

#if UNFRAME_OPENCV_FOR_UNITY
using System;
using System.IO;
using System.Xml.Linq;
using NUnit.Framework;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ObjdetectModule;
using UnityEngine;

public sealed class ArucoMarkerDetectorTests
{
    [TestCase(0)]
    [TestCase(23)]
    [TestCase(586)]
    public void DetectsGeneratedMarkerIdAndCornersInTopLeftPixelCoordinates(int id)
    {
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_APRILTAG_36h11))
        using (var marker = new Mat())
        using (var image = new Mat(320, 400, CvType.CV_8UC1, new Scalar(255)))
        using (var detector = new ArucoMarkerDetector())
        {
            Objdetect.generateImageMarker(dictionary, id, 160, marker, 1);
            Core.flip(marker, marker, -1);
            using (var region = image.submat(60, 220, 100, 260)) marker.copyTo(region);
            var result = detector.Detect(image, 1234);
            Assert.That(result.CaptureTimestampTicks, Is.EqualTo(1234));
            Assert.That(result.Resolution, Is.EqualTo(new Vector2Int(400, 320)));
            Assert.That(result.MarkerIds, Is.EqualTo(new[] { id }));
            Assert.That(result.CornersPixels, Has.Length.EqualTo(8));
            var expected = new float[] { 100, 60, 259, 60, 259, 219, 100, 219 };
            for (int i = 0; i < 8; i++) Assert.That(result.CornersPixels[i], Is.EqualTo(expected[i]).Within(2));
            Assert.That(result.ProcessingMilliseconds, Is.GreaterThanOrEqualTo(0));
            var blank = new Mat(320, 400, CvType.CV_8UC1, new Scalar(255));
            using (blank) Assert.That(detector.Detect(blank, 1235).MarkerIds, Is.Empty);
            Assert.That(result.MarkerIds, Is.EqualTo(new[] { id }), "Later detections must not overwrite earlier snapshots.");
        }
    }

    [TestCase(0)]
    [TestCase(1)]
    [TestCase(2)]
    [TestCase(3)]
    public void WebPrintedMarkerPreservesCanonicalAxesAndMetricScale(int quarterTurns)
    {
        // Official tag36h11 ID 0 in the orientation used by the Audience print asset.
        var cells = new[] { "00000000", "01101010", "00111010", "00110000",
            "01010000", "00101100", "00001000", "00000000" };
        using (var image = new Mat(400, 400, CvType.CV_8UC1, new Scalar(255)))
        using (var detector = new ArucoMarkerDetector())
        {
            for (int y = 0; y < 8; y++)
                for (int x = 0; x < 8; x++)
                    using (var cell = image.submat(60 + y * 20, 80 + y * 20, 100 + x * 20, 120 + x * 20))
                        cell.setTo(new Scalar(cells[y][x] == '0' ? 0 : 255));
            var expected = new float[] { 100, 60, 259, 60, 259, 219, 100, 219 };
            for (int turn = 0; turn < quarterTurns; turn++)
            {
                Core.rotate(image, image, Core.ROTATE_90_CLOCKWISE);
                for (int corner = 0; corner < 4; corner++)
                {
                    float x = expected[corner * 2];
                    expected[corner * 2] = 399 - expected[corner * 2 + 1];
                    expected[corner * 2 + 1] = x;
                }
            }
            var result = detector.Detect(image, 1);
            Assert.That(result.MarkerIds, Is.EqualTo(new[] { 0 }));
            for (int i = 0; i < 8; i++) Assert.That(result.CornersPixels[i], Is.EqualTo(expected[i]).Within(2));
            var pose = new ArucoMarkerPoseEstimator().Estimate(result.CornersPixels, 0, 800, 800, 200, 200);
            Assert.That(pose.IsValid, Is.True, pose.RejectionReason);
            Assert.That(pose.CameraPositionMeters.z, Is.EqualTo(0.75).Within(0.01));
            Assert.That(Quaternion.Angle(pose.CameraRotation, Quaternion.Euler(0, 0, -quarterTurns * 90)), Is.LessThan(1));
        }
    }

    [Test]
    public void PrintableMarkerGenerationMatchesTheCheckedInSharedTag()
    {
        var path = Path.Combine(Application.dataPath, "..", "docs", "apriltag-markers", "tag36h11-id-0.svg");
        var expected = XDocument.Parse(File.ReadAllText(path));
        var actual = XDocument.Parse(ArucoTestMarkerEditor.CreateMarkerSvg());
        Assert.That(XNode.DeepEquals(actual, expected), Is.True);
        Assert.That((string)actual.Root.Attribute("width"), Is.EqualTo("225mm"));
        Assert.That((string)actual.Root.Attribute("height"), Is.EqualTo("225mm"));
    }

    [Test]
    public void LegacyArucoMarkerIsNotAcceptedAsAprilTag()
    {
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50))
        using (var marker = new Mat())
        using (var image = new Mat(320, 400, CvType.CV_8UC1, new Scalar(255)))
        using (var detector = new ArucoMarkerDetector())
        {
            Objdetect.generateImageMarker(dictionary, 0, 160, marker, 1);
            using (var region = image.submat(60, 220, 100, 260)) marker.copyTo(region);
            Assert.That(detector.Detect(image, 1).MarkerIds, Is.Empty);
        }
    }

    [Test]
    public void BlankImageHasNoMarkersAndColorImagesAreRejectedAtTheBoundary()
    {
        using (var detector = new ArucoMarkerDetector())
        using (var gray = new Mat(240, 320, CvType.CV_8UC1, new Scalar(255)))
        using (var rgba = new Mat(240, 320, CvType.CV_8UC4))
        {
            var result = detector.Detect(gray, 1);
            Assert.That(result.MarkerIds, Is.Empty);
            Assert.That(result.CornersPixels, Is.Empty);
            Assert.Throws<ArgumentException>(() => detector.Detect(rgba, 2));
        }
    }

    [Test]
    public void DetectingTwoMarkersDoesNotAccumulateCornersAcrossFrames()
    {
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_APRILTAG_36h11))
        using (var marker = new Mat())
        using (var image = new Mat(300, 600, CvType.CV_8UC1, new Scalar(255)))
        using (var detector = new ArucoMarkerDetector())
        {
            foreach (int id in new[] { 0, 23 })
            {
                Objdetect.generateImageMarker(dictionary, id, 120, marker, 1);
                Core.flip(marker, marker, -1);
                int x = id == 0 ? 40 : 350;
                using (var region = image.submat(70, 190, x, x + 120)) marker.copyTo(region);
            }
            for (int i = 0; i < 10; i++)
            {
                var result = detector.Detect(image, i + 1);
                Assert.That(result.MarkerIds, Is.EquivalentTo(new[] { 0, 23 }));
                Assert.That(result.CornersPixels, Has.Length.EqualTo(16));
            }
        }
    }
}
#endif

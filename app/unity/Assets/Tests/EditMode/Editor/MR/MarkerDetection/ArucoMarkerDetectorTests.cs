#if UNFRAME_OPENCV_FOR_UNITY
using System;
using NUnit.Framework;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ObjdetectModule;
using UnityEngine;

public sealed class ArucoMarkerDetectorTests
{
    [TestCase(0)]
    [TestCase(23)]
    [TestCase(49)]
    public void DetectsGeneratedMarkerIdAndCornersInTopLeftPixelCoordinates(int id)
    {
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50))
        using (var marker = new Mat())
        using (var image = new Mat(320, 400, CvType.CV_8UC1, new Scalar(255)))
        using (var detector = new ArucoMarkerDetector())
        {
            Objdetect.generateImageMarker(dictionary, id, 160, marker, 1);
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
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50))
        using (var marker = new Mat())
        using (var image = new Mat(300, 600, CvType.CV_8UC1, new Scalar(255)))
        using (var detector = new ArucoMarkerDetector())
        {
            foreach (int id in new[] { 0, 23 })
            {
                Objdetect.generateImageMarker(dictionary, id, 120, marker, 1);
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

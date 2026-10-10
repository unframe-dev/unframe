#if UNFRAME_OPENCV_FOR_UNITY
using NUnit.Framework;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ImgprocModule;
using OpenCVForUnity.ObjdetectModule;
using UnityEngine;

public sealed class ArucoFrameProcessorCandidateTests
{
    [Test]
    public void DetectedMarkerAtTheImageEdgeStillProducesADiagnosticCandidate()
    {
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50))
        using (var marker = new Mat())
        using (var image = new Mat(320, 400, CvType.CV_8UC1, new Scalar(255)))
        using (var rgba = new Mat())
        using (var processor = new ArucoFrameProcessor())
        {
            Objdetect.generateImageMarker(dictionary, 0, 160, marker, 1);
            using (var region = image.submat(60, 220, 3, 163)) marker.copyTo(region);
            Imgproc.cvtColor(image, rgba, Imgproc.COLOR_GRAY2RGBA);
            Core.flip(rgba, rgba, 0);
            var result = processor.Process(rgba, 1234, new ArucoCameraGeometry(800, 800, 200, 160, Pose.identity));
            Assert.That(result.Frame.MarkerIds, Is.EqualTo(new[] { 0 }));
            Assert.That(result.Frame.CornersPixels[0], Is.LessThan(3));
            Assert.That(result.Estimate, Is.Not.Null);
            Assert.That(result.Estimate.HasPoseCandidate, Is.True);
            Assert.That(result.Estimate.IsValid, Is.False, "Near-edge poses remain unsuitable for origin confirmation.");
        }
    }
}
#endif

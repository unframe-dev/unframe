#if UNFRAME_OPENCV_FOR_UNITY
using System.Collections;
using NUnit.Framework;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.Extensions;
using OpenCVForUnity.ImgprocModule;
using OpenCVForUnity.ObjdetectModule;
using OpenCVForUnity.UnityIntegration;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.TestTools;

public sealed class ArucoGpuReadbackTests
{
    [UnityTest]
    public IEnumerator TextureReadbackPreservesMarkerIdAndImageCornerOrientation()
    {
        if (!SystemInfo.supportsAsyncGPUReadback) Assert.Ignore("Run with a graphics device; omit -nographics.");
        var texture = new Texture2D(400, 320, TextureFormat.RGBA32, false, true);
        AsyncGPUReadbackRequest request = default;
        bool requested = false;
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50))
        using (var marker = new Mat())
        using (var source = new Mat(320, 400, CvType.CV_8UC1, new Scalar(255)))
        using (var rgba = new Mat(320, 400, CvType.CV_8UC4))
        using (var gray = new Mat())
        using (var detector = new ArucoMarkerDetector())
        {
            try
            {
                Objdetect.generateImageMarker(dictionary, 23, 160, marker, 1);
                using (var region = source.submat(60, 220, 100, 260)) marker.copyTo(region);
                OpenCVMatUnityUtils.MatToTexture2D(source, texture);
                request = AsyncGPUReadback.Request(texture, 0, GraphicsFormat.R8G8B8A8_UNorm);
                requested = true;
                double deadline = Time.realtimeSinceStartupAsDouble + 10;
                while (!request.done && Time.realtimeSinceStartupAsDouble < deadline) yield return null;
                Assert.That(request.done, Is.True, "GPU readback did not complete.");
                Assert.That(request.hasError, Is.False);
                MatBufferUtils.CopyToMat<byte>(request.GetData<byte>(), rgba);
                Core.flip(rgba, rgba, 0);
                Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY);
                var result = detector.Detect(gray, 1);
                Assert.That(result.MarkerIds, Is.EqualTo(new[] { 23 }));
                Assert.That(result.CornersPixels[0], Is.EqualTo(100).Within(2));
                Assert.That(result.CornersPixels[1], Is.EqualTo(60).Within(2));
            }
            finally
            {
                if (requested && !request.done) request.WaitForCompletion();
                Object.DestroyImmediate(texture);
            }
        }
    }
}
#endif

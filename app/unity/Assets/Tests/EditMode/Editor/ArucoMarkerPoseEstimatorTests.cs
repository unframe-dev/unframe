using System;
using NUnit.Framework;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.GeometryModule;
using UnityEngine;

public sealed class ArucoMarkerPoseEstimatorTests
{
    [TestCase(0.2f, -0.15f, 0.85f, 23f, -31f, 12f)]
    [TestCase(-0.1f, 0.12f, 1.5f, -30f, 18f, -14f)]
    public void RecoversMetricTranslationAndUnityRotation(float x, float y, float z, float pitch, float yaw, float roll)
    {
        var expected = new Pose(new Vector3(x, y, z), Quaternion.Euler(pitch, yaw, roll));
        var result = new ArucoMarkerPoseEstimator().Estimate(Project(expected), 0, 800, 810, 640, 480);
        Assert.That(result.IsValid, Is.True, result.RejectionReason);
        Assert.That(Vector3.Distance(result.CameraPositionMeters, expected.position), Is.LessThan(0.001f));
        Assert.That(Quaternion.Angle(result.CameraRotation, expected.rotation), Is.LessThan(0.2f));
        Assert.That(result.ReprojectionErrorPixels, Is.LessThan(0.01));
        Assert.That(result.CandidateCount, Is.EqualTo(2));
    }

    [TestCase(0)]
    [TestCase(90)]
    [TestCase(180)]
    [TestCase(270)]
    public void EquivalentFrontalSolutionsRemainValidAndSurfaceNormalFacesCamera(float roll)
    {
        var expectedRotation = Quaternion.Euler(0, 0, roll);
        var result = new ArucoMarkerPoseEstimator().Estimate(Project(new Pose(new Vector3(0, 0, 1), expectedRotation)), 0, 800, 810, 640, 480);
        Assert.That(result.IsValid, Is.True, result.RejectionReason);
        Assert.That(Quaternion.Angle(result.CameraRotation, expectedRotation), Is.LessThan(0.2f));
        Assert.That(Vector3.Dot(-(result.CameraRotation * Vector3.forward), Vector3.back), Is.GreaterThan(0.999f));
    }

    [Test]
    public void IndistinguishableDistantTiltedSolutionsAreRejected()
    {
        var result = new ArucoMarkerPoseEstimator().Estimate(Project(new Pose(new Vector3(0, 0, 8), Quaternion.Euler(20, 0, 0))), 0, 800, 810, 640, 480);
        Assert.That(result.IsValid, Is.False);
        Assert.That(result.RejectionReason, Is.EqualTo("ambiguous pose"));
    }

    [Test]
    public void CornerOffsetSelectsTheRequestedMarker()
    {
        var corners = new float[16];
        Array.Copy(Project(new Pose(new Vector3(0.1f, 0, 1), Quaternion.Euler(25, 10, 0))), 0, corners, 8, 8);
        var result = new ArucoMarkerPoseEstimator().Estimate(corners, 8, 800, 810, 640, 480);
        Assert.That(result.IsValid, Is.True, result.RejectionReason);
        Assert.That(result.CameraPositionMeters.x, Is.EqualTo(0.1f).Within(0.001f));
    }

    [Test]
    public void InvalidIntrinsicsAndMalformedCornersAreRejected()
    {
        var estimator = new ArucoMarkerPoseEstimator();
        var good = Project(new Pose(new Vector3(0, 0, 1), Quaternion.identity));
        Assert.That(estimator.Estimate(good, 0, 0, 810, 640, 480).IsValid, Is.False);
        Assert.That(estimator.Estimate(good, 0, 800, 810, double.NaN, 480).IsValid, Is.False);
        Assert.That(estimator.Estimate(null, 0, 800, 810, 640, 480).IsValid, Is.False);
        Assert.That(estimator.Estimate(good, -1, 800, 810, 640, 480).IsValid, Is.False);
        Assert.That(estimator.Estimate(new float[8], 0, 800, 810, 640, 480).IsValid, Is.False);
        good[0] = float.NaN;
        Assert.That(estimator.Estimate(good, 0, 800, 810, 640, 480).IsValid, Is.False);
    }

    private static float[] Project(Pose pose)
    {
        const double half = 0.1;
        using (var objects = new MatOfPoint3f(new Point3(-half, half, 0), new Point3(half, half, 0), new Point3(half, -half, 0), new Point3(-half, -half, 0)))
        using (var rotation = new Mat(3, 3, CvType.CV_64FC1))
        using (var rvec = new Mat())
        using (var tvec = new Mat(3, 1, CvType.CV_64FC1))
        using (var camera = new Mat(3, 3, CvType.CV_64FC1))
        using (var distortion = new MatOfDouble())
        using (var pixels = new MatOfPoint2f())
        {
            var right = pose.rotation * Vector3.right;
            var up = pose.rotation * Vector3.up;
            var forward = pose.rotation * Vector3.forward;
            rotation.put(0, 0, new double[] { right.x, up.x, -forward.x, -right.y, -up.y, forward.y, right.z, up.z, -forward.z });
            Geometry.Rodrigues(rotation, rvec);
            tvec.put(0, 0, new double[] { pose.position.x, -pose.position.y, pose.position.z });
            camera.put(0, 0, new double[] { 800, 0, 640, 0, 810, 480, 0, 0, 1 });
            Geometry.projectPoints(objects, rvec, tvec, camera, distortion, pixels);
            var projected = pixels.toArray();
            var result = new float[8];
            for (int i = 0; i < 4; i++)
            {
                result[i * 2] = (float)projected[i].x;
                result[i * 2 + 1] = (float)projected[i].y;
            }
            return result;
        }
    }
}

using NUnit.Framework;
using UnityEngine;

public sealed class ArucoCameraGeometryTests
{
    [TestCase(1280, 960, 800, 720, 640, 520)]
    [TestCase(600, 900, 750, 675, 300, 487.5)]
    public void IntrinsicsMatchTheCapturedResolutionAndCenteredSensorCrop(int width, int height,
        double fx, double fy, double cx, double cy)
    {
        var geometry = ArucoCameraGeometry.FromSensor(new Vector2(1000, 900), new Vector2(800, 550),
            new Vector2Int(1600, 1200), new Vector2Int(width, height), Pose.identity);
        Assert.That(geometry.Fx, Is.EqualTo(fx).Within(0.001));
        Assert.That(geometry.Fy, Is.EqualTo(fy).Within(0.001));
        Assert.That(geometry.Cx, Is.EqualTo(cx).Within(0.001));
        Assert.That(geometry.Cy, Is.EqualTo(cy).Within(0.001));
    }

    [TestCase(float.NaN)]
    [TestCase(float.PositiveInfinity)]
    [TestCase(float.NegativeInfinity)]
    public void NonFiniteCameraPoseIsUnavailable(float value)
    {
        var position = new Pose(new Vector3(value, 0, 0), Quaternion.identity);
        var rotation = new Pose(Vector3.zero, new Quaternion(0, value, 0, 1));
        Assert.That(new ArucoCameraGeometry(960, 960, 640, 480, position).HasValidCameraPose, Is.False);
        Assert.That(new ArucoCameraGeometry(960, 960, 640, 480, rotation).HasValidCameraPose, Is.False);
    }

    [Test]
    public void ZeroCameraQuaternionCannotSupplyWorldGeometry()
    {
        var geometry = new ArucoCameraGeometry(960, 960, 640, 480,
            new Pose(Vector3.zero, new Quaternion(0, 0, 0, 0)));
        Assert.That(geometry.HasValidCameraPose, Is.False);
        Assert.That(new ArucoCameraGeometry(960, 960, 640, 480, Pose.identity).HasValidCameraPose, Is.True);
    }

    [Test]
    public void IntrinsicsUseSensorCropAndTopLeftImageCoordinates()
    {
        var geometry = ArucoCameraGeometry.FromSensor(new Vector2(1000, 900), new Vector2(800, 550),
            new Vector2Int(1600, 1200), new Vector2Int(640, 360), Pose.identity);
        Assert.That(geometry.Fx, Is.EqualTo(400).Within(0.001));
        Assert.That(geometry.Fy, Is.EqualTo(360).Within(0.001));
        Assert.That(geometry.Cx, Is.EqualTo(320).Within(0.001));
        Assert.That(geometry.Cy, Is.EqualTo(200).Within(0.001));
    }

    [Test]
    public void CameraRelativeMarkerPoseIsComposedWithCapturedCameraPose()
    {
        var camera = new Pose(new Vector3(2, 1, 3), Quaternion.Euler(0, 90, 0));
        var geometry = new ArucoCameraGeometry(500, 500, 320, 240, camera);
        var marker = new Pose(new Vector3(0, 0, 1), Quaternion.Euler(15, 0, 0));
        var world = geometry.ToWorld(marker);
        Assert.That(Vector3.Distance(world.position, new Vector3(3, 1, 3)), Is.LessThan(0.0001));
        Assert.That(Quaternion.Angle(world.rotation, camera.rotation * marker.rotation), Is.LessThan(0.001));
    }
}

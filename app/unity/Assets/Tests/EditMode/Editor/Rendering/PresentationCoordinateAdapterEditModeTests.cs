using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using Wire = Unframe.Presentation;

public sealed class PresentationCoordinateAdapterEditModeTests
{
    [Test]
    public void Transform_ReflectsPositionAndRotationWhilePreservingScale()
    {
        double component = System.Math.Sqrt(0.5d);
        Wire.Transform source = new Wire.Transform
        {
            Position = new Wire.Vector3 { X = 1, Y = 2, Z = -3 },
            Rotation = new Wire.Quaternion { X = component, W = component },
            Scale = new Wire.Vector3 { X = 2, Y = 3, Z = 4 },
        };
        Assert.That(PresentationCoordinateAdapter.TryToUnityTransform(source, out UnityEngine.Vector3 position, out UnityEngine.Quaternion rotation, out UnityEngine.Vector3 scale), Is.True);
        Assert.That(position, Is.EqualTo(new UnityEngine.Vector3(1, 2, 3)));
        Assert.That(rotation.x, Is.EqualTo(-component).Within(1e-5));
        Assert.That(rotation.w, Is.EqualTo(component).Within(1e-5));
        Assert.That(scale, Is.EqualTo(new UnityEngine.Vector3(2, 3, 4)));
    }

    [TestCase(double.NaN)]
    [TestCase(double.PositiveInfinity)]
    [TestCase(double.MaxValue)]
    public void Position_RejectsNonFiniteOrFloatOverflow(double invalid)
    {
        Assert.That(PresentationCoordinateAdapter.IsValidPosition(new Wire.Vector3 { X = invalid }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidScale(new Wire.Vector3 { X = 1, Y = 1, Z = invalid }), Is.False);
    }

    [Test]
    public void Rotation_RequiresUnitLengthAndCanonicalSignWithoutRepair()
    {
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { W = 1 }), Is.True);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { W = 1 + 5e-10 }), Is.True);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { W = 1 + 2e-9 }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { W = -1 }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { X = -1 }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { Y = -1 }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { Z = -1 }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { Z = 1 }), Is.True);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion()), Is.False);
    }

    [Test]
    public void CanonicalInput_RejectsNegativeZeroAndScaleFloatUnderflow()
    {
        double negativeZero = System.BitConverter.Int64BitsToDouble(long.MinValue);
        Assert.That(PresentationCoordinateAdapter.IsValidPosition(new Wire.Vector3 { X = negativeZero }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidRotation(new Wire.Quaternion { X = negativeZero, W = 1 }), Is.False);
        Assert.That(PresentationCoordinateAdapter.IsValidScale(new Wire.Vector3 { X = double.Epsilon, Y = 1, Z = 1 }), Is.False);
    }

    [Test]
    public void Pose_RejectsMissingComponentsAndConvertsCanonicalOrigin()
    {
        Assert.That(PresentationCoordinateAdapter.IsValidPose(new Wire.Pose()), Is.False);
        Wire.Pose pose = new Wire.Pose
        {
            Position = new Wire.Vector3 { Z = -2 },
            Rotation = new Wire.Quaternion { W = 1 },
        };
        Assert.That(PresentationCoordinateAdapter.TryToUnityPose(pose, out UnityEngine.Pose converted), Is.True);
        Assert.That(converted.position.z, Is.EqualTo(2));
    }
}

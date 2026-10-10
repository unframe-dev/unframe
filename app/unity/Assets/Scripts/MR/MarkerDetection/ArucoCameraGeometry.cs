using UnityEngine;

public readonly struct ArucoCameraGeometry
{
    public double Fx { get; }
    public double Fy { get; }
    public double Cx { get; }
    public double Cy { get; }
    public Pose CameraPose { get; }
    public bool HasValidCameraPose => Finite(CameraPose.position.x) && Finite(CameraPose.position.y)
        && Finite(CameraPose.position.z) && Finite(CameraPose.rotation.x) && Finite(CameraPose.rotation.y)
        && Finite(CameraPose.rotation.z) && Finite(CameraPose.rotation.w)
        && Quaternion.Dot(CameraPose.rotation, CameraPose.rotation) > 0.000001f;

    public ArucoCameraGeometry(double fx, double fy, double cx, double cy, Pose cameraPose)
    {
        Fx = fx;
        Fy = fy;
        Cx = cx;
        Cy = cy;
        CameraPose = cameraPose;
    }

    public static ArucoCameraGeometry FromSensor(Vector2 focalLength, Vector2 principalPoint,
        Vector2Int sensorResolution, Vector2Int imageResolution, Pose cameraPose)
    {
        if (sensorResolution.x <= 0 || sensorResolution.y <= 0 || imageResolution.x <= 0 || imageResolution.y <= 0)
            throw new System.ArgumentOutOfRangeException(nameof(imageResolution));
        double scale = System.Math.Max((double)imageResolution.x / sensorResolution.x,
            (double)imageResolution.y / sensorResolution.y);
        double cropWidth = imageResolution.x / scale;
        double cropHeight = imageResolution.y / scale;
        double cropX = (sensorResolution.x - cropWidth) * 0.5;
        double cropY = (sensorResolution.y - cropHeight) * 0.5;
        // MRUK sensor coordinates have a bottom-left origin; detection images have a top-left origin.
        return new ArucoCameraGeometry(focalLength.x * scale, focalLength.y * scale,
            (principalPoint.x - cropX) * scale, imageResolution.y - (principalPoint.y - cropY) * scale, cameraPose);
    }

    public Pose ToWorld(Pose cameraFromMarker) => new Pose(
        CameraPose.position + CameraPose.rotation * cameraFromMarker.position,
        CameraPose.rotation * cameraFromMarker.rotation);

    private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
}

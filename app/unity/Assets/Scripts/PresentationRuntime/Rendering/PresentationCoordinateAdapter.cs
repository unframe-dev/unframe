using System;
using Wire = Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationCoordinateAdapter
    {
        private const double QuaternionNormTolerance = 1e-9;

        public static bool IsValidPosition(Wire.Vector3 value)
        {
            return value != null && IsRepresentable(value.X) && IsRepresentable(value.Y) && IsRepresentable(value.Z);
        }

        public static bool IsValidScale(Wire.Vector3 value)
        {
            return IsValidPosition(value) && (float)value.X > 0 && (float)value.Y > 0 && (float)value.Z > 0;
        }

        public static bool IsValidRotation(Wire.Quaternion value)
        {
            if (value == null || !IsRepresentable(value.X) || !IsRepresentable(value.Y) || !IsRepresentable(value.Z) || !IsRepresentable(value.W))
            {
                return false;
            }

            double norm = Math.Sqrt(value.X * value.X + value.Y * value.Y + value.Z * value.Z + value.W * value.W);
            if (Math.Abs(norm - 1d) > QuaternionNormTolerance)
            {
                return false;
            }

            return value.W > 0 || value.W == 0 && (value.X > 0 || value.X == 0 && (value.Y > 0 || value.Y == 0 && value.Z > 0));
        }

        public static bool IsValidPose(Wire.Pose value)
        {
            return value != null && IsValidPosition(value.Position) && IsValidRotation(value.Rotation);
        }

        public static bool TryToUnityPosition(Wire.Vector3 value, out UnityEngine.Vector3 result)
        {
            result = default;
            if (!IsValidPosition(value))
            {
                return false;
            }

            result = new UnityEngine.Vector3((float)value.X, (float)value.Y, -(float)value.Z);
            return true;
        }

        public static bool TryToUnityScale(Wire.Vector3 value, out UnityEngine.Vector3 result)
        {
            result = default;
            if (!IsValidScale(value))
            {
                return false;
            }

            result = new UnityEngine.Vector3((float)value.X, (float)value.Y, (float)value.Z);
            return true;
        }

        public static bool TryToUnityRotation(Wire.Quaternion value, out UnityEngine.Quaternion result)
        {
            result = default;
            if (!IsValidRotation(value))
            {
                return false;
            }

            result = new UnityEngine.Quaternion(-(float)value.X, -(float)value.Y, (float)value.Z, (float)value.W);
            return true;
        }

        public static bool TryToUnityPose(Wire.Pose value, out UnityEngine.Pose result)
        {
            result = default;
            if (value == null || !TryToUnityPosition(value.Position, out UnityEngine.Vector3 position) || !TryToUnityRotation(value.Rotation, out UnityEngine.Quaternion rotation))
            {
                return false;
            }

            result = new UnityEngine.Pose(position, rotation);
            return true;
        }

        public static bool TryToUnityTransform(Wire.Transform value, out UnityEngine.Vector3 position, out UnityEngine.Quaternion rotation, out UnityEngine.Vector3 scale)
        {
            position = default;
            rotation = default;
            scale = default;
            return value != null && TryToUnityPosition(value.Position, out position) && TryToUnityRotation(value.Rotation, out rotation) && TryToUnityScale(value.Scale, out scale);
        }

        private static bool IsRepresentable(double value)
        {
            return !Double.IsNaN(value) && !Double.IsInfinity(value) && !Single.IsInfinity((float)value) && BitConverter.DoubleToInt64Bits(value) != long.MinValue;
        }
    }
}

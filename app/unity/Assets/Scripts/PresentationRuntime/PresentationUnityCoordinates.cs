using System;
using Unframe.Presentation.V2;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationUnityCoordinates
    {
        internal static bool IsRenderable(Vector3 value)
        {
            return value != null && Renderable(value.X) && Renderable(value.Y) && Renderable(value.Z);
        }

        internal static bool IsRenderableScale(Vector3 value)
        {
            return IsRenderable(value) && (float)value.X > 0f && (float)value.Y > 0f && (float)value.Z > 0f;
        }

        private static bool Renderable(double value)
        {
            return !Double.IsNaN(value) && !Double.IsInfinity(value) && Math.Abs(value) <= float.MaxValue;
        }

        internal static UnityEngine.Vector3 Position(Vector3 value)
        {
            return new UnityEngine.Vector3((float)value.X, (float)value.Y, -(float)value.Z);
        }

        internal static UnityEngine.Vector3 Scale(Vector3 value)
        {
            return new UnityEngine.Vector3((float)value.X, (float)value.Y, (float)value.Z);
        }

        internal static UnityEngine.Quaternion Rotation(Quaternion value)
        {
            return new UnityEngine.Quaternion(-(float)value.X, -(float)value.Y, (float)value.Z, (float)value.W);
        }
    }
}

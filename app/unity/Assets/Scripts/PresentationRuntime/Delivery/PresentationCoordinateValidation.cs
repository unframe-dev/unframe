using System;
using Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationCoordinateValidation
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
    }
}

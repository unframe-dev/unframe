using System;
using Unframe.Presentation;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationVideoLayout
    {
        public static bool TryCalculate(ulong sourceWidth, ulong sourceHeight, double width, double height, SurfaceFit fit,
            out UnityEngine.Vector2 size, out Rect uv)
        {
            size = default; uv = new Rect(0, 0, 1, 1);
            if (sourceWidth == 0 || sourceHeight == 0 || double.IsNaN(width) || double.IsInfinity(width) || double.IsNaN(height) || double.IsInfinity(height)
                || width <= 0 || height <= 0 || width > float.MaxValue || height > float.MaxValue) return false;
            double source = (double)sourceWidth / sourceHeight, target = width / height;
            if (fit == SurfaceFit.Contain) { if (source > target) height = width / source; else width = height * source; }
            else if (fit == SurfaceFit.Cover)
            {
                if (source > target) { float fraction = (float)(target / source); uv = new Rect((1 - fraction) / 2, 0, fraction, 1); }
                else { float fraction = (float)(source / target); uv = new Rect(0, (1 - fraction) / 2, 1, fraction); }
            }
            else if (fit != SurfaceFit.Stretch) return false;
            size = new UnityEngine.Vector2((float)width, (float)height); return true;
        }
    }
}

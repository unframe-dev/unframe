using System;
using Unframe.Delivery;
using Unframe.Presentation;
using UnityEngine;
using Vector3 = UnityEngine.Vector3;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    public readonly struct QuestNormalizedPoint
    {
        public readonly double X;
        public readonly double Y;

        public QuestNormalizedPoint(double x, double y) { X = x; Y = y; }
    }

    public static class QuestPresentationSurfacePicking
    {
        public static bool TryIntersect(Ray ray, Transform quad, LogicalBounds partitionBounds,
            double surfaceWidth, double surfaceHeight, out QuestNormalizedPoint normalized, out float distance)
        {
            normalized = default;
            distance = 0;
            if (quad == null || partitionBounds == null || !Finite(surfaceWidth) || !Finite(surfaceHeight)
                || surfaceWidth <= 0 || surfaceHeight <= 0 || !Finite(partitionBounds.X) || !Finite(partitionBounds.Y)
                || !Finite(partitionBounds.Width) || !Finite(partitionBounds.Height)
                || partitionBounds.X < 0 || partitionBounds.Y < 0 || partitionBounds.Width <= 0 || partitionBounds.Height <= 0
                || partitionBounds.X + partitionBounds.Width > surfaceWidth
                || partitionBounds.Y + partitionBounds.Height > surfaceHeight) return false;
            Vector3 origin = quad.InverseTransformPoint(ray.origin);
            Vector3 direction = quad.InverseTransformVector(ray.direction);
            if (!Finite(origin) || !Finite(direction) || direction.z <= 0) return false;
            float t = -origin.z / direction.z;
            if (float.IsNaN(t) || float.IsInfinity(t) || t < 0) return false;
            Vector3 point = origin + direction * t;
            if (point.x < -0.5f || point.x >= 0.5f || point.y <= -0.5f || point.y > 0.5f) return false;
            double x = (partitionBounds.X + (point.x + 0.5) * partitionBounds.Width) / surfaceWidth;
            double y = (partitionBounds.Y + (0.5 - point.y) * partitionBounds.Height) / surfaceHeight;
            if (!Finite(x) || !Finite(y) || x < 0 || x >= 1 || y < 0 || y >= 1) return false;
            distance = Vector3.Distance(ray.origin, quad.TransformPoint(point));
            normalized = new QuestNormalizedPoint(x, y);
            return !float.IsNaN(distance) && !float.IsInfinity(distance) && distance >= 0;
        }

        public static bool TryResolve(ProjectedSemanticSurface surface, string stateId, QuestNormalizedPoint normalized, out string interactionId)
        {
            interactionId = null;
            if (surface == null || String.IsNullOrEmpty(stateId) || !Finite(normalized.X) || !Finite(normalized.Y)
                || normalized.X < 0 || normalized.X >= 1 || normalized.Y < 0 || normalized.Y >= 1) return false;
            InteractiveRegion winner = null;
            foreach (SurfaceSemanticState state in surface.States)
            {
                if (state.StateId != stateId) continue;
                foreach (InteractiveRegion region in state.InteractiveRegions)
                {
                    LogicalBounds bounds = region.NormalizedBounds;
                    if (bounds == null || normalized.X < bounds.X || normalized.X >= bounds.X + bounds.Width
                        || normalized.Y < bounds.Y || normalized.Y >= bounds.Y + bounds.Height) continue;
                    if (winner == null || region.Priority > winner.Priority
                        || region.Priority == winner.Priority && StringComparer.Ordinal.Compare(region.InteractionId, winner.InteractionId) < 0)
                        winner = region;
                }
                break;
            }
            if (winner == null) return false;
            interactionId = winner.InteractionId;
            return true;
        }

        private static bool Finite(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x)
                && !float.IsNaN(value.y) && !float.IsInfinity(value.y)
                && !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        }

        private static bool Finite(double value) { return !Double.IsNaN(value) && !Double.IsInfinity(value); }
    }
}

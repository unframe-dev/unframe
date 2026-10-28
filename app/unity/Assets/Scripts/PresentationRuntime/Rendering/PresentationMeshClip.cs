using System.Collections.Generic;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationMeshClip
    {
        public readonly struct Vertex
        {
            public readonly UnityEngine.Vector3 Position;
            public readonly Vector4 Uv0;
            public readonly UnityEngine.Vector2 Uv2;
            public readonly Color Color;
            public Vertex(UnityEngine.Vector3 position, Vector4 uv0, UnityEngine.Vector2 uv2, Color color)
            { Position = position; Uv0 = uv0; Uv2 = uv2; Color = color; }
            internal static Vertex Lerp(Vertex a, Vertex b, float amount) => new Vertex(
                UnityEngine.Vector3.LerpUnclamped(a.Position, b.Position, amount), Vector4.LerpUnclamped(a.Uv0, b.Uv0, amount),
                UnityEngine.Vector2.LerpUnclamped(a.Uv2, b.Uv2, amount), Color.LerpUnclamped(a.Color, b.Color, amount));
        }
        public static List<Vertex> Triangle(Vertex a, Vertex b, Vertex c, Rect clip)
        {
            var polygon = new List<Vertex> { a, b, c };
            if (clip.width <= 0 || clip.height <= 0) { polygon.Clear(); return polygon; }
            for (int edge = 0; edge < 4 && polygon.Count != 0; edge++)
            {
                var result = new List<Vertex>();
                Vertex previous = polygon[polygon.Count - 1]; float previousDistance = Distance(previous, clip, edge);
                foreach (Vertex current in polygon)
                {
                    float distance = Distance(current, clip, edge);
                    if ((distance >= 0) != (previousDistance >= 0))
                        result.Add(Vertex.Lerp(previous, current, previousDistance / (previousDistance - distance)));
                    if (distance >= 0) result.Add(current);
                    previous = current; previousDistance = distance;
                }
                polygon = result;
            }
            return polygon;
        }
        private static float Distance(Vertex vertex, Rect clip, int edge)
        {
            switch (edge)
            {
                case 0: return vertex.Position.x - clip.xMin;
                case 1: return clip.xMax - vertex.Position.x;
                case 2: return vertex.Position.y - clip.yMin;
                default: return clip.yMax - vertex.Position.y;
            }
        }
    }
}

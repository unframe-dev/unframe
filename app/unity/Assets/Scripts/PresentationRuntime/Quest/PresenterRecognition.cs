using System;
using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresenterRecognitionResult
    {
        public InputContext Context { get; internal set; }
        public GestureKind Gesture { get; internal set; }
        public string ZoneId { get; internal set; }
        public ZoneEdge Edge { get; internal set; }
    }

    public sealed class PresenterRecognition
    {
        private InputContext context;
        private PresenterRecognitionCatalog catalog;
        private readonly Dictionary<string, bool> zones = new Dictionary<string, bool>();
        private Vector3 previousLeft, previousRight, startLeft, startRight, forward;
        private double previousTime, stationarySince, startedAt;
        private bool seeded, armed, moving, emitted;

        public void Reset(InputContext nextContext, PresenterRecognitionCatalog nextCatalog)
        {
            context = nextContext?.Clone(); catalog = nextCatalog?.Clone();
            zones.Clear(); seeded = armed = moving = emitted = false;
            previousLeft = previousRight = null;
        }

        public PresenterRecognitionResult SampleHands(double time, Vector3 left, Vector3 right, Vector3 headForward)
        {
            if (context == null || catalog == null || !Valid(headForward) || !Valid(left) && !Valid(right))
            { seeded = armed = moving = false; return null; }
            left = Valid(left) ? left : null; right = Valid(right) ? right : null;
            if (!seeded || time <= previousTime || (left == null) != (previousLeft == null) || (right == null) != (previousRight == null))
            {
                seeded = true; armed = moving = false; stationarySince = time;
                Save(time, left, right); return null;
            }
            double dt = time - previousTime;
            bool stationary = Distance(left, previousLeft) / dt < 0.12 && Distance(right, previousRight) / dt < 0.12;
            if (stationary)
            {
                if (time - stationarySince >= 0.15) { armed = true; moving = emitted = false; }
                Save(time, left, right); return null;
            }
            stationarySince = time;
            if (!moving && armed)
            {
                double horizontal = Math.Sqrt(headForward.X * headForward.X + headForward.Z * headForward.Z);
                if (horizontal < 0.01) { Save(time, left, right); return null; }
                forward = new Vector3 { X = (float)(headForward.X / horizontal), Z = (float)(headForward.Z / horizontal) };
                startLeft = previousLeft?.Clone(); startRight = previousRight?.Clone();
                startedAt = previousTime; moving = true; emitted = false; armed = false;
            }
            Save(time, left, right);
            if (!moving || emitted || time - startedAt > 0.8) return null;
            var dl = Delta(left, startLeft); var dr = Delta(right, startRight);
            GestureKind kind = GestureKind.Unspecified;
            double separation = Distance(left, right) - Distance(startLeft, startRight);
            if (left != null && right != null && Dot(dl, dr) < 0 && Math.Abs(separation) >= 0.25)
                kind = separation > 0 ? GestureKind.SpreadHands : GestureKind.CloseHands;
            else
            {
                Vector3 d = Length(dl) >= Length(dr) ? dl : dr;
                if (Length(d) < 0.18) return null;
                double x = -forward.Z * d.X + forward.X * d.Z;
                double z = forward.X * d.X + forward.Z * d.Z;
                if (Math.Abs(d.Y) >= Math.Abs(x) && Math.Abs(d.Y) >= Math.Abs(z)) kind = d.Y > 0 ? GestureKind.SwipeUp : GestureKind.SwipeDown;
                else if (Math.Abs(x) >= Math.Abs(z)) kind = x > 0 ? GestureKind.SwipeRight : GestureKind.SwipeLeft;
                else kind = z > 0 ? GestureKind.PushForward : GestureKind.PullBackward;
            }
            emitted = true;
            return catalog.Gestures.Contains(kind) ? new PresenterRecognitionResult { Context = context.Clone(), Gesture = kind } : null;
        }

        public List<PresenterRecognitionResult> SampleWaist(Vector3 waist)
        {
            var results = new List<PresenterRecognitionResult>();
            if (context == null || catalog == null || !Valid(waist)) { zones.Clear(); return results; }
            foreach (PresenterRecognitionZone zone in catalog.Zones)
            {
                bool seededZone = zones.TryGetValue(zone.ZoneId, out bool wasInside);
                double boundary = seededZone && wasInside ? 1.03 : 1;
                bool inside = Math.Abs(waist.X - zone.Center.X) <= boundary && Math.Abs(waist.Y - zone.Center.Y) <= boundary && Math.Abs(waist.Z - zone.Center.Z) <= boundary;
                if (seededZone && inside != wasInside)
                    results.Add(new PresenterRecognitionResult { Context = context.Clone(), ZoneId = zone.ZoneId, Edge = inside ? ZoneEdge.Enter : ZoneEdge.Exit });
                zones[zone.ZoneId] = inside;
            }
            return results;
        }

        private void Save(double time, Vector3 left, Vector3 right) { previousTime = time; previousLeft = left?.Clone(); previousRight = right?.Clone(); }
        private static bool Valid(Vector3 v) => v != null && Finite(v.X) && Finite(v.Y) && Finite(v.Z);
        private static bool Finite(double v) => !Double.IsNaN(v) && !Double.IsInfinity(v);
        private static Vector3 Delta(Vector3 a, Vector3 b) => a == null || b == null ? new Vector3() : new Vector3 { X = a.X - b.X, Y = a.Y - b.Y, Z = a.Z - b.Z };
        private static double Dot(Vector3 a, Vector3 b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
        private static double Length(Vector3 v) => Math.Sqrt(Dot(v, v));
        private static double Distance(Vector3 a, Vector3 b) => Length(Delta(a, b));
    }
}

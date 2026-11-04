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
        private enum HandCapture { None, Left, Right, Both }
        private Vector3 startLeft, startRight, forward;
        private double startedAt, previousTime = Double.NaN;
        private bool previousLeftTrigger, previousRightTrigger;
        private HandCapture capture;

        public void Reset(InputContext nextContext, PresenterRecognitionCatalog nextCatalog)
        {
            context = nextContext?.Clone(); catalog = nextCatalog?.Clone();
            zones.Clear();
            CancelCapture();
            previousTime = Double.NaN;
        }

        public PresenterRecognitionResult SampleHands(double time, Vector3 left, Vector3 right, Vector3 headForward,
            bool leftTrigger, bool rightTrigger)
        {
            bool leftPressed = leftTrigger && !previousLeftTrigger;
            bool rightPressed = rightTrigger && !previousRightTrigger;
            previousLeftTrigger = leftTrigger;
            previousRightTrigger = rightTrigger;
            bool validTime = Finite(time) && (Double.IsNaN(previousTime) || time > previousTime);
            previousTime = time;
            if (context == null || catalog == null || !validTime || !Valid(headForward))
            {
                CancelCapture();
                return null;
            }
            if (leftPressed || rightPressed)
            {
                CancelCapture();
                HandCapture requested = leftTrigger && rightTrigger ? HandCapture.Both
                    : leftPressed ? HandCapture.Left : HandCapture.Right;
                bool leftRequired = requested == HandCapture.Left || requested == HandCapture.Both;
                bool rightRequired = requested == HandCapture.Right || requested == HandCapture.Both;
                double horizontal = Math.Sqrt(headForward.X * headForward.X + headForward.Z * headForward.Z);
                if ((leftRequired && !Valid(left)) || (rightRequired && !Valid(right)) || horizontal < 0.01) return null;
                capture = requested;
                startLeft = leftRequired ? left.Clone() : null;
                startRight = rightRequired ? right.Clone() : null;
                forward = new Vector3 { X = (float)(headForward.X / horizontal), Z = (float)(headForward.Z / horizontal) };
                startedAt = time;
                return null;
            }
            if (capture == HandCapture.None) return null;
            bool useLeft = capture == HandCapture.Left || capture == HandCapture.Both;
            bool useRight = capture == HandCapture.Right || capture == HandCapture.Both;
            if ((useLeft && (!leftTrigger || !Valid(left))) || (useRight && (!rightTrigger || !Valid(right)))
                || time - startedAt > 0.8)
            {
                CancelCapture();
                return null;
            }
            var dl = useLeft ? Delta(left, startLeft) : new Vector3();
            var dr = useRight ? Delta(right, startRight) : new Vector3();
            GestureKind kind;
            double separation = capture == HandCapture.Both ? Distance(left, right) - Distance(startLeft, startRight) : 0;
            if (capture == HandCapture.Both && Dot(dl, dr) < 0 && Math.Abs(separation) >= 0.25)
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
            if (!catalog.Gestures.Contains(kind)) return null;
            CancelCapture();
            return new PresenterRecognitionResult { Context = context.Clone(), Gesture = kind };
        }

        private void CancelCapture()
        {
            capture = HandCapture.None;
            startLeft = startRight = forward = null;
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

        private static bool Valid(Vector3 v) => v != null && Finite(v.X) && Finite(v.Y) && Finite(v.Z);
        private static bool Finite(double v) => !Double.IsNaN(v) && !Double.IsInfinity(v);
        private static Vector3 Delta(Vector3 a, Vector3 b) => a == null || b == null ? new Vector3() : new Vector3 { X = a.X - b.X, Y = a.Y - b.Y, Z = a.Z - b.Z };
        private static double Dot(Vector3 a, Vector3 b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
        private static double Length(Vector3 v) => Math.Sqrt(Dot(v, v));
        private static double Distance(Vector3 a, Vector3 b) => Length(Delta(a, b));
    }
}

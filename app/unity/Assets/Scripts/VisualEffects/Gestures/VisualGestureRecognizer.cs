using System;
using System.Collections.Generic;
using UnityEngine;

namespace Unframe.Unity.VisualEffects.Gestures
{
    public enum VisualGesture { Throw, Circle }
    public enum GestureHand { Left, Right }

    [Serializable]
    public sealed class GestureRecognitionSettings
    {
        public float WindupSideDistance = .15f;
        public float WindupBackDistance = .12f;
        public float ThrowMinSpeed = 1.2f;
        public float ThrowMinDistance = .2f;
        public float ThrowMaxAngleDegrees = 35;
        public float MaxVerticalRatio = .45f;
        public float CircleMinRadius = .08f;
        public float CircleMaxRadius = .6f;
        public float CircleMaxRadialError = .22f;
        public float CircleClosureRatio = .4f;
        public float CircleMinAngleDegrees = 320;
        public float CircleMaxReverseRatio = .1f;
        public float CircleMaxDepth = .08f;
        public int CircleMinSamples = 16;
        public float MinimumDurationSeconds = .15f;
        public float MaximumDurationSeconds = 2;
        public float MaximumSampleGapSeconds = .2f;

        internal GestureRecognitionSettings Copy()
        {
            var copy = (GestureRecognitionSettings)MemberwiseClone();
            foreach (var field in typeof(GestureRecognitionSettings).GetFields())
                if (field.FieldType == typeof(float))
                {
                    float value = (float)field.GetValue(copy);
                    if (float.IsNaN(value) || float.IsInfinity(value) || value <= 0)
                        throw new ArgumentOutOfRangeException(field.Name);
                }
            if (CircleMinSamples < 8 || CircleMinSamples > 256 || CircleMaxRadius < CircleMinRadius
                || MaximumDurationSeconds < MinimumDurationSeconds || ThrowMaxAngleDegrees >= 90
                || CircleMinAngleDegrees > 360 || MaxVerticalRatio > 1 || CircleMaxReverseRatio >= 1)
                throw new ArgumentException("Invalid gesture recognition limits.");
            return copy;
        }
    }

    public readonly struct GestureSample
    {
        public readonly double TimeSeconds;
        public readonly Vector3 HandPosition;
        public readonly Vector3 HeadPosition;
        public readonly Vector3 HeadForward;
        public readonly bool TrackingValid;
        public GestureSample(double timeSeconds, Vector3 handPosition, Vector3 headPosition, Vector3 headForward, bool trackingValid)
        {
            TimeSeconds = timeSeconds; HandPosition = handPosition; HeadPosition = headPosition;
            HeadForward = headForward; TrackingValid = trackingValid;
        }
    }

    public sealed class GestureRecognition
    {
        public VisualGesture Kind { get; internal set; }
        public GestureHand Hand { get; internal set; }
        public double StartedAtSeconds { get; internal set; }
        public double RecognizedAtSeconds { get; internal set; }
        public Vector3 Position { get; internal set; }
        public Vector3 Direction { get; internal set; }
        public float ForwardSpeed { get; internal set; }
        public float CircleRadius { get; internal set; }
    }

    public sealed class VisualGestureRecognizer
    {
        private readonly GestureRecognitionSettings settings;
        private GestureRecognitionSettings active;
        private readonly List<Vector3> points = new List<Vector3>();
        private VisualGesture kind;
        private GestureHand hand;
        private Vector3 forward, right, start, previous, windup;
        private double startedAt, previousAt, windupAt;
        private bool woundUp;
        public bool IsCapturing { get; private set; }

        public VisualGestureRecognizer(GestureRecognitionSettings settings = null)
        {
            this.settings = settings ?? new GestureRecognitionSettings();
        }

        public bool Begin(VisualGesture gesture, GestureHand selectedHand, GestureSample sample)
        {
            Cancel();
            if (!Enum.IsDefined(typeof(VisualGesture), gesture) || !Enum.IsDefined(typeof(GestureHand), selectedHand))
                throw new ArgumentOutOfRangeException(nameof(gesture));
            active = settings.Copy();
            if (!Valid(sample)) return false;
            forward = Vector3.ProjectOnPlane(sample.HeadForward, Vector3.up);
            if (forward.sqrMagnitude < .0001f) return false;
            forward.Normalize();
            right = Vector3.Cross(Vector3.up, forward);
            kind = gesture; hand = selectedHand;
            start = previous = Local(sample);
            startedAt = previousAt = sample.TimeSeconds;
            points.Add(start);
            IsCapturing = true;
            return true;
        }

        public GestureRecognition Update(GestureSample sample)
        {
            if (!IsCapturing) return null;
            double elapsed = sample.TimeSeconds - startedAt;
            double dt = sample.TimeSeconds - previousAt;
            if (!Valid(sample) || dt <= 0 || dt > active.MaximumSampleGapSeconds || elapsed > active.MaximumDurationSeconds)
            { Cancel(); return null; }
            Vector3 point = Local(sample);
            float speed = 0, radius = 0;
            bool recognized = false;
            if (kind == VisualGesture.Throw)
            {
                Vector3 fromStart = point - start;
                if (!woundUp && Mathf.Abs(fromStart.x) >= active.WindupSideDistance && fromStart.z <= -active.WindupBackDistance
                    && Mathf.Abs(fromStart.y) <= fromStart.magnitude * active.MaxVerticalRatio)
                { woundUp = true; windup = point; windupAt = sample.TimeSeconds; }
                if (woundUp && sample.TimeSeconds > windupAt)
                {
                    Vector3 movement = point - windup;
                    if (movement.magnitude >= active.ThrowMinDistance && Mathf.Abs(movement.y) > movement.magnitude * active.MaxVerticalRatio)
                    { Cancel(); return null; }
                    speed = movement.z / (float)(sample.TimeSeconds - windupAt);
                    float horizontal = new Vector2(movement.x, movement.z).magnitude;
                    recognized = elapsed >= active.MinimumDurationSeconds && speed >= active.ThrowMinSpeed
                        && movement.z >= active.ThrowMinDistance
                        && movement.z >= horizontal * Mathf.Cos(active.ThrowMaxAngleDegrees * Mathf.Deg2Rad)
                        && Mathf.Abs(movement.y) <= movement.magnitude * active.MaxVerticalRatio;
                }
            }
            else
            {
                if (Vector3.Distance(previous, point) > .002f)
                {
                    if (points.Count >= 512) { Cancel(); return null; }
                    points.Add(point);
                    previous = point;
                }
                recognized = elapsed >= active.MinimumDurationSeconds && Circle(out radius);
            }
            previousAt = sample.TimeSeconds;
            if (!recognized) return null;
            var result = new GestureRecognition
            {
                Kind = kind, Hand = hand, StartedAtSeconds = startedAt, RecognizedAtSeconds = sample.TimeSeconds,
                Position = sample.HandPosition, Direction = forward, ForwardSpeed = speed, CircleRadius = radius,
            };
            Cancel();
            return result;
        }

        public void Cancel()
        {
            IsCapturing = false; woundUp = false; points.Clear();
        }

        private Vector3 Local(GestureSample sample)
        {
            Vector3 delta = sample.HandPosition - sample.HeadPosition;
            return new Vector3(Vector3.Dot(delta, right), delta.y, Vector3.Dot(delta, forward));
        }

        private bool Circle(out float radius)
        {
            radius = 0;
            if (points.Count < active.CircleMinSamples) return false;
            // Equal-distance samples prevent a slow segment from biasing the fitted center.
            var samples = new Vector3[64];
            float length = 0;
            for (int i = 1; i < points.Count; i++) length += Vector3.Distance(points[i - 1], points[i]);
            if (length < active.CircleMinRadius * 5) return false;
            float walked = 0;
            int segment = 1;
            for (int i = 0; i < samples.Length; i++)
            {
                float distance = length * i / (samples.Length - 1);
                while (segment < points.Count - 1 && walked + Vector3.Distance(points[segment - 1], points[segment]) < distance)
                { walked += Vector3.Distance(points[segment - 1], points[segment]); segment++; }
                float segmentLength = Vector3.Distance(points[segment - 1], points[segment]);
                samples[i] = Vector3.Lerp(points[segment - 1], points[segment], (distance - walked) / Mathf.Max(segmentLength, .000001f));
            }
            Vector3 center = Vector3.zero;
            foreach (var p in samples) center += p;
            center /= samples.Length;
            foreach (var p in samples) radius += new Vector2(p.x - center.x, p.y - center.y).magnitude;
            radius /= samples.Length;
            if (radius < active.CircleMinRadius || radius > active.CircleMaxRadius
                || Vector3.Distance(samples[0], samples[samples.Length - 1]) > radius * active.CircleClosureRatio) return false;
            float totalAngle = 0, absoluteAngle = 0;
            for (int i = 0; i < samples.Length; i++)
            {
                Vector3 d = samples[i] - center;
                if (Mathf.Abs(new Vector2(d.x, d.y).magnitude - radius) > radius * active.CircleMaxRadialError
                    || Mathf.Abs(d.z) > active.CircleMaxDepth) return false;
                if (i == 0) continue;
                Vector3 previousDelta = samples[i - 1] - center;
                float angle = Mathf.Atan2(previousDelta.x * d.y - previousDelta.y * d.x,
                    previousDelta.x * d.x + previousDelta.y * d.y) * Mathf.Rad2Deg;
                totalAngle += angle; absoluteAngle += Mathf.Abs(angle);
            }
            return Mathf.Abs(totalAngle) >= active.CircleMinAngleDegrees
                && (absoluteAngle - Mathf.Abs(totalAngle)) / Mathf.Max(absoluteAngle * 2, .001f) <= active.CircleMaxReverseRatio;
        }

        private static bool Valid(GestureSample sample) => sample.TrackingValid && sample.TimeSeconds >= 0 && Finite(sample.TimeSeconds)
            && Valid(sample.HandPosition) && Valid(sample.HeadPosition) && Valid(sample.HeadForward);
        private static bool Valid(Vector3 v) => Finite(v.x) && Finite(v.y) && Finite(v.z);
        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}

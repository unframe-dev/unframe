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
        public float WindupBackDistance = .12f;
        public float WindupMaxAngleDegrees = 35;
        public float ThrowMinSpeed = 1.2f;
        public float ThrowMinDistance = .2f;
        public float ThrowStartDistance = .01f;
        public float ThrowSpeedWindowSeconds = .12f;
        public float ThrowMaxAngleDegrees = 35;
        public float CircleMinRadius = .08f;
        public float CircleMaxRadius = .6f;
        public float CircleMaxRadialError = .22f;
        public float CircleMaxAspectRatio = 2;
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
                || MaximumDurationSeconds < MinimumDurationSeconds || ThrowMaxAngleDegrees >= 90 || WindupMaxAngleDegrees >= 90
                || CircleMinAngleDegrees > 360 || CircleMaxReverseRatio >= 1 || CircleMaxAspectRatio < 1)
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
        public IReadOnlyList<Vector3> WorldPath { get; internal set; } = Array.AsReadOnly(Array.Empty<Vector3>());
    }

    public sealed class VisualGestureRecognizer
    {
        private readonly GestureRecognitionSettings settings;
        private GestureRecognitionSettings active;
        private readonly List<Vector3> points = new List<Vector3>();
        private readonly List<Vector3> worldPoints = new List<Vector3>();
        private VisualGesture kind;
        private GestureHand hand;
        private Vector3 forward, right, start, previous, windup;
        private double startedAt, previousAt, swingStartedAt;
        private bool woundUp, swinging;
        private readonly List<double> speedTimes = new List<double>();
        private readonly List<Vector3> speedPositions = new List<Vector3>();
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
            if (kind == VisualGesture.Circle) worldPoints.Add(sample.HandPosition);
            IsCapturing = true;
            return true;
        }

        public GestureRecognition Update(GestureSample sample)
        {
            if (!IsCapturing) return null;
            double elapsed = sample.TimeSeconds - startedAt;
            double dt = sample.TimeSeconds - previousAt;
            if (!Valid(sample)) { Stop(); return null; }
            if (dt <= 0 || dt > active.MaximumSampleGapSeconds) { Stop(); return null; }
            if (elapsed > active.MaximumDurationSeconds) { Stop(); return null; }
            Vector3 point = Local(sample);
            float speed = 0, radius = 0;
            bool recognized = false;
            if (kind == VisualGesture.Throw)
            {
                Vector3 fromStart = point - start;
                if (!woundUp && fromStart.z <= -active.WindupBackDistance
                    && -fromStart.z >= fromStart.magnitude * Mathf.Cos(active.WindupMaxAngleDegrees * Mathf.Deg2Rad))
                { woundUp = true; windup = point; }
                if (woundUp && !swinging && point.z < windup.z) windup = point;
                if (woundUp)
                {
                    Vector3 movement = point - windup;
                    if (!swinging && movement.z >= active.ThrowStartDistance)
                    {
                        swinging = true;
                        swingStartedAt = previousAt;
                        speedTimes.Add(swingStartedAt);
                        speedPositions.Add(previous);
                    }
                    Vector3 velocity = swinging ? SampleThrowVelocity(point, sample.TimeSeconds) : Vector3.zero;
                    if (!IsCapturing) return null;
                    speed = velocity.z;
                    bool forwardDirection = velocity.z >= velocity.magnitude * Mathf.Cos(active.ThrowMaxAngleDegrees * Mathf.Deg2Rad);
                    recognized = swinging && elapsed >= active.MinimumDurationSeconds && speed >= active.ThrowMinSpeed
                        && movement.z >= active.ThrowMinDistance
                        && forwardDirection;
                }
            }
            else
            {
                if (Vector3.Distance(previous, point) > .002f)
                {
                    if (points.Count >= 512) { Stop(); return null; }
                    points.Add(point);
                    worldPoints.Add(sample.HandPosition);
                    previous = point;
                }
                recognized = elapsed >= active.MinimumDurationSeconds && Circle(out radius);
            }
            if (kind == VisualGesture.Throw) previous = point;
            previousAt = sample.TimeSeconds;
            if (!recognized) return null;
            var result = new GestureRecognition
            {
                Kind = kind,
                Hand = hand,
                StartedAtSeconds = startedAt,
                RecognizedAtSeconds = sample.TimeSeconds,
                Position = sample.HandPosition,
                Direction = forward,
                ForwardSpeed = speed,
                CircleRadius = radius,
                WorldPath = Array.AsReadOnly(worldPoints.ToArray()),
            };
            Stop();
            return result;
        }

        public void Cancel() => Stop();

        private void Stop()
        {
            IsCapturing = false; woundUp = false; swinging = false; points.Clear(); worldPoints.Clear();
            speedTimes.Clear(); speedPositions.Clear();
        }

        private Vector3 SampleThrowVelocity(Vector3 position, double time)
        {
            speedTimes.Add(time);
            speedPositions.Add(position);
            double cutoff = Math.Max(swingStartedAt, time - active.ThrowSpeedWindowSeconds);
            while (speedTimes.Count > 2 && speedTimes[1] <= cutoff)
            { speedTimes.RemoveAt(0); speedPositions.RemoveAt(0); }
            if (speedTimes.Count > 512) { Stop(); return Vector3.zero; }
            double firstTime = Math.Max(cutoff, speedTimes[0]);
            Vector3 firstPosition = speedPositions[0];
            if (firstTime > speedTimes[0])
                firstPosition = Vector3.Lerp(speedPositions[0], speedPositions[1],
                    (float)((firstTime - speedTimes[0]) / (speedTimes[1] - speedTimes[0])));
            return (position - firstPosition) / (float)(time - firstTime);
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
            float covarianceXX = 0, covarianceXY = 0, covarianceYY = 0;
            foreach (var p in samples)
            {
                Vector3 d = p - center;
                covarianceXX += d.x * d.x;
                covarianceXY += d.x * d.y;
                covarianceYY += d.y * d.y;
            }
            float axisAngle = .5f * Mathf.Atan2(2 * covarianceXY, covarianceXX - covarianceYY);
            Vector2 axis = new Vector2(Mathf.Cos(axisAngle), Mathf.Sin(axisAngle));
            Vector2 perpendicular = new Vector2(-axis.y, axis.x);
            Vector2 minimum = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            Vector2 maximum = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            foreach (var p in samples)
            {
                Vector3 d = p - center;
                var projected = new Vector2(d.x * axis.x + d.y * axis.y, d.x * perpendicular.x + d.y * perpendicular.y);
                minimum = Vector2.Min(minimum, projected);
                maximum = Vector2.Max(maximum, projected);
            }
            Vector2 halfAxes = (maximum - minimum) * .5f;
            Vector2 axisCenter = (maximum + minimum) * .5f;
            center.x += axis.x * axisCenter.x + perpendicular.x * axisCenter.y;
            center.y += axis.y * axisCenter.x + perpendicular.y * axisCenter.y;
            float major = Mathf.Max(halfAxes.x, halfAxes.y);
            float minor = Mathf.Min(halfAxes.x, halfAxes.y);
            float aspectRatio = major / Mathf.Max(minor, .000001f);
            // Polygon samples can miss the minor-axis extremum and slightly overestimate the ratio.
            bool aspectAllowed = minor > .000001f && aspectRatio <= active.CircleMaxAspectRatio * 1.01f;
            foreach (var p in samples) radius += new Vector2(p.x - center.x, p.y - center.y).magnitude;
            radius /= samples.Length;
            float totalAngle = 0, absoluteAngle = 0;
            float maxRadialError = 0, maxDepth = 0;
            for (int i = 0; i < samples.Length; i++)
            {
                Vector3 d = samples[i] - center;
                var normalized = new Vector2(
                    (d.x * axis.x + d.y * axis.y) / Mathf.Max(halfAxes.x, .000001f),
                    (d.x * perpendicular.x + d.y * perpendicular.y) / Mathf.Max(halfAxes.y, .000001f));
                maxRadialError = Mathf.Max(maxRadialError, Mathf.Abs(normalized.magnitude - 1));
                maxDepth = Mathf.Max(maxDepth, Mathf.Abs(d.z));
                if (i == 0) continue;
                Vector3 previousDelta = samples[i - 1] - center;
                float angle = Mathf.Atan2(previousDelta.x * d.y - previousDelta.y * d.x,
                    previousDelta.x * d.x + previousDelta.y * d.y) * Mathf.Rad2Deg;
                totalAngle += angle; absoluteAngle += Mathf.Abs(angle);
            }
            return radius >= active.CircleMinRadius && radius <= active.CircleMaxRadius
                && aspectAllowed
                && Vector3.Distance(samples[0], samples[samples.Length - 1]) <= radius * active.CircleClosureRatio
                && maxRadialError <= active.CircleMaxRadialError && maxDepth <= active.CircleMaxDepth
                && Mathf.Abs(totalAngle) >= active.CircleMinAngleDegrees
                && (absoluteAngle - Mathf.Abs(totalAngle)) / Mathf.Max(absoluteAngle * 2, .001f) <= active.CircleMaxReverseRatio;
        }

        private static bool Valid(GestureSample sample) => sample.TrackingValid && sample.TimeSeconds >= 0 && Finite(sample.TimeSeconds)
            && Valid(sample.HandPosition) && Valid(sample.HeadPosition) && Valid(sample.HeadForward);
        private static bool Valid(Vector3 v) => Finite(v.x) && Finite(v.y) && Finite(v.z);
        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}

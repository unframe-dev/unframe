using System;
using System.Collections.Generic;
using UnityEngine;

namespace Unframe.Unity.VisualEffects.Gestures
{
    public readonly struct GesturePositionSample
    {
        public VisualGesture Gesture { get; }
        public GestureHand Hand { get; }
        public double TimeSeconds { get; }
        public Vector3 Position { get; }

        public GesturePositionSample(VisualGesture gesture, GestureHand hand, double timeSeconds, Vector3 position)
        {
            Gesture = gesture;
            Hand = hand;
            TimeSeconds = timeSeconds;
            Position = position;
        }
    }

    public sealed class GesturePositionSampler
    {
        private readonly Dictionary<int, double> lastEmitted = new Dictionary<int, double>();
        private readonly Dictionary<int, double> lastSeen = new Dictionary<int, double>();
        private double intervalSeconds = .05;
        private bool enabled = true;

        public double IntervalSeconds
        {
            get => intervalSeconds;
            set
            {
                if (!Finite(value) || value <= 0) throw new ArgumentOutOfRangeException(nameof(value));
                if (intervalSeconds == value) return;
                intervalSeconds = value;
                Reset();
            }
        }

        public bool Enabled
        {
            get => enabled;
            set { if (enabled != value) Reset(); enabled = value; }
        }

        public GesturePositionSample? Sample(VisualGesture gesture, GestureHand hand, GestureSample sample)
        {
            if (!Enum.IsDefined(typeof(VisualGesture), gesture)) throw new ArgumentOutOfRangeException(nameof(gesture));
            if (!Enum.IsDefined(typeof(GestureHand), hand)) throw new ArgumentOutOfRangeException(nameof(hand));
            int key = (int)gesture * 2 + (int)hand;
            if (!enabled || !sample.TrackingValid || !Finite(sample.TimeSeconds) || sample.TimeSeconds < 0
                || !Finite(sample.HandPosition.x) || !Finite(sample.HandPosition.y) || !Finite(sample.HandPosition.z))
            {
                Clear(key);
                return null;
            }
            if (lastSeen.TryGetValue(key, out double previous) && sample.TimeSeconds < previous)
            {
                Clear(key);
                lastSeen[key] = sample.TimeSeconds;
                return null;
            }
            lastSeen[key] = sample.TimeSeconds;
            if (lastEmitted.TryGetValue(key, out double emitted) && sample.TimeSeconds - emitted < intervalSeconds) return null;
            lastEmitted[key] = sample.TimeSeconds;
            return new GesturePositionSample(gesture, hand, sample.TimeSeconds, sample.HandPosition);
        }

        public void Reset() { lastEmitted.Clear(); lastSeen.Clear(); }
        private void Clear(int key) { lastEmitted.Remove(key); lastSeen.Remove(key); }
        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}

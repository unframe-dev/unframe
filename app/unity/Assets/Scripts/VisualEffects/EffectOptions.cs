using System;
using UnityEngine;

namespace Unframe.Unity.VisualEffects
{
    public sealed class EffectOptions
    {
        public string RunId { get; }
        public float Size { get; }
        public Color Color { get; }
        public float Speed { get; }
        public float WaveCycles { get; }
        public double DurationMs { get; }
        public uint Seed { get; }
        public double StartedAtRuntimeMs { get; }

        public EffectOptions(string runId, float size, Color color, float speed, double durationMs, uint seed, double startedAtRuntimeMs, float waveCycles = 1)
        {
            if (string.IsNullOrWhiteSpace(runId)) throw new ArgumentException("A run ID is required.", nameof(runId));
            Positive(size, nameof(size));
            Positive(speed, nameof(speed));
            Positive(durationMs, nameof(durationMs));
            Time(startedAtRuntimeMs);
            if (!Finite(waveCycles) || waveCycles < 0 || waveCycles > 6) throw new ArgumentOutOfRangeException(nameof(waveCycles));
            WaveCycles = waveCycles;
            foreach (var component in new[] { color.r, color.g, color.b, color.a })
                if (!Finite(component) || component < 0 || component > 1) throw new ArgumentOutOfRangeException(nameof(color));
            RunId = runId;
            Size = size;
            Color = color;
            Speed = speed;
            DurationMs = durationMs;
            Seed = seed;
            StartedAtRuntimeMs = startedAtRuntimeMs;
        }

        public float Sample(double runtimeMs)
        {
            Time(runtimeMs);
            return (float)Math.Max(0, Math.Min(1, (runtimeMs - StartedAtRuntimeMs) * Speed / DurationMs));
        }

        internal static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        internal static void Time(double value)
        {
            if (!Finite(value) || value < 0) throw new ArgumentOutOfRangeException(nameof(value));
        }
        private static void Positive(double value, string name)
        {
            if (!Finite(value) || value <= 0) throw new ArgumentOutOfRangeException(name);
        }
    }
}

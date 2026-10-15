using System.Collections.Generic;
using UnityEngine;

public sealed class ArucoOriginStability
{
    public const int MinimumSamples = 8;
    public const double MinimumStableDurationSeconds = 1;
    public const double MaximumObservationGapSeconds = 0.5;
    public const float MaximumPositionDeviationMeters = 0.02f;
    public const float MaximumRotationDeviationDegrees = 3;

    private readonly List<Pose> samples = new List<Pose>();
    private bool hasTimestamp;
    private long lastTimestamp;
    private double firstObservedAt;
    private double lastObservedAt;
    private Vector3 positionSum;
    private Vector4 rotationSum;

    public bool IsConfirmed { get; private set; }
    public bool HasPose { get; private set; }
    public Pose Pose { get; private set; } = Pose.identity;
    public int SampleCount => samples.Count;
    public double StableDurationSeconds { get; private set; }

    public bool Observe(Pose worldMarkerPose, long timestamp, double now, bool qualityValid = true)
    {
        if (IsConfirmed || (hasTimestamp && timestamp <= lastTimestamp)) return false;
        hasTimestamp = true;
        lastTimestamp = timestamp;

        if (!qualityValid)
        {
            ObserveMissing(now);
            return false;
        }

        if (!IsFinite(now) || !TryNormalize(worldMarkerPose, out Pose observation))
        {
            ClearWindow();
            return false;
        }

        if (HasPose && (now < lastObservedAt || now - lastObservedAt > MaximumObservationGapSeconds))
            ClearWindow();

        if (!HasPose)
        {
            StartWindow(observation, now);
            return true;
        }

        Quaternion rotation = SameHemisphere(observation.rotation, samples[0].rotation);
        Vector3 nextPositionSum = positionSum + observation.position;
        Vector4 nextRotationSum = rotationSum + Components(rotation);
        Pose average = new Pose(nextPositionSum / (samples.Count + 1), Normalized(nextRotationSum));
        bool stable = WithinTolerance(observation, samples[0]) && WithinTolerance(observation, average);
        for (int i = 0; stable && i < samples.Count; i++)
            stable = WithinTolerance(samples[i], average);

        if (!stable)
        {
            ClearWindow();
            StartWindow(observation, now);
            return true;
        }

        samples.Add(observation);
        positionSum = nextPositionSum;
        rotationSum = nextRotationSum;
        Pose = average;
        lastObservedAt = now;
        StableDurationSeconds = now - firstObservedAt;
        IsConfirmed = samples.Count >= MinimumSamples && StableDurationSeconds >= MinimumStableDurationSeconds;
        return true;
    }

    public void ObserveMissing(double now)
    {
        if (!IsConfirmed && HasPose
            && (!IsFinite(now) || now < lastObservedAt
                || now - lastObservedAt > MaximumObservationGapSeconds))
            ClearWindow();
    }

    public void Reset()
    {
        IsConfirmed = false;
        hasTimestamp = false;
        lastTimestamp = 0;
        ClearWindow();
    }

    private void StartWindow(Pose observation, double now)
    {
        samples.Add(observation);
        positionSum = observation.position;
        rotationSum = Components(observation.rotation);
        firstObservedAt = now;
        lastObservedAt = now;
        Pose = observation;
        HasPose = true;
    }

    private void ClearWindow()
    {
        samples.Clear();
        positionSum = Vector3.zero;
        rotationSum = Vector4.zero;
        firstObservedAt = 0;
        lastObservedAt = 0;
        StableDurationSeconds = 0;
        HasPose = false;
        Pose = Pose.identity;
    }

    private static bool WithinTolerance(Pose observation, Pose reference)
    {
        return Vector3.Distance(observation.position, reference.position) <= MaximumPositionDeviationMeters
            && Quaternion.Angle(observation.rotation, reference.rotation) <= MaximumRotationDeviationDegrees;
    }

    private static bool TryNormalize(Pose value, out Pose normalized)
    {
        normalized = Pose.identity;
        Vector3 position = value.position;
        Vector4 rotation = Components(value.rotation);
        float magnitude = rotation.magnitude;
        if (!IsFinite(position.x) || !IsFinite(position.y) || !IsFinite(position.z)
            || !IsFinite(magnitude) || magnitude < 0.000001f) return false;
        normalized = new Pose(position, Normalized(rotation));
        return true;
    }

    private static Quaternion SameHemisphere(Quaternion value, Quaternion reference)
    {
        return Quaternion.Dot(value, reference) < 0
            ? new Quaternion(-value.x, -value.y, -value.z, -value.w)
            : value;
    }

    private static Vector4 Components(Quaternion value) => new Vector4(value.x, value.y, value.z, value.w);

    private static Quaternion Normalized(Vector4 value)
    {
        Vector4 unit = value / value.magnitude;
        return new Quaternion(unit.x, unit.y, unit.z, unit.w);
    }

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}

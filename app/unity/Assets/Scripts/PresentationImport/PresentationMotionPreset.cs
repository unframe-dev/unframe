using UnityEngine;

public sealed class PresentationMotionPreset
{
    public PresentationMotionPreset(
        string id,
        Vector3 direction,
        float minimumDistance,
        float maximumDuration,
        float minimumSpeed
    )
    {
        Id = id;
        Direction = direction.normalized;
        MinimumDistance = minimumDistance;
        MaximumDuration = maximumDuration;
        MinimumSpeed = minimumSpeed;
    }

    public string Id { get; }
    public Vector3 Direction { get; }
    public float MinimumDistance { get; }
    public float MaximumDuration { get; }
    public float MinimumSpeed { get; }
}

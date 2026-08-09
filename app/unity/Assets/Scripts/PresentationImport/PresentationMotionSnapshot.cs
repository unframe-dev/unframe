using UnityEngine;

public sealed class PresentationMotionSnapshot
{
    public PresentationMotionSnapshot(
        Vector3 startPosition,
        Vector3 currentPosition,
        float duration,
        bool triggerButtonHeld
    )
        : this(
            startPosition,
            currentPosition,
            Quaternion.identity,
            Quaternion.identity,
            duration,
            triggerButtonHeld
        ) { }

    public PresentationMotionSnapshot(
        Vector3 startPosition,
        Vector3 currentPosition,
        Quaternion startRotation,
        Quaternion currentRotation,
        float duration,
        bool triggerButtonHeld
    )
    {
        StartPosition = startPosition;
        CurrentPosition = currentPosition;
        StartRotation = startRotation;
        CurrentRotation = currentRotation;
        Duration = duration;
        TriggerButtonHeld = triggerButtonHeld;
    }

    public Vector3 StartPosition { get; }
    public Vector3 CurrentPosition { get; }
    public Quaternion StartRotation { get; }
    public Quaternion CurrentRotation { get; }
    public float Duration { get; }
    public bool TriggerButtonHeld { get; }
    public Vector3 Displacement => CurrentPosition - StartPosition;
    public float Distance => Displacement.magnitude;
}

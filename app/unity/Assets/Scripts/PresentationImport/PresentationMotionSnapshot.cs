using UnityEngine;

public sealed class PresentationMotionSnapshot
{
    public PresentationMotionSnapshot(
        Vector3 previousPosition,
        Vector3 currentPosition,
        float duration,
        bool triggerButtonHeld
    )
    {
        PreviousPosition = previousPosition;
        CurrentPosition = currentPosition;
        Duration = duration;
        TriggerButtonHeld = triggerButtonHeld;
    }

    public Vector3 PreviousPosition { get; }
    public Vector3 CurrentPosition { get; }
    public float Duration { get; }
    public bool TriggerButtonHeld { get; }
    public Vector3 Displacement => CurrentPosition - PreviousPosition;
    public float Distance => Displacement.magnitude;
}

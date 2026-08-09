using UnityEngine;

public sealed class PresentationMotionTracker
{
    private Vector3 startPosition;
    private Quaternion startRotation;
    private float duration;
    private bool tracking;

    public bool TryUpdate(
        bool triggerButtonHeld,
        Vector3 currentPosition,
        float deltaTime,
        out PresentationMotionSnapshot snapshot
    )
    {
        return TryUpdate(
            triggerButtonHeld,
            currentPosition,
            Quaternion.identity,
            deltaTime,
            out snapshot
        );
    }

    public bool TryUpdate(
        bool triggerButtonHeld,
        Vector3 currentPosition,
        Quaternion currentRotation,
        float deltaTime,
        out PresentationMotionSnapshot snapshot
    )
    {
        snapshot = null;
        if (!triggerButtonHeld)
        {
            Reset();
            return false;
        }

        if (!tracking)
        {
            startPosition = currentPosition;
            startRotation = currentRotation;
            duration = 0f;
            tracking = true;
            return false;
        }

        duration += Mathf.Max(deltaTime, 0f);
        snapshot = new PresentationMotionSnapshot(
            startPosition,
            currentPosition,
            startRotation,
            currentRotation,
            duration,
            true
        );
        return true;
    }

    public void Reset()
    {
        startPosition = Vector3.zero;
        startRotation = Quaternion.identity;
        duration = 0f;
        tracking = false;
    }
}

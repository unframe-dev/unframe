using UnityEngine;

public sealed class MotionPresentationTriggerEvaluator : IPresentationTriggerEvaluator
{
    public bool CanEvaluate(PresentationTrigger trigger)
    {
        return trigger != null && trigger.type == "motion";
    }

    public bool Evaluate(PresentationTrigger trigger, PresentationTriggerContext context)
    {
        if (!CanEvaluate(trigger) || context?.Motion == null || !context.Motion.TriggerButtonHeld)
        {
            return false;
        }

        PresentationMotionSnapshot motion = context.Motion;
        TriggerCondition condition = trigger.condition;
        PresentationMotionPreset preset = null;
        if (!string.IsNullOrEmpty(trigger.reference) &&
            !PresentationMotionPresets.TryResolve(trigger.reference, out preset))
        {
            return false;
        }

        Vector3 direction = ResolveDirection(condition, preset);
        if (direction.sqrMagnitude < 0.0001f || motion.Distance < ResolveMinimumDistance(condition, preset))
        {
            return false;
        }

        if (condition != null && condition.maximumDuration > 0f &&
            motion.Duration > condition.maximumDuration)
        {
            return false;
        }

        float speed = motion.Distance / Mathf.Max(motion.Duration, 0.0001f);
        if (speed < ResolveMinimumSpeed(condition, preset))
        {
            return false;
        }

        return Vector3.Dot(motion.Displacement.normalized, direction.normalized) >= 0.7f;
    }

    private static Vector3 ResolveDirection(
        TriggerCondition condition,
        PresentationMotionPreset preset
    )
    {
        if (condition?.direction != null && condition.direction.Length >= 3)
        {
            return new Vector3(condition.direction[0], condition.direction[1], condition.direction[2]);
        }

        return preset?.Direction ?? Vector3.zero;
    }

    private static float ResolveMinimumDistance(
        TriggerCondition condition,
        PresentationMotionPreset preset
    )
    {
        return condition != null && condition.minimumDistance > 0f
            ? condition.minimumDistance
            : preset?.MinimumDistance ?? 0f;
    }

    private static float ResolveMinimumSpeed(
        TriggerCondition condition,
        PresentationMotionPreset preset
    )
    {
        return condition != null && condition.minimumSpeed > 0f
            ? condition.minimumSpeed
            : preset?.MinimumSpeed ?? 0f;
    }
}

public sealed class PresentationRuntimeState
{
    public string CurrentGroupId { get; private set; }
    public string CurrentStepId { get; private set; }

    public void Reset(PresentationData presentation)
    {
        CurrentGroupId = null;
        CurrentStepId = null;

        if (presentation?.groups == null || presentation.groups.Length == 0)
        {
            return;
        }

        SetGroup(presentation.groups[0]);
    }

    public bool SetGroup(PresentationGroup group)
    {
        if (group == null || string.IsNullOrEmpty(group.id))
        {
            return false;
        }

        CurrentGroupId = group.id;
        CurrentStepId = group.steps != null && group.steps.Length > 0
            ? group.steps[0].id
            : null;
        return true;
    }

    public bool SetStep(PresentationGroup group, string stepId)
    {
        if (group == null || group.steps == null || string.IsNullOrEmpty(stepId))
        {
            return false;
        }

        foreach (PresentationStep step in group.steps)
        {
            if (step != null && step.id == stepId)
            {
                CurrentGroupId = group.id;
                CurrentStepId = step.id;
                return true;
            }
        }

        return false;
    }
}

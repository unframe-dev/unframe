using System.Collections.Generic;

public sealed class PresentationRuntimeState
{
    public string CurrentGroupId { get; private set; }
    public string CurrentStepId { get; private set; }

    private readonly HashSet<string> consumedCueIds = new HashSet<string>();
    private readonly PresentationTriggerEvaluator triggerEvaluator;

    public PresentationRuntimeState(PresentationTriggerEvaluator triggerEvaluator = null)
    {
        this.triggerEvaluator = triggerEvaluator ?? new PresentationTriggerEvaluator();
    }

    public void Reset(PresentationData presentation)
    {
        CurrentGroupId = null;
        CurrentStepId = null;
        consumedCueIds.Clear();

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
        consumedCueIds.Clear();
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
                consumedCueIds.Clear();
                return true;
            }
        }

        return false;
    }

    public bool TryProcessInput(
        PresentationData presentation,
        string input,
        out PresentationCue triggeredCue
    )
    {
        return TryProcessTrigger(
            presentation,
            new PresentationTriggerContext(input),
            out triggeredCue
        );
    }

    public bool TryProcessTrigger(
        PresentationData presentation,
        PresentationTriggerContext context,
        out PresentationCue triggeredCue
    )
    {
        triggeredCue = null;
        if (presentation?.groups == null || string.IsNullOrEmpty(CurrentGroupId) ||
            string.IsNullOrEmpty(CurrentStepId) || context == null)
        {
            return false;
        }

        PresentationGroup group = FindGroup(presentation, CurrentGroupId);
        PresentationStep step = FindStep(group, CurrentStepId);
        if (step?.cues == null)
        {
            return false;
        }

        foreach (PresentationCue cue in step.cues)
        {
            if (!triggerEvaluator.Evaluate(
                    cue?.trigger,
                    context
                ) || IsConsumed(cue))
            {
                continue;
            }

            if (!string.IsNullOrEmpty(cue.nextStep) && FindStep(group, cue.nextStep) == null)
            {
                return false;
            }

            consumedCueIds.Add(cue.id);
            triggeredCue = cue;
            if (!string.IsNullOrEmpty(cue.nextStep))
            {
                SetStep(group, cue.nextStep);
            }

            return true;
        }

        return false;
    }

    private bool IsConsumed(PresentationCue cue)
    {
        return cue != null && !string.IsNullOrEmpty(cue.id) && consumedCueIds.Contains(cue.id);
    }

    private static PresentationGroup FindGroup(PresentationData presentation, string groupId)
    {
        foreach (PresentationGroup group in presentation.groups)
        {
            if (group != null && group.id == groupId)
            {
                return group;
            }
        }

        return null;
    }

    private static PresentationStep FindStep(PresentationGroup group, string stepId)
    {
        if (group?.steps == null)
        {
            return null;
        }

        foreach (PresentationStep step in group.steps)
        {
            if (step != null && step.id == stepId)
            {
                return step;
            }
        }

        return null;
    }
}

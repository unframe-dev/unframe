public sealed class InputPresentationTriggerEvaluator : IPresentationTriggerEvaluator
{
    public bool CanEvaluate(PresentationTrigger trigger)
    {
        return trigger != null && trigger.type == "input";
    }

    public bool Evaluate(PresentationTrigger trigger, PresentationTriggerContext context)
    {
        if (!CanEvaluate(trigger) || context == null || trigger.condition == null)
        {
            return false;
        }

        TriggerCondition condition = trigger.condition;
        if (string.IsNullOrEmpty(condition.input))
        {
            return false;
        }

        bool stateMatches = string.IsNullOrEmpty(condition.state) ||
            condition.state == context.State ||
            (condition.state == "down" && context.State == "pressed");
        return stateMatches && condition.input == context.Input;
    }
}

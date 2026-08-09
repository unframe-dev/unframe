public interface IPresentationTriggerEvaluator
{
    bool CanEvaluate(PresentationTrigger trigger);

    bool Evaluate(PresentationTrigger trigger, PresentationTriggerContext context);
}

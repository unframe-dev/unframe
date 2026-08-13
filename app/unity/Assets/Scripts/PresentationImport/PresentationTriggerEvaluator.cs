using System.Collections.Generic;

public sealed class PresentationTriggerEvaluator
{
    private readonly IReadOnlyList<IPresentationTriggerEvaluator> evaluators;

    public PresentationTriggerEvaluator()
        : this(new IPresentationTriggerEvaluator[]
        {
            new InputPresentationTriggerEvaluator(),
            new MotionPresentationTriggerEvaluator()
        })
    {
    }

    public PresentationTriggerEvaluator(IReadOnlyList<IPresentationTriggerEvaluator> evaluators)
    {
        this.evaluators = evaluators ?? new IPresentationTriggerEvaluator[0];
    }

    public bool Evaluate(PresentationTrigger trigger, PresentationTriggerContext context)
    {
        foreach (IPresentationTriggerEvaluator evaluator in evaluators)
        {
            if (evaluator.CanEvaluate(trigger))
            {
                return evaluator.Evaluate(trigger, context);
            }
        }

        return false;
    }
}

using UnityEngine;

public sealed class PresentationTriggerContext
{
    public PresentationTriggerContext(
        string input,
        string state = "pressed",
        PresentationMotionSnapshot motion = null
    )
    {
        Input = input;
        State = state;
        Motion = motion;
    }

    public string Input { get; }
    public string State { get; }
    public PresentationMotionSnapshot Motion { get; }
}

using UnityEngine;

public sealed class PresentationRuntimeSession : MonoBehaviour
{
    [SerializeField] private PresentationJsonImporter importer;
    [SerializeField] private bool enableRuntimeLogs = true;

    public PresentationRuntimeState State { get; } = new PresentationRuntimeState();

    private IPresentationRuntimeLogger runtimeLogger;

    private void Awake()
    {
        importer ??= GetComponent<PresentationJsonImporter>();
        runtimeLogger = new UnityPresentationRuntimeLogger(enableRuntimeLogs);
        if (importer != null)
        {
            importer.SetRuntimeLogger(runtimeLogger);
            importer.Imported += HandleImported;
        }
    }

    private void OnDestroy()
    {
        if (importer != null)
        {
            importer.Imported -= HandleImported;
        }
    }

    private void HandleImported(PresentationDocument document)
    {
        State.Reset(document.presentation);
        runtimeLogger.Info(
            $"State: group={State.CurrentGroupId}, step={State.CurrentStepId ?? "none"}."
        );
    }

    public bool ProcessInput(string input)
    {
        return ProcessTrigger(new PresentationTriggerContext(input));
    }

    public bool ProcessTrigger(PresentationTriggerContext context)
    {
        if (importer == null || importer.Document?.presentation == null || context == null)
        {
            runtimeLogger?.Warning("Input ignored because no presentation is loaded.");
            return false;
        }

        runtimeLogger.Info(
            $"Trigger context: input={context.Input ?? "none"}, " +
            $"motion={(context.Motion == null ? "none" : "available")}."
        );
        string previousStepId = State.CurrentStepId;
        if (!State.TryProcessTrigger(
                importer.Document.presentation,
                context,
                out PresentationCue cue
            ))
        {
            runtimeLogger.Info($"Input ignored at step={State.CurrentStepId ?? "none"}.");
            return false;
        }

        runtimeLogger.Info(
            $"Cue triggered: {cue.id}, " +
            $"actions={cue.actions?.Length ?? 0}, " +
            $"nextStep={cue.nextStep ?? "none"}."
        );
        PresentationActionExecutor executor = new PresentationActionExecutor(
            importer.Elements,
            runtimeLogger
        );
        if (cue.actions == null)
        {
            return true;
        }

        foreach (PresentationAction action in cue.actions)
        {
            executor.Execute(action);
        }

        if (previousStepId != State.CurrentStepId)
        {
            runtimeLogger.Info(
                $"State changed: {previousStepId ?? "none"} -> {State.CurrentStepId ?? "none"}."
            );
        }

        return true;
    }
}

using UnityEngine;

public sealed class PresentationRuntimeSession : MonoBehaviour
{
    [SerializeField] private PresentationJsonImporter importer;

    public PresentationRuntimeState State { get; } = new PresentationRuntimeState();

    private void Awake()
    {
        importer ??= GetComponent<PresentationJsonImporter>();
        if (importer != null)
        {
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
    }

    public bool ProcessInput(string input)
    {
        if (importer == null || importer.Document?.presentation == null)
        {
            return false;
        }

        if (!State.TryProcessInput(importer.Document.presentation, input, out PresentationCue cue))
        {
            return false;
        }

        PresentationActionExecutor executor = new PresentationActionExecutor(importer.Elements);
        if (cue.actions == null)
        {
            return true;
        }

        foreach (PresentationAction action in cue.actions)
        {
            executor.Execute(action);
        }

        return true;
    }
}

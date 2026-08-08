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
}

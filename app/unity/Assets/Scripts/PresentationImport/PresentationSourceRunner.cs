using UnityEngine;

public sealed class PresentationSourceRunner : MonoBehaviour
{
    [SerializeField] private PresentationJsonSource source;
    [SerializeField] private PresentationJsonImporter importer;
    [SerializeField] private LocalAssetResolverComponent localAssetResolver;

    private void Start()
    {
        if (source == null)
        {
            Debug.LogError("PresentationSourceRunner: source is not assigned.");
            return;
        }

        importer ??= GetComponent<PresentationJsonImporter>();
        localAssetResolver ??= GetComponent<LocalAssetResolverComponent>();
        if (importer == null)
        {
            Debug.LogError("PresentationSourceRunner: importer is not assigned.");
            return;
        }

        if (localAssetResolver != null)
        {
            importer.SetAssetResolver(localAssetResolver.CreateResolver());
        }

        StartCoroutine(source.Load(Import, ReportSourceFailure));
    }

    private void Import(string json)
    {
        importer.Import(json);
    }

    private static void ReportSourceFailure(string message)
    {
        Debug.LogError(message);
    }
}

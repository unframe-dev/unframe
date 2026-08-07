using UnityEngine;

public sealed class PresentationJsonImporter : MonoBehaviour
{
    [SerializeField] private TextAsset presentationJson;
    [SerializeField] private bool importOnStart = true;
    [SerializeField] private Transform importRoot;

    private readonly ElementLoaderRegistry registry = new ElementLoaderRegistry();
    private IAssetResolver assetResolver = new ResourcesAssetResolver();

    public PresentationDocument Document { get; private set; }

    private void Start()
    {
        if (importOnStart && presentationJson != null)
        {
            Import(presentationJson.text);
        }
    }

    public void RegisterLoader(IElementLoader loader)
    {
        registry.Register(loader);
    }

    public void SetAssetResolver(IAssetResolver resolver)
    {
        assetResolver = resolver ?? new ResourcesAssetResolver();
    }

    public PresentationDocument Import(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            Debug.LogError("PresentationJsonImporter: JSON is empty.");
            return null;
        }

        PresentationDocument document;
        try
        {
            document = JsonUtility.FromJson<PresentationDocument>(json);
        }
        catch (System.ArgumentException exception)
        {
            Debug.LogError($"PresentationJsonImporter: invalid JSON. {exception.Message}");
            return null;
        }

        if (document == null || document.presentation == null)
        {
            Debug.LogError("PresentationJsonImporter: presentation is missing.");
            return null;
        }

        Document = document;
        Transform root = importRoot != null ? importRoot : transform;
        ImportGroups(document.presentation, root);
        return document;
    }

    private void ImportGroups(PresentationData presentation, Transform root)
    {
        if (presentation.groups == null)
        {
            return;
        }

        for (int i = 0; i < presentation.groups.Length; i++)
        {
            PresentationGroup group = presentation.groups[i];
            if (group == null)
            {
                continue;
            }

            GameObject groupObject = new GameObject(
                string.IsNullOrEmpty(group.name) ? group.id : group.name
            );
            groupObject.transform.SetParent(root, false);
            groupObject.SetActive(i == 0);

            ElementLoadContext context = new ElementLoadContext(
                groupObject.transform,
                presentation,
                assetResolver
            );
            ImportElements(group.elements, context);
            ImportDynamicGroups(group.dynamicGroups, groupObject.transform, presentation);
        }
    }

    private void ImportDynamicGroups(
        PresentationDynamicGroup[] dynamicGroups,
        Transform parent,
        PresentationData presentation
    )
    {
        if (dynamicGroups == null)
        {
            return;
        }

        foreach (PresentationDynamicGroup dynamicGroup in dynamicGroups)
        {
            if (dynamicGroup == null)
            {
                continue;
            }

            GameObject dynamicObject = new GameObject(dynamicGroup.id);
            dynamicObject.transform.SetParent(parent, false);
            ElementLoaderUtility.ApplyInitialState(
                dynamicObject,
                new ElementInitialState { active = true, transform = dynamicGroup.transform }
            );

            ImportElements(
                dynamicGroup.elements,
                new ElementLoadContext(dynamicObject.transform, presentation, assetResolver)
            );
        }
    }

    private void ImportElements(PresentationElement[] elements, ElementLoadContext context)
    {
        if (elements == null)
        {
            return;
        }

        foreach (PresentationElement element in elements)
        {
            registry.Load(element, context);
        }
    }
}

using System;
using UnityEngine;

public sealed class PresentationJsonImporter : MonoBehaviour
{
    [SerializeField] private TextAsset presentationJson;
    [SerializeField] private bool importOnStart = true;
    [SerializeField] private Transform importRoot;

    private readonly ElementLoaderRegistry registry = new ElementLoaderRegistry();
    private IAssetResolver assetResolver = new ResourcesAssetResolver();
    private IPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
    private IPresentationRuntimeLogger runtimeLogger = new UnityPresentationRuntimeLogger(false);

    public PresentationDocument Document { get; private set; }
    public ElementRuntimeRegistry Elements { get; } = new ElementRuntimeRegistry();
    public event Action<PresentationDocument> Imported;

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

    public void SetParser(IPresentationDefinitionParser definitionParser)
    {
        parser = definitionParser ?? new UnityJsonPresentationDefinitionParser();
    }

    public void SetRuntimeLogger(IPresentationRuntimeLogger logger)
    {
        runtimeLogger = logger ?? new UnityPresentationRuntimeLogger(false);
    }

    public PresentationDocument Import(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            runtimeLogger.Error("JSON is empty.");
            return null;
        }

        if (!parser.TryParse(json, out PresentationDocument document, out string error))
        {
            runtimeLogger.Error($"Invalid definition: {error}");
            return null;
        }

        Document = document;
        Elements.Clear();
        runtimeLogger.Info(
            $"Imported presentation '{document.presentation.id}' (schema {document.schemaVersion ?? "unknown"})."
        );
        Transform root = importRoot != null ? importRoot : transform;
        ImportGroups(document.presentation, root);
        Imported?.Invoke(document);
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

            ImportedGroup importedGroup = groupObject.AddComponent<ImportedGroup>();
            importedGroup.GroupId = group.id;
            importedGroup.GroupIndex = i;
            runtimeLogger.Info($"Group ready: {group.id} (active: {i == 0}).");

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
            GameObject elementObject = registry.Load(element, context);
            Elements.Register(elementObject);
        }
    }
}

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
    private Transform generatedRoot;

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
        runtimeLogger.Info($"Import started (jsonLength={json?.Length ?? 0}).");
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

        Transform parent = importRoot != null ? importRoot : transform;
        GameObject stagedRootObject = new GameObject("Presentation Import");
        Transform stagedRoot = stagedRootObject.transform;
        stagedRoot.SetParent(parent, false);
        stagedRootObject.SetActive(false);
        ElementRuntimeRegistry stagedElements = new ElementRuntimeRegistry();
        try
        {
            ImportGroups(document.presentation, stagedRoot, stagedElements);
        }
        catch (Exception exception)
        {
            DestroyObject(stagedRootObject);
            runtimeLogger.Error($"Presentation import failed: {exception.Message}");
            return null;
        }

        DestroyObject(generatedRoot != null ? generatedRoot.gameObject : null);
        generatedRoot = stagedRoot;
        Document = document;
        Elements.ReplaceWith(stagedElements);
        stagedRootObject.SetActive(true);
        runtimeLogger.Info(
            $"Imported presentation '{document.presentation.id}' (schema {document.schemaVersion ?? "unknown"})."
        );
        Imported?.Invoke(document);
        return document;
    }

    private void ImportGroups(PresentationData presentation, Transform root, ElementRuntimeRegistry elements)
    {
        if (presentation.groups == null)
        {
            return;
        }

        bool hasActiveGroup = false;
        for (int i = 0; i < presentation.groups.Length; i++)
        {
            PresentationGroup group = presentation.groups[i];
            if (group == null || string.IsNullOrEmpty(group.id))
            {
                continue;
            }

            GameObject groupObject = new GameObject(
                string.IsNullOrEmpty(group.name) ? group.id : group.name
            );
            groupObject.transform.SetParent(root, false);
            groupObject.SetActive(!hasActiveGroup);
            hasActiveGroup = true;

            ImportedGroup importedGroup = groupObject.AddComponent<ImportedGroup>();
            importedGroup.GroupId = group.id;
            importedGroup.GroupIndex = i;
            ElementLoadContext context = new ElementLoadContext(
                groupObject.transform,
                presentation,
                assetResolver
            );
            ImportElements(group.elements, context, elements);
            ImportDynamicGroups(group.dynamicGroups, groupObject.transform, presentation, elements);
        }
    }

    private void ImportDynamicGroups(
        PresentationDynamicGroup[] dynamicGroups,
        Transform parent,
        PresentationData presentation,
        ElementRuntimeRegistry elements
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
                new ElementLoadContext(dynamicObject.transform, presentation, assetResolver),
                elements
            );
        }
    }

    private void ImportElements(PresentationElement[] source, ElementLoadContext context, ElementRuntimeRegistry elements)
    {
        if (source == null)
        {
            return;
        }

        foreach (PresentationElement element in source)
        {
            GameObject elementObject = registry.Load(element, context);
            if (elementObject == null)
            {
                runtimeLogger.Error($"Element load failed: id={element?.id ?? "missing"}.");
            }
            elements.Register(elementObject);
        }
    }

    private void OnDestroy()
    {
        DestroyObject(generatedRoot != null ? generatedRoot.gameObject : null);
        generatedRoot = null;
        Elements.Clear();
    }

    private static void DestroyObject(GameObject target)
    {
        if (target == null)
        {
            return;
        }

        target.SetActive(false);
        if (Application.isPlaying)
        {
            UnityEngine.Object.Destroy(target);
        }
        else
        {
            UnityEngine.Object.DestroyImmediate(target);
        }
    }
}

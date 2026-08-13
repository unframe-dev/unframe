using UnityEngine;

public sealed class ModelElementLoader : IElementLoader
{
    public bool CanLoad(string type) => type == "model";

    public GameObject Load(PresentationElement element, ElementLoadContext context)
    {
        string assetId = element.assetId ?? element.content?.assetId;
        GameObject prefab = context.LoadResource<GameObject>(assetId);
        if (prefab == null)
        {
            Debug.LogError(
                $"[Presentation/Model] Prefab not found: element={element.id}, asset={assetId ?? "missing"}."
            );
        }
        GameObject root = prefab != null
            ? Object.Instantiate(prefab, context.Parent)
            : new GameObject(string.IsNullOrEmpty(element.id) ? element.type : element.id);

        root.name = string.IsNullOrEmpty(element.id) ? element.type : element.id;
        ElementLoaderUtility.AttachMetadata(root, element);
        ElementLoaderUtility.ApplyInitialState(root, element.initialState);

        ElementContent content = element.content;
        if (content?.rendering != null)
        {
            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                renderer.shadowCastingMode = content.rendering.castShadow
                    ? UnityEngine.Rendering.ShadowCastingMode.On
                    : UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = content.rendering.receiveShadow;
            }
        }

        return root;
    }
}

using UnityEngine;

public sealed class ImageElementLoader : IElementLoader
{
    public bool CanLoad(string type) => type == "image";

    public GameObject Load(PresentationElement element, ElementLoadContext context)
    {
        GameObject root = GameObject.CreatePrimitive(PrimitiveType.Quad);
        root.name = string.IsNullOrEmpty(element.id) ? element.type : element.id;
        root.transform.SetParent(context.Parent, false);
        ElementLoaderUtility.AttachMetadata(root, element);
        ElementLoaderUtility.ApplyInitialState(root, element.initialState);

        ElementContent content = element.content ?? new ElementContent();
        if (content.size != null)
        {
            root.transform.localScale = new Vector3(content.size.width, content.size.height, 1f);
        }

        Texture2D texture = context.LoadResource<Texture2D>(element.assetId ?? content.assetId);
        Material material = ElementLoaderUtility.CreateUnlitMaterial(Color.white, texture);
        ElementLoaderUtility.ApplyMaterial(root, material, element.initialState?.opacity ?? 1f);
        return root;
    }
}

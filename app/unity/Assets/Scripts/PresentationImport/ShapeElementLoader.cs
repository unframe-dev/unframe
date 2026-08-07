using UnityEngine;

public sealed class ShapeElementLoader : IElementLoader
{
    public bool CanLoad(string type) => type == "shape";

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

        Color color = ElementLoaderUtility.ToColor(content.fill?.color, Color.white);
        ElementLoaderUtility.ApplyMaterial(
            root,
            ElementLoaderUtility.CreateUnlitMaterial(color),
            element.initialState?.opacity ?? 1f
        );
        return root;
    }
}

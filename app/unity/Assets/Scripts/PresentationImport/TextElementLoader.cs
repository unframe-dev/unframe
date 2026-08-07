using UnityEngine;

public sealed class TextElementLoader : IElementLoader
{
    public bool CanLoad(string type) => type == "text";

    public GameObject Load(PresentationElement element, ElementLoadContext context)
    {
        GameObject root = ElementLoaderUtility.CreateRoot(element, context);
        TextMesh text = root.AddComponent<TextMesh>();
        ElementContent content = element.content ?? new ElementContent();
        text.text = content.text ?? string.Empty;
        text.fontSize = Mathf.Max(1, Mathf.RoundToInt(content.fontSize * 1000f));
        text.anchor = ResolveAnchor(content.alignment);
        text.color = ElementLoaderUtility.ToColor(content.color, Color.white);
        text.characterSize = content.fontSize > 0f ? content.fontSize : 0.1f;
        return root;
    }

    private static TextAnchor ResolveAnchor(string alignment)
    {
        return alignment == "left" ? TextAnchor.MiddleLeft
            : alignment == "right" ? TextAnchor.MiddleRight
            : TextAnchor.MiddleCenter;
    }
}

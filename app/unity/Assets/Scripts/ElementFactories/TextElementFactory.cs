using TMPro;
using UnityEngine;

public class TextElementFactory : MonoBehaviour
{
    [SerializeField] private float fallbackFontSize = 280f;
    [SerializeField] private string fallbackFontColor = "#1f2937";
    [SerializeField] private string fallbackTextAlign = "left";
    [SerializeField] private TextAlignmentOptions fallbackAlignment = TextAlignmentOptions.MidlineLeft;
    [SerializeField] private TMP_FontAsset defaultFontAsset;

    public GameObject Create(ManifestElement element, Transform parent, int elementOrder = 0)
    {
        if (element == null)
        {
            return null;
        }

        GameObject textObject = new GameObject($"Text_{element.id}");
        textObject.transform.SetParent(parent, false);

        float fontSizePx = ResolveFontSize(element);
        string fontColor = ResolveFontColor(element);
        string textAlign = ResolveTextAlign(element);
        TextMeshPro textMesh = textObject.AddComponent<TextMeshPro>();
        textMesh.font = ResolveFontAsset();
        textMesh.text = element.text;
        textMesh.fontSize = 1f;
        textMesh.enableAutoSizing = true;
        textMesh.fontSizeMin = 0.03f;
        textMesh.fontSizeMax = 1f;
        textMesh.alignment = ResolveAlignment(textAlign);
        textMesh.color = ParseColor(fontColor, Color.black);

        textMesh.textWrappingMode = TextWrappingModes.Normal;
        textMesh.overflowMode = TextOverflowModes.Overflow;

        float textScale = TransformApplier.ApplyTextObject(
            textObject,
            element.transform,
            fontSizePx,
            elementOrder
        );

        ApplyTextBoxSize(textMesh, element.transform, textScale);

        return textObject;
    }

    private TMP_FontAsset ResolveFontAsset()
    {
        return defaultFontAsset != null
            ? defaultFontAsset
            : TMP_Settings.defaultFontAsset;
    }

    private float ResolveFontSize(ManifestElement element)
    {
        return element.fontSize > 0f
            ? element.fontSize
            : fallbackFontSize;
    }

    private string ResolveFontColor(ManifestElement element)
    {
        return !string.IsNullOrEmpty(element.fontColor)
            ? element.fontColor
            : fallbackFontColor;
    }

    private string ResolveTextAlign(ManifestElement element)
    {
        return !string.IsNullOrEmpty(element.textAlign)
            ? element.textAlign
            : fallbackTextAlign;
    }

    private static void ApplyTextBoxSize(
        TextMeshPro textMesh,
        ManifestTransform transform,
        float textScale
    )
    {
        if (textMesh == null || transform == null)
        {
            return;
        }

        Vector2 boxSizeMeters = TransformApplier.ToUnitySize(transform);

        if (textScale <= 0f)
        {
            textScale = 1f;
        }

        textMesh.rectTransform.sizeDelta = new Vector2(
            boxSizeMeters.x / textScale,
            boxSizeMeters.y / textScale
        );
    }

    private TextAlignmentOptions ResolveAlignment(string textAlign)
    {
        switch (textAlign)
        {
            case "left":
                return TextAlignmentOptions.MidlineLeft;

            case "center":
                return TextAlignmentOptions.Midline;

            case "right":
                return TextAlignmentOptions.MidlineRight;

            default:
                return fallbackAlignment;
        }
    }

    private static Color ParseColor(string value, Color fallback)
    {
        if (string.IsNullOrEmpty(value))
        {
            return fallback;
        }

        if (value == "transparent")
        {
            return Color.clear;
        }

        return ColorUtility.TryParseHtmlString(value, out Color color)
            ? color
            : fallback;
    }
}

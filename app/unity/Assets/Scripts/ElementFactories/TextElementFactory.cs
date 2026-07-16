using TMPro;
using UnityEngine;

public class TextElementFactory : MonoBehaviour
{
    [SerializeField] private float defaultFontSize = 1.0f;
    [SerializeField] private TextAlignmentOptions alignment = TextAlignmentOptions.Center;

    public GameObject Create(ManifestElement element, Transform parent)
    {
        if (element == null)
        {
            Debug.LogError("TextElementFactory: element is null");
            return null;
        }

        GameObject textObject = new GameObject($"Text_{element.id}");
        textObject.transform.SetParent(parent, false);

        TextMeshPro textMesh = textObject.AddComponent<TextMeshPro>();
        textMesh.text = element.text;
        textMesh.fontSize = defaultFontSize;
        textMesh.alignment = alignment;
        textMesh.color = Color.black;

        TransformApplier.Apply(textObject, element.transform);

        return textObject;
    }
}

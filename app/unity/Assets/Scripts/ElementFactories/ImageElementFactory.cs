using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public class ImageElementFactory : MonoBehaviour
{
    [SerializeField] private float defaultWidth = 1.6f;
    [SerializeField] private float defaultHeight = 0.9f;

    public GameObject Create(ManifestElement element, Transform parent, int elementOrder = 0)
    {

        if (element.type == "shape")
        {
            return CreateShape(element, parent, elementOrder);
        }

        GameObject imageObject = GameObject.CreatePrimitive(PrimitiveType.Quad);
        imageObject.name = $"Image_{element.id}";
        imageObject.transform.SetParent(parent, false);

        imageObject.transform.localScale = new Vector3(defaultWidth, defaultHeight, 1f);
        SetSolidColor(imageObject, Color.white);

        TransformApplier.ApplyFlatPlane(imageObject, element.transform, elementOrder);

        if (element.asset != null && !string.IsNullOrEmpty(element.asset.url))
        {
            StartCoroutine(LoadTexture(element.asset.url, imageObject));
        }
        else
        {
            Debug.LogWarning($"ImageElementFactory: image url is empty. Created placeholder: {element.id}");
        }

        return imageObject;
    }

    private GameObject CreateShape(
        ManifestElement element,
        Transform parent,
        int elementOrder
    )
    {
        if (!string.IsNullOrEmpty(element.shape) && element.shape != "rectangle")
        {
            Debug.LogWarning($"ImageElementFactory: unsupported shape '{element.shape}'. Using rectangle: {element.id}");
        }

        GameObject shapeObject = GameObject.CreatePrimitive(PrimitiveType.Quad);
        shapeObject.name = $"Shape_{element.id}";
        shapeObject.transform.SetParent(parent, false);

        SetSolidColor(shapeObject, ParseColor(element.fillColor, Color.white));
        TransformApplier.ApplyFlatPlane(shapeObject, element.transform, elementOrder);
        return shapeObject;
    }

    private IEnumerator LoadTexture(string url, GameObject target)
    {
        using UnityWebRequest request = UnityWebRequestTexture.GetTexture(url);
        request.timeout = 15;

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            Debug.LogError($"ImageElementFactory: failed to load image: {url}");
            Debug.LogError($"{request.responseCode} / {request.error}");
            yield break;
        }

        Texture2D texture = DownloadHandlerTexture.GetContent(request);

        Renderer renderer = target.GetComponent<Renderer>();
        if (renderer == null)
        {
            Debug.LogError("ImageElementFactory: Renderer not found");
            yield break;
        }

        Material material = PresentationPlaneMaterialFactory.Create(texture, Color.white);
        if (material == null)
        {
            yield break;
        }

        renderer.material = material;
    }

    private void SetSolidColor(GameObject target, Color color)
    {
        Renderer renderer = target.GetComponent<Renderer>();

        Material material = PresentationPlaneMaterialFactory.CreateSolid(color);
        if (material == null)
        {
            return;
        }

        renderer.material = material;
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

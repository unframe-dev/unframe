using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public class ImageElementFactory : MonoBehaviour
{
    [SerializeField] private float defaultWidth = 1.6f;
    [SerializeField] private float defaultHeight = 0.9f;

    public GameObject Create(ManifestElement element, Transform parent)
    {
        if (element == null)
        {
            Debug.LogError("ImageElementFactory: element is null");
            return null;
        }

        GameObject imageObject = GameObject.CreatePrimitive(PrimitiveType.Quad);
        imageObject.name = $"Image_{element.id}";
        imageObject.transform.SetParent(parent, false);

        imageObject.transform.localScale = new Vector3(defaultWidth, defaultHeight, 1f);
        SetSolidColor(imageObject, Color.white);

        TransformApplier.Apply(imageObject, element.transform);

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
        if (renderer == null)
        {
            Debug.LogError("ImageElementFactory: Renderer not found");
            return;
        }

        Material material = PresentationPlaneMaterialFactory.CreateSolid(color);
        if (material == null)
        {
            return;
        }

        renderer.material = material;
    }
}

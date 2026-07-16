using UnityEngine;

public class ModelElementFactory : MonoBehaviour
{
    [SerializeField] private GameObject localTestModelPrefab;

    public GameObject Create(ManifestElement element, Transform parent)
    {
        if (element == null)
        {
            Debug.LogError("ModelElementFactory: element is null");
            return null;
        }

        GameObject modelObject = localTestModelPrefab != null
            ? Instantiate(localTestModelPrefab, parent)
            : new GameObject();

        modelObject.name = $"Model_{element.id}";

        if (localTestModelPrefab == null)
        {
            modelObject.transform.SetParent(parent, false);
        }

        TransformApplier.Apply(modelObject, element.transform);

        if (element.asset != null && !string.IsNullOrEmpty(element.asset.url))
        {
            Debug.Log($"ModelElementFactory: model url received: {element.asset.url}");
            Debug.LogWarning("ModelElementFactory: runtime model loading is not implemented yet. Using local test model when assigned.");
        }

        return modelObject;
    }
}

using UnityEngine;

public static class ElementLoaderUtility
{
    public static GameObject CreateRoot(PresentationElement element, ElementLoadContext context)
    {
        GameObject root = new GameObject(string.IsNullOrEmpty(element.id) ? element.type : element.id);
        root.transform.SetParent(context.Parent, false);
        ApplyInitialState(root, element.initialState);

        AttachMetadata(root, element);
        return root;
    }

    public static void AttachMetadata(GameObject root, PresentationElement element)
    {
        ImportedElement imported = root.GetComponent<ImportedElement>() ?? root.AddComponent<ImportedElement>();
        imported.ElementId = element.id;
        imported.ElementType = element.type;
    }

    public static void ApplyInitialState(GameObject target, ElementInitialState state)
    {
        if (state == null)
        {
            return;
        }

        target.SetActive(state.ResolveActive());

        if (state.transform != null)
        {
            target.transform.localPosition = ToVector3(state.transform.position, Vector3.zero);
            target.transform.localEulerAngles = ToVector3(state.transform.rotation, Vector3.zero);
            target.transform.localScale = ToVector3(state.transform.scale, Vector3.one);
        }
    }

    public static Color ToColor(float[] values, Color fallback)
    {
        if (values == null || values.Length < 3)
        {
            return fallback;
        }

        return new Color(
            values[0],
            values[1],
            values[2],
            values.Length > 3 ? values[3] : 1f
        );
    }

    public static Vector3 ToVector3(float[] values, Vector3 fallback)
    {
        return values != null && values.Length >= 3
            ? new Vector3(values[0], values[1], values[2])
            : fallback;
    }

    public static void ApplyMaterial(GameObject target, Material material, float opacity)
    {
        Renderer renderer = target.GetComponent<Renderer>();
        if (renderer == null)
        {
            return;
        }

        Color color = material != null && material.HasProperty("_BaseColor")
            ? material.GetColor("_BaseColor")
            : Color.white;
        color.a *= Mathf.Clamp01(opacity);

        if (material == null)
        {
            material = CreateUnlitMaterial(color);
        }
        else if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }

        renderer.material = material;
    }

    public static Material CreateUnlitMaterial(Color color, Texture texture = null)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Texture");
        if (shader == null)
        {
            return null;
        }

        Material material = new Material(shader);
        if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }

        if (texture != null && material.HasProperty("_BaseMap"))
        {
            material.SetTexture("_BaseMap", texture);
        }

        return material;
    }
}

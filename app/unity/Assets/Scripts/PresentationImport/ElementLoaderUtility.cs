using UnityEngine;

public static class ElementLoaderUtility
{
    private const string PresentationUnlitShaderPath =
        "PresentationMaterials/PresentationUnlit";

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
            Debug.LogError(
                $"[Presentation/Material] Renderer missing: object={target.name}."
            );
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

        if (material == null)
        {
            Debug.LogError(
                $"[Presentation/Material] Assignment skipped: object={target.name}."
            );
            return;
        }

        renderer.material = material;
        Debug.Log(
            $"[Presentation/Material] Assigned: object={target.name}, " +
            $"renderer={renderer.GetType().Name}, shader={material.shader?.name ?? "missing"}, " +
            $"supported={material.shader?.isSupported ?? false}, " +
            $"baseColor={material.HasProperty("_BaseColor")}, " +
            $"material={material.name}, opacity={opacity:F2}."
        );
    }

    public static Material CreateUnlitMaterial(Color color, Texture texture = null)
    {
        Shader shader = Resources.Load<Shader>(PresentationUnlitShaderPath);
        string source = "Resources";
        if (shader == null)
        {
            shader = Shader.Find("Universal Render Pipeline/Unlit");
            source = "URP Shader.Find";
        }

        if (shader == null)
        {
            shader = Shader.Find("Unlit/Texture");
            source = "Legacy Shader.Find";
        }

        if (shader == null)
        {
            Debug.LogError(
                "[Presentation/Material] No compatible unlit shader found. " +
                $"Resources path={PresentationUnlitShaderPath}."
            );
            return null;
        }

        Debug.Log(
            $"[Presentation/Material] Shader resolved: source={source}, " +
            $"shader={shader.name}, supported={shader.isSupported}, " +
            $"color={color}, texture={(texture == null ? "none" : texture.name)}."
        );

        Material material = new Material(shader);
        material.name = "Presentation Runtime Unlit";
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

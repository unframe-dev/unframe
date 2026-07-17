using UnityEngine;
using UnityEngine.Rendering;

public static class PresentationPlaneMaterialFactory
{
    private const float AlphaCutoff = 0.5f;

    private static readonly string[] CutoutShaderNames =
    {
        "Universal Render Pipeline/Unlit",
        "Unlit/Color",
        "Unlit/Texture",
        "Sprites/Default",
        "Unlit/Transparent Cutout"
    };

    public static Material Create(Texture texture, Color color)
    {
        Shader shader = FindShader();
        if (shader == null)
        {
            Debug.LogError("PresentationPlaneMaterialFactory: image shader not found");
            return null;
        }

        Material material = new Material(shader);
        ApplyTexture(material, texture);
        ApplyColor(material, color);
        ConfigureAsDepthWritingCutout(material);

        return material;
    }

    public static Material CreateSolid(Color color)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Unlit");
        if (shader == null)
        {
            shader = Shader.Find("Unlit/Color");
        }

        if (shader == null)
        {
            shader = Shader.Find("Sprites/Default");
        }

        if (shader == null)
        {
            Debug.LogError("PresentationPlaneMaterialFactory: solid shader not found");
            return null;
        }

        Material material = new Material(shader);
        ApplyColor(material, color);

        // URP Unlit用
        SetFloatIfPresent(material, "_Surface", 0f);
        SetFloatIfPresent(material, "_ZWrite", 1f);

        return material;
    }

    private static Shader FindShader()
    {
        foreach (string shaderName in CutoutShaderNames)
        {
            Shader shader = Shader.Find(shaderName);
            if (shader != null)
            {
                return shader;
            }
        }

        return null;
    }

    private static void ApplyTexture(Material material, Texture texture)
    {
        if (texture == null)
        {
            return;
        }

        if (material.HasProperty("_BaseMap"))
        {
            material.SetTexture("_BaseMap", texture);
        }

        if (material.HasProperty("_MainTex"))
        {
            material.SetTexture("_MainTex", texture);
        }
    }

    private static void ApplyColor(Material material, Color color)
    {
        if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }

        if (material.HasProperty("_Color"))
        {
            material.SetColor("_Color", color);
        }
    }

    private static void ConfigureAsDepthWritingCutout(Material material)
    {
        material.renderQueue = (int)RenderQueue.AlphaTest;
        material.SetOverrideTag("RenderType", "TransparentCutout");
        material.EnableKeyword("_ALPHATEST_ON");
        material.DisableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");

        SetFloatIfPresent(material, "_Cutoff", AlphaCutoff);
        SetFloatIfPresent(material, "_AlphaClip", 1f);
        SetFloatIfPresent(material, "_Surface", 0f);
        SetFloatIfPresent(material, "_ZWrite", 1f);
        SetFloatIfPresent(material, "_SrcBlend", (float)BlendMode.One);
        SetFloatIfPresent(material, "_DstBlend", (float)BlendMode.Zero);
    }

    private static void SetFloatIfPresent(Material material, string propertyName, float value)
    {
        if (material.HasProperty(propertyName))
        {
            material.SetFloat(propertyName, value);
        }
    }

    public static Material CreateBackground(Color color)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Unlit");
        if (shader == null)
        {
            shader = Shader.Find("Unlit/Color");
        }

        if (shader == null)
        {
            shader = Shader.Find("Sprites/Default");
        }

        if (shader == null)
        {
            Debug.LogError("PresentationPlaneMaterialFactory: background shader not found");
            return null;
        }

        Material material = new Material(shader);
        ApplyColor(material, color);
        material.renderQueue = 1000;
        SetFloatIfPresent(material, "_ZWrite", 0f);
        SetFloatIfPresent(material, "_AlphaClip", 0f);

        return material;
    }
}

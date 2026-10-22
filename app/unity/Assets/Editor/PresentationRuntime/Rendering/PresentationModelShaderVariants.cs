using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

public static class PresentationModelShaderVariants
{
    [MenuItem("Unframe/Generate Model Shader Materials")]
    public static void Generate()
    {
        const string folder = "Assets/Resources/PresentationModelShaders";
        System.IO.Directory.CreateDirectory(folder);
        foreach (string model in new[] { "pbrMetallicRoughness", "unlit" })
        {
            Shader shader = Shader.Find("Shader Graphs/glTF-" + model);
            if (shader == null) throw new InvalidOperationException("glTFast shader is absent: " + model);
            for (int alpha = 0; alpha < 4; alpha++)
                for (int features = 0; features < 4; features++)
                {
                    string path = folder + "/" + model + "-" + alpha + "-" + features + ".mat";
                    var material = new Material(shader);
                    if ((alpha & 1) != 0) { material.EnableKeyword("_ALPHATEST_ON"); material.SetFloat("_AlphaClip", 1); }
                    if ((alpha & 2) != 0)
                    {
                        material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); material.SetFloat("_Surface", 1);
                        material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                        material.SetFloat("_ZWrite", 0); material.renderQueue = (int)RenderQueue.Transparent;
                    }
                    if ((features & 1) != 0) material.EnableKeyword("_OCCLUSION");
                    if ((features & 2) != 0) material.EnableKeyword("_EMISSIVE");
                    var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
                    if (existing == null) AssetDatabase.CreateAsset(material, path);
                    else { EditorUtility.CopySerialized(material, existing); UnityEngine.Object.DestroyImmediate(material); }
                }
        }
        AssetDatabase.SaveAssets();
    }
}

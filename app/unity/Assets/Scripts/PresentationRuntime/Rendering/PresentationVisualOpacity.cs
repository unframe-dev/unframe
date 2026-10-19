using System.Collections.Generic;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    [DisallowMultipleComponent]
    internal sealed class PresentationVisualOpacity : MonoBehaviour
    {
        private sealed class ColorBinding
        {
            public Material Material;
            public Material OriginalMaterial;
            public string Property;
            public Color Original;
        }

        private readonly List<ColorBinding> bindings = new List<ColorBinding>();
        private readonly List<Material> ownedMaterials = new List<Material>();
        private bool initialized;
        internal float Opacity { get; private set; } = 1f;

        public static void Apply(GameObject root, float opacity)
        {
            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                PresentationVisualOpacity controller = renderer.GetComponent<PresentationVisualOpacity>();
                if (controller == null)
                {
                    controller = renderer.gameObject.AddComponent<PresentationVisualOpacity>();
                }

                controller.SetOpacity(opacity);
            }
        }

        private void SetOpacity(float opacity)
        {
            Initialize();
            float clampedOpacity = Mathf.Clamp01(opacity);
            Opacity = clampedOpacity;
            foreach (ColorBinding binding in bindings)
            {
                Color color = binding.Original;
                color.a *= clampedOpacity;
                binding.Material.CopyPropertiesFromMaterial(binding.OriginalMaterial);
                binding.Material.shaderKeywords = binding.OriginalMaterial.shaderKeywords;
                binding.Material.renderQueue = binding.OriginalMaterial.renderQueue;
                binding.Material.SetOverrideTag("RenderType", binding.OriginalMaterial.GetTag("RenderType", false, ""));
                if (clampedOpacity < 1)
                {
                    ConfigureTransparency(binding.Material);
                    if (binding.Material.HasProperty("alphaCutoff"))
                        binding.Material.SetFloat("alphaCutoff", binding.OriginalMaterial.GetFloat("alphaCutoff") * clampedOpacity);
                    if (binding.Material.HasProperty("_Cutoff"))
                        binding.Material.SetFloat("_Cutoff", binding.OriginalMaterial.GetFloat("_Cutoff") * clampedOpacity);
                }
                binding.Material.SetColor(binding.Property, color);
            }
        }

        private void Initialize()
        {
            if (initialized)
            {
                return;
            }

            initialized = true;
            Renderer renderer = GetComponent<Renderer>();
            Material[] materials = renderer.sharedMaterials;
            for (int index = 0; index < materials.Length; index++)
            {
                Material source = materials[index];
                if (source == null)
                {
                    continue;
                }

                string property = source.HasProperty("baseColorFactor") ? "baseColorFactor" : source.HasProperty("_BaseColor") ? "_BaseColor" : source.HasProperty("_Color") ? "_Color" : null;
                if (property == null)
                {
                    continue;
                }

                Material material = new Material(source);
                material.name = source.name + " (Presentation Opacity)";
                materials[index] = material;
                ownedMaterials.Add(material);
                bindings.Add(new ColorBinding
                {
                    Material = material,
                    OriginalMaterial = source,
                    Property = property,
                    Original = material.GetColor(property),
                });
            }

            renderer.sharedMaterials = materials;
        }

        private void OnDestroy()
        {
            foreach (Material material in ownedMaterials)
            {
                if (material == null)
                {
                    continue;
                }

                if (Application.isPlaying)
                {
                    Destroy(material);
                }
                else
                {
                    DestroyImmediate(material);
                }
            }

            ownedMaterials.Clear();
        }

        private static void ConfigureTransparency(Material material)
        {
            if (!material.HasProperty("_ZWrite"))
            {
                return;
            }

            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            else material.EnableKeyword("_ALPHABLEND_ON");
            material.SetFloat("_Blend", 0f);
            material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            material.SetFloat("_ZWrite", 0f);
            material.SetOverrideTag("RenderType", "Transparent");

            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        }
    }
}

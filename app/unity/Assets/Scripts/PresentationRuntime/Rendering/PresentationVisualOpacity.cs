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
            public string Property;
            public Color Original;
        }

        private readonly List<ColorBinding> bindings = new List<ColorBinding>();
        private readonly List<Material> ownedMaterials = new List<Material>();
        private bool initialized;

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
            foreach (ColorBinding binding in bindings)
            {
                Color color = binding.Original;
                color.a *= clampedOpacity;
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

                string property = source.HasProperty("_BaseColor") ? "_BaseColor" : source.HasProperty("_Color") ? "_Color" : null;
                if (property == null)
                {
                    continue;
                }

                Material material = new Material(source);
                material.name = source.name + " (Presentation Opacity)";
                ConfigureTransparency(material);
                materials[index] = material;
                ownedMaterials.Add(material);
                bindings.Add(new ColorBinding
                {
                    Material = material,
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
            if (!material.HasProperty("_Surface"))
            {
                return;
            }

            material.SetFloat("_Surface", 1f);
            material.SetFloat("_Blend", 0f);
            material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            material.SetFloat("_ZWrite", 0f);
            material.SetOverrideTag("RenderType", "Transparent");
            material.DisableKeyword("_ALPHATEST_ON");
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        }
    }
}

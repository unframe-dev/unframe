using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

[DisallowMultipleComponent]
public sealed class ElementFadeIn : MonoBehaviour
{
    private static readonly string[] ColorPropertyNames =
    {
        "_BaseColor",
        "_Color",
        "_FaceColor"
    };

    [SerializeField, Min(0f)] private float duration = PresentationElementAnimationFactory.DefaultFadeDuration;
    [SerializeField, Min(0f)] private float delay;
    [SerializeField] private bool playOnEnable = true;

    private readonly List<RendererFadeState> rendererStates = new List<RendererFadeState>();
    private double startedAt;

    public float Duration => duration;
    public float Delay => delay;
    public bool IsPlaying { get; private set; }

    public void Configure(float fadeDuration, float fadeDelay = 0f)
    {
        duration = Mathf.Max(0f, fadeDuration);
        delay = Mathf.Max(0f, fadeDelay);
    }

    public void Play()
    {
        RestoreRenderers();
        CaptureRenderers();

        startedAt = Time.unscaledTimeAsDouble;
        IsPlaying = true;
        ApplyOpacity(0f);

        if (duration <= 0f && delay <= 0f)
        {
            Complete();
        }
    }

    public void Complete()
    {
        IsPlaying = false;
        RestoreRenderers();
    }

    private void OnEnable()
    {
        if (playOnEnable && Application.isPlaying)
        {
            Play();
        }
    }

    private void OnDisable()
    {
        Complete();
    }

    private void OnDestroy()
    {
        RestoreRenderers();
    }

    private void OnTransformChildrenChanged()
    {
        if (playOnEnable && Application.isPlaying && isActiveAndEnabled)
        {
            Play();
        }
    }

    private void Update()
    {
        if (!IsPlaying)
        {
            return;
        }

        float elapsed = (float)(Time.unscaledTimeAsDouble - startedAt);
        if (elapsed < delay)
        {
            ApplyOpacity(0f);
            return;
        }

        if (duration <= 0f)
        {
            Complete();
            return;
        }

        float opacity = Mathf.Clamp01((elapsed - delay) / duration);
        ApplyOpacity(opacity);

        if (opacity >= 1f)
        {
            Complete();
        }
    }

    private void CaptureRenderers()
    {
        Renderer[] renderers = GetComponentsInChildren<Renderer>(true);
        foreach (Renderer renderer in renderers)
        {
            RendererFadeState state = RendererFadeState.TryCreate(renderer);
            if (state != null)
            {
                rendererStates.Add(state);
            }
        }
    }

    private void ApplyOpacity(float opacity)
    {
        foreach (RendererFadeState state in rendererStates)
        {
            state.ApplyOpacity(opacity);
        }
    }

    private void RestoreRenderers()
    {
        foreach (RendererFadeState state in rendererStates)
        {
            state.Restore();
        }

        rendererStates.Clear();
    }

    private sealed class RendererFadeState
    {
        private readonly Renderer renderer;
        private readonly Material[] originalMaterials;
        private readonly Material[] fadeMaterials;
        private readonly List<MaterialColorState> colorStates;

        private RendererFadeState(
            Renderer renderer,
            Material[] originalMaterials,
            Material[] fadeMaterials,
            List<MaterialColorState> colorStates
        )
        {
            this.renderer = renderer;
            this.originalMaterials = originalMaterials;
            this.fadeMaterials = fadeMaterials;
            this.colorStates = colorStates;
        }

        public static RendererFadeState TryCreate(Renderer renderer)
        {
            Material[] originals = renderer.sharedMaterials;
            Material[] fades = new Material[originals.Length];
            List<MaterialColorState> colors = new List<MaterialColorState>();

            for (int materialIndex = 0; materialIndex < originals.Length; materialIndex++)
            {
                Material original = originals[materialIndex];
                if (original == null)
                {
                    continue;
                }

                List<ColorPropertyState> properties = CaptureColorProperties(original);
                if (properties.Count == 0)
                {
                    continue;
                }

                Material fade = new Material(original)
                {
                    name = $"{original.name} (Element Fade)"
                };
                ConfigureTransparent(fade);
                fades[materialIndex] = fade;
                colors.Add(new MaterialColorState(fade, properties));
            }

            if (colors.Count == 0)
            {
                return null;
            }

            Material[] assigned = new Material[originals.Length];
            for (int i = 0; i < assigned.Length; i++)
            {
                assigned[i] = fades[i] != null ? fades[i] : originals[i];
            }

            renderer.sharedMaterials = assigned;
            return new RendererFadeState(renderer, originals, fades, colors);
        }

        public void ApplyOpacity(float opacity)
        {
            foreach (MaterialColorState state in colorStates)
            {
                state.ApplyOpacity(opacity);
            }
        }

        public void Restore()
        {
            if (renderer != null)
            {
                Material[] current = renderer.sharedMaterials;
                int count = Mathf.Min(current.Length, originalMaterials.Length);
                for (int i = 0; i < count; i++)
                {
                    if (fadeMaterials[i] != null && current[i] == fadeMaterials[i])
                    {
                        current[i] = originalMaterials[i];
                    }
                }

                renderer.sharedMaterials = current;
            }

            foreach (Material fade in fadeMaterials)
            {
                if (fade == null)
                {
                    continue;
                }

                if (Application.isPlaying)
                {
                    Object.Destroy(fade);
                }
                else
                {
                    Object.DestroyImmediate(fade);
                }
            }
        }

        private static List<ColorPropertyState> CaptureColorProperties(Material material)
        {
            List<ColorPropertyState> properties = new List<ColorPropertyState>();
            foreach (string propertyName in ColorPropertyNames)
            {
                if (!material.HasProperty(propertyName))
                {
                    continue;
                }

                properties.Add(new ColorPropertyState(propertyName, material.GetColor(propertyName)));
            }

            return properties;
        }

        private static void ConfigureTransparent(Material material)
        {
            material.renderQueue = (int)RenderQueue.Transparent;
            material.SetOverrideTag("RenderType", "Transparent");
            material.DisableKeyword("_ALPHATEST_ON");
            material.EnableKeyword("_ALPHABLEND_ON");
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");

            SetFloatIfPresent(material, "_Surface", 1f);
            SetFloatIfPresent(material, "_Mode", 2f);
            SetFloatIfPresent(material, "_AlphaClip", 0f);
            SetFloatIfPresent(material, "_ZWrite", 0f);
            SetFloatIfPresent(material, "_SrcBlend", (float)BlendMode.SrcAlpha);
            SetFloatIfPresent(material, "_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
        }

        private static void SetFloatIfPresent(Material material, string propertyName, float value)
        {
            if (material.HasProperty(propertyName))
            {
                material.SetFloat(propertyName, value);
            }
        }
    }

    private sealed class MaterialColorState
    {
        private readonly Material material;
        private readonly List<ColorPropertyState> properties;

        public MaterialColorState(Material material, List<ColorPropertyState> properties)
        {
            this.material = material;
            this.properties = properties;
        }

        public void ApplyOpacity(float opacity)
        {
            foreach (ColorPropertyState property in properties)
            {
                Color color = property.OriginalColor;
                color.a *= opacity;
                material.SetColor(property.PropertyName, color);
            }
        }
    }

    private sealed class ColorPropertyState
    {
        public string PropertyName { get; }
        public Color OriginalColor { get; }

        public ColorPropertyState(string propertyName, Color originalColor)
        {
            PropertyName = propertyName;
            OriginalColor = originalColor;
        }
    }
}

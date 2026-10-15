using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Unframe.Unity.PresentationRuntime
{
    [DisallowMultipleComponent]
    internal sealed class PresentationUnlitMaterial : MonoBehaviour
    {
        private Material ownedMaterial;

        internal static Color FromSrgba(double red, double green, double blue, double alpha)
        {
            Color color = new Color((float)red, (float)green, (float)blue, (float)alpha);
            return QualitySettings.activeColorSpace == ColorSpace.Linear ? color.linear : color;
        }

        internal static void Assign(Renderer renderer, Color color, Texture texture = null, bool doubleSided = false)
        {
            Shader shader = Resources.Load<Shader>("PresentationMaterials/PresentationUnlit");
            if (shader == null || !shader.isSupported)
                throw new InvalidOperationException("The presentation URP Unlit shader is missing or unsupported.");

            var owner = renderer.gameObject.AddComponent<PresentationUnlitMaterial>();
            owner.ownedMaterial = new Material(shader) { name = "Presentation Unlit" };
            owner.ownedMaterial.SetColor("_BaseColor", color);
            if (texture != null) owner.ownedMaterial.SetTexture("_BaseMap", texture);
            owner.ownedMaterial.SetFloat("_Cull", (float)(doubleSided ? CullMode.Off : CullMode.Back));
            renderer.sharedMaterial = owner.ownedMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        private void OnDestroy()
        {
            if (ownedMaterial == null) return;
            if (Application.isPlaying) Destroy(ownedMaterial);
            else DestroyImmediate(ownedMaterial);
        }
    }
}

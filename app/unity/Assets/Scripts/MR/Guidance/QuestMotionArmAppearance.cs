using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    [ExecuteAlways]
    public sealed class QuestMotionArmAppearance : MonoBehaviour
    {
        [Range(0, 1)] public float Opacity = 1;
        private SkinnedMeshRenderer[] renderers;
        private MaterialPropertyBlock properties;
        private static readonly int BaseColor = Shader.PropertyToID("_BaseColor");

        private void OnEnable() => renderers = GetComponentsInChildren<SkinnedMeshRenderer>(true);
        private void LateUpdate()
        {
            if (renderers == null) return;
            if (properties == null) properties = new MaterialPropertyBlock();
            properties.SetColor(BaseColor, new Color(.48f, .86f, 1, Mathf.Clamp01(Opacity)));
            foreach (SkinnedMeshRenderer renderer in renderers)
            {
                if (renderer == null) continue;
                renderer.enabled = Opacity > .001f;
                renderer.SetPropertyBlock(properties);
            }
        }
    }
}

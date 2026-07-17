using UnityEngine;

public static class PresentationElementAnimationFactory
{
    public const float DefaultFadeDuration = 0.35f;

    public static ElementFadeIn Attach(GameObject target, ManifestElementAnimation animation)
    {
        if (target == null || animation == null || string.IsNullOrEmpty(animation.type))
        {
            return null;
        }

        if (animation.type != "fade")
        {
            Debug.LogWarning($"Unsupported presentation element animation: {animation.type}");
            return null;
        }

        ElementFadeIn fade = target.GetComponent<ElementFadeIn>();
        if (fade == null)
        {
            fade = target.AddComponent<ElementFadeIn>();
        }

        float duration = animation.duration > 0f
            ? animation.duration
            : DefaultFadeDuration;
        fade.Configure(duration, Mathf.Max(0f, animation.delay));
        return fade;
    }
}

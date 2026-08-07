using UnityEngine;

public sealed class AudioElementLoader : IElementLoader
{
    public bool CanLoad(string type) => type == "audio";

    public GameObject Load(PresentationElement element, ElementLoadContext context)
    {
        GameObject root = ElementLoaderUtility.CreateRoot(element, context);
        AudioSource source = root.AddComponent<AudioSource>();
        ElementContent content = element.content ?? new ElementContent();
        AudioClip clip = context.LoadResource<AudioClip>(element.assetId ?? content.assetId);
        source.clip = clip;

        if (content.playback != null)
        {
            source.loop = content.playback.loop;
            source.volume = Mathf.Clamp01(content.playback.volume);
            if (content.playback.autoplay && clip != null)
            {
                source.Play();
            }
        }

        if (content.spatial != null && content.spatial.enabled)
        {
            source.spatialBlend = 1f;
            source.minDistance = Mathf.Max(0f, content.spatial.minDistance);
            source.maxDistance = Mathf.Max(source.minDistance, content.spatial.maxDistance);
        }

        return root;
    }
}

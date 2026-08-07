using UnityEngine;
using UnityEngine.Video;

public sealed class VideoElementLoader : IElementLoader
{
    public bool CanLoad(string type) => type == "video";

    public GameObject Load(PresentationElement element, ElementLoadContext context)
    {
        GameObject root = GameObject.CreatePrimitive(PrimitiveType.Quad);
        root.name = string.IsNullOrEmpty(element.id) ? element.type : element.id;
        root.transform.SetParent(context.Parent, false);
        ElementLoaderUtility.AttachMetadata(root, element);
        ElementLoaderUtility.ApplyInitialState(root, element.initialState);

        ElementContent content = element.content ?? new ElementContent();
        if (content.size != null)
        {
            root.transform.localScale = new Vector3(content.size.width, content.size.height, 1f);
        }

        VideoClip clip = context.LoadResource<VideoClip>(element.assetId ?? content.assetId);
        if (clip == null)
        {
            Debug.LogWarning($"VideoElementLoader: video asset not found for '{element.id}'.");
            return root;
        }

        VideoPlayer player = root.AddComponent<VideoPlayer>();
        player.playOnAwake = false;
        player.isLooping = content.playback != null && content.playback.loop;
        player.clip = clip;
        player.renderMode = VideoRenderMode.MaterialOverride;
        player.targetMaterialRenderer = root.GetComponent<Renderer>();
        player.targetMaterialProperty = "_BaseMap";

        if (content.playback != null)
        {
            player.time = Mathf.Max(0f, content.playback.startTime);
            player.SetDirectAudioVolume(0, Mathf.Clamp01(content.playback.volume));
            if (content.playback.autoplay)
            {
                player.Play();
            }
        }

        return root;
    }
}

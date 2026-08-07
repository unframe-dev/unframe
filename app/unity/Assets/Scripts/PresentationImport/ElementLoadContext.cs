using UnityEngine;

public sealed class ElementLoadContext
{
    public Transform Parent { get; }
    public PresentationData Presentation { get; }
    public IAssetResolver AssetResolver { get; }

    public ElementLoadContext(
        Transform parent,
        PresentationData presentation,
        IAssetResolver assetResolver = null
    )
    {
        Parent = parent;
        Presentation = presentation;
        AssetResolver = assetResolver ?? new ResourcesAssetResolver();
    }

    public PresentationAsset FindAsset(string assetId)
    {
        if (Presentation?.assets == null || string.IsNullOrEmpty(assetId))
        {
            return null;
        }

        foreach (PresentationAsset asset in Presentation.assets)
        {
            if (asset != null && asset.id == assetId)
            {
                return asset;
            }
        }

        return null;
    }

    public T LoadResource<T>(string assetId) where T : Object
    {
        PresentationAsset asset = FindAsset(assetId);
        if (asset == null || string.IsNullOrEmpty(asset.src))
        {
            return null;
        }

        return AssetResolver.Load<T>(asset);
    }
}

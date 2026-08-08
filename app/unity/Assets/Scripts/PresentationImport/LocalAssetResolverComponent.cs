using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public sealed class LocalAssetReference
{
    public string assetId;
    public UnityEngine.Object asset;
}

public sealed class LocalAssetResolverComponent : MonoBehaviour
{
    [SerializeField] private LocalAssetReference[] assets;

    public IAssetResolver CreateResolver()
    {
        Dictionary<string, UnityEngine.Object> assetMap = new Dictionary<string, UnityEngine.Object>();
        if (assets != null)
        {
            foreach (LocalAssetReference reference in assets)
            {
                if (reference != null && !string.IsNullOrEmpty(reference.assetId) && reference.asset != null)
                {
                    assetMap[reference.assetId] = reference.asset;
                }
            }
        }

        return new LocalAssetResolver(assetMap, new ResourcesAssetResolver());
    }
}

public sealed class LocalAssetResolver : IAssetResolver
{
    private readonly IReadOnlyDictionary<string, UnityEngine.Object> localAssets;
    private readonly IAssetResolver fallback;

    public LocalAssetResolver(
        IReadOnlyDictionary<string, UnityEngine.Object> localAssets,
        IAssetResolver fallback
    )
    {
        this.localAssets = localAssets;
        this.fallback = fallback;
    }

    public T Load<T>(PresentationAsset asset) where T : UnityEngine.Object
    {
        if (asset != null && localAssets.TryGetValue(asset.id, out UnityEngine.Object localAsset))
        {
            T typedAsset = localAsset as T;
            if (typedAsset != null)
            {
                return typedAsset;
            }

            Debug.LogWarning($"LocalAssetResolver: asset '{asset.id}' has an incompatible type.");
            return null;
        }

        return fallback?.Load<T>(asset);
    }
}

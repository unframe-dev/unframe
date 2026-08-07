using UnityEngine;

public interface IAssetResolver
{
    T Load<T>(PresentationAsset asset) where T : Object;
}

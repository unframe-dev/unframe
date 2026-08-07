using UnityEngine;

public sealed class ResourcesAssetResolver : IAssetResolver
{
    public T Load<T>(PresentationAsset asset) where T : Object
    {
        if (asset == null || string.IsNullOrEmpty(asset.src))
        {
            return null;
        }

        return Resources.Load<T>(NormalizeResourcePath(asset.src));
    }

    private static string NormalizeResourcePath(string source)
    {
        string path = source.Replace('\\', '/');
        int resourcesIndex = path.IndexOf("Resources/", System.StringComparison.OrdinalIgnoreCase);
        if (resourcesIndex >= 0)
        {
            path = path.Substring(resourcesIndex + "Resources/".Length);
        }

        int extensionIndex = path.LastIndexOf('.');
        return extensionIndex > path.LastIndexOf('/')
            ? path.Substring(0, extensionIndex)
            : path;
    }
}

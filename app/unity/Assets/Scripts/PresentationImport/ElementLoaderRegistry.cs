using System.Collections.Generic;
using UnityEngine;

public sealed class ElementLoaderRegistry
{
    private readonly List<IElementLoader> loaders = new List<IElementLoader>();

    public ElementLoaderRegistry()
    {
        Register(new TextElementLoader());
        Register(new ImageElementLoader());
        Register(new VideoElementLoader());
        Register(new ModelElementLoader());
        Register(new AudioElementLoader());
        Register(new ShapeElementLoader());
    }

    public void Register(IElementLoader loader)
    {
        if (loader != null)
        {
            loaders.Add(loader);
        }
    }

    public GameObject Load(PresentationElement element, ElementLoadContext context)
    {
        if (element == null || string.IsNullOrEmpty(element.type))
        {
            Debug.LogWarning("ElementLoaderRegistry: element type is missing.");
            return null;
        }

        foreach (IElementLoader loader in loaders)
        {
            if (loader.CanLoad(element.type))
            {
                return loader.Load(element, context);
            }
        }

        Debug.LogWarning($"ElementLoaderRegistry: unsupported element type '{element.type}'.");
        return null;
    }
}

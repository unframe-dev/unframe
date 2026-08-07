using UnityEngine;

public interface IElementLoader
{
    bool CanLoad(string type);

    GameObject Load(PresentationElement element, ElementLoadContext context);
}

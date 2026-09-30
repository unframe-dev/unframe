using System.Collections.Generic;
using UnityEngine;

public sealed class ElementRuntimeRegistry
{
    private readonly Dictionary<string, GameObject> elements = new Dictionary<string, GameObject>();

    public void Clear()
    {
        elements.Clear();
    }

    internal void ReplaceWith(ElementRuntimeRegistry source)
    {
        elements.Clear();
        if (source == null)
        {
            return;
        }

        foreach (KeyValuePair<string, GameObject> element in source.elements)
        {
            elements.Add(element.Key, element.Value);
        }
    }

    public void Register(GameObject elementObject)
    {
        if (elementObject == null)
        {
            return;
        }

        ImportedElement imported = elementObject.GetComponent<ImportedElement>();
        if (imported == null || string.IsNullOrEmpty(imported.ElementId))
        {
            return;
        }

        elements[imported.ElementId] = elementObject;
    }

    public bool TryGet(string elementId, out GameObject elementObject)
    {
        return elements.TryGetValue(elementId, out elementObject);
    }
}

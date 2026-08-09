using System.Collections.Generic;
using UnityEngine;

public sealed class ElementRuntimeRegistry
{
    private readonly Dictionary<string, GameObject> elements = new Dictionary<string, GameObject>();

    public void Clear()
    {
        elements.Clear();
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

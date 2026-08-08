using UnityEngine;

public sealed class PresentationActionExecutor
{
    private readonly ElementRuntimeRegistry elements;

    public PresentationActionExecutor(ElementRuntimeRegistry elementRegistry)
    {
        elements = elementRegistry;
    }

    public bool Execute(PresentationAction action)
    {
        if (action == null || elements == null || !elements.TryGet(action.targetId, out GameObject target))
        {
            return false;
        }

        switch (action.type)
        {
            case "setVisible":
            case "setActive":
                target.SetActive(action.boolValue);
                return true;
            case "setPosition":
                target.transform.localPosition = ElementLoaderUtility.ToVector3(
                    action.vectorValue,
                    target.transform.localPosition
                );
                return true;
            case "setRotation":
                target.transform.localEulerAngles = ElementLoaderUtility.ToVector3(
                    action.vectorValue,
                    target.transform.localEulerAngles
                );
                return true;
            case "setScale":
                target.transform.localScale = ElementLoaderUtility.ToVector3(
                    action.vectorValue,
                    target.transform.localScale
                );
                return true;
            default:
                Debug.LogWarning($"PresentationActionExecutor: unsupported action type '{action.type}'.");
                return false;
        }
    }
}

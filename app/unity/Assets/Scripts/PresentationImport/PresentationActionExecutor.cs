using UnityEngine;

public sealed class PresentationActionExecutor
{
    private readonly ElementRuntimeRegistry elements;

    public PresentationActionExecutor(
        ElementRuntimeRegistry elementRegistry,
        IPresentationRuntimeLogger runtimeLogger = null
    )
    {
        elements = elementRegistry;
        logger = runtimeLogger ?? new UnityPresentationRuntimeLogger(false);
    }

    private readonly IPresentationRuntimeLogger logger;

    public bool Execute(PresentationAction action)
    {
        if (action == null || elements == null || !elements.TryGet(action.targetId, out GameObject target))
        {
            logger.Warning($"Action target not found: {action?.targetId ?? "unknown"}.");
            return false;
        }

        switch (action.type)
        {
            case "setVisible":
            case "setActive":
                target.SetActive(action.boolValue);
                logger.Info(
                    $"Action: {action.type} -> {action.targetId} = {action.boolValue}, " +
                    $"activeSelf={target.activeSelf}."
                );
                return true;
            case "setPosition":
                target.transform.localPosition = ElementLoaderUtility.ToVector3(
                    action.vectorValue,
                    target.transform.localPosition
                );
                logger.Info(
                    $"Action: {action.type} -> {action.targetId}, " +
                    $"position={target.transform.localPosition}."
                );
                return true;
            case "setRotation":
                target.transform.localEulerAngles = ElementLoaderUtility.ToVector3(
                    action.vectorValue,
                    target.transform.localEulerAngles
                );
                logger.Info(
                    $"Action: {action.type} -> {action.targetId}, " +
                    $"rotation={target.transform.localEulerAngles}."
                );
                return true;
            case "setScale":
                target.transform.localScale = ElementLoaderUtility.ToVector3(
                    action.vectorValue,
                    target.transform.localScale
                );
                logger.Info(
                    $"Action: {action.type} -> {action.targetId}, " +
                    $"scale={target.transform.localScale}."
                );
                return true;
            default:
                logger.Warning($"Unsupported action type: {action.type}.");
                return false;
        }
    }
}

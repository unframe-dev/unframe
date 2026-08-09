using System;
using UnityEngine;
using UnityEngine.InputSystem;

public sealed class PresentationInputBridge : MonoBehaviour
{
    [SerializeField] private PresentationRuntimeSession session;
    [SerializeField] private string actionMapName = "Player";
    [SerializeField] private string primaryActionName = "Attack";
    [SerializeField] private string nextActionName = "Next";

    private InputAction primaryAction;
    private InputAction nextAction;
    private InputActionAsset fallbackAsset;
    private Action<InputAction.CallbackContext> primaryPerformed;
    private Action<InputAction.CallbackContext> nextPerformed;

    private void Awake()
    {
        session ??= GetComponent<PresentationRuntimeSession>();

        InputActionAsset actions = InputSystem.actions;
        primaryAction = FindAction(actions, primaryActionName);
        nextAction = FindAction(actions, nextActionName);

        if (primaryAction == null || nextAction == null)
        {
            CreateFallbackActions();
        }
    }

    private void OnEnable()
    {
        primaryPerformed = _ => ProcessInput("primary");
        nextPerformed = _ => ProcessInput("next");
        Subscribe(primaryAction, primaryPerformed);
        Subscribe(nextAction, nextPerformed);
    }

    private void OnDisable()
    {
        Unsubscribe(primaryAction, primaryPerformed);
        Unsubscribe(nextAction, nextPerformed);
        primaryPerformed = null;
        nextPerformed = null;
    }

    private void OnDestroy()
    {
        if (fallbackAsset != null)
        {
            Destroy(fallbackAsset);
        }
    }

    private static void Subscribe(
        InputAction action,
        Action<InputAction.CallbackContext> callback
    )
    {
        if (action == null)
        {
            return;
        }

        action.performed += callback;
        action.Enable();
    }

    private static void Unsubscribe(
        InputAction action,
        Action<InputAction.CallbackContext> callback
    )
    {
        if (action == null)
        {
            return;
        }

        action.performed -= callback;
        action.Disable();
    }

    private void ProcessInput(string input)
    {
        session?.ProcessInput(input);
    }

    private InputAction FindAction(InputActionAsset actions, string actionName)
    {
        return actions?.FindAction($"{actionMapName}/{actionName}", false);
    }

    private void CreateFallbackActions()
    {
        fallbackAsset = ScriptableObject.CreateInstance<InputActionAsset>();
        InputActionMap map = new InputActionMap(actionMapName);

        primaryAction = map.AddAction(primaryActionName, InputActionType.Button);
        primaryAction.AddBinding("<XRController>/{PrimaryAction}");
        primaryAction.AddBinding("<Keyboard>/enter");

        nextAction = map.AddAction(nextActionName, InputActionType.Button);
        nextAction.AddBinding("<XRController>/{SecondaryAction}");
        nextAction.AddBinding("<Keyboard>/2");

        fallbackAsset.AddActionMap(map);
    }
}

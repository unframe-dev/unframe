using System;
using UnityEngine;
using UnityEngine.InputSystem;

public sealed class PresentationInputBridge : MonoBehaviour
{
    [SerializeField] private PresentationRuntimeSession session;
    [SerializeField] private string actionMapName = "Player";
    [SerializeField] private string primaryActionName = "Attack";
    [SerializeField] private string nextActionName = "Next";
    [SerializeField] private string motionTriggerActionName = "Sprint";
    [SerializeField] private string motionPositionActionName = "TrackedDevicePosition";
    [SerializeField] private string motionRotationActionName = "TrackedDeviceOrientation";

    private InputAction primaryAction;
    private InputAction nextAction;
    private InputAction motionTriggerAction;
    private InputAction motionPositionAction;
    private InputAction motionRotationAction;
    private InputActionAsset fallbackAsset;
    private Action<InputAction.CallbackContext> primaryPerformed;
    private Action<InputAction.CallbackContext> nextPerformed;
    private readonly PresentationMotionTracker motionTracker = new PresentationMotionTracker();

    private void Awake()
    {
        session ??= GetComponent<PresentationRuntimeSession>();

        InputActionAsset actions = InputSystem.actions;
        primaryAction = FindAction(actions, primaryActionName);
        nextAction = FindAction(actions, nextActionName);
        motionTriggerAction = FindAction(actions, motionTriggerActionName);
        motionPositionAction = FindAction(actions, "UI", motionPositionActionName);
        motionRotationAction = FindAction(actions, "UI", motionRotationActionName);

        if (primaryAction == null || nextAction == null ||
            motionTriggerAction == null || motionPositionAction == null ||
            motionRotationAction == null)
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
        Enable(motionTriggerAction);
        Enable(motionPositionAction);
        Enable(motionRotationAction);
    }

    private void OnDisable()
    {
        Unsubscribe(primaryAction, primaryPerformed);
        Unsubscribe(nextAction, nextPerformed);
        Disable(motionTriggerAction);
        Disable(motionPositionAction);
        Disable(motionRotationAction);
        primaryPerformed = null;
        nextPerformed = null;
        motionTracker.Reset();
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

    private void Update()
    {
        if (motionTriggerAction == null || motionPositionAction == null ||
            motionRotationAction == null || session == null)
        {
            motionTracker.Reset();
            return;
        }

        bool motionTriggerHeld = motionTriggerAction.IsPressed();
        Vector3 currentPosition = motionPositionAction.ReadValue<Vector3>();
        Quaternion currentRotation = motionRotationAction.ReadValue<Quaternion>();
        if (!motionTracker.TryUpdate(
                motionTriggerHeld,
                currentPosition,
                currentRotation,
                Time.deltaTime,
                out PresentationMotionSnapshot snapshot
            ))
        {
            return;
        }

        PresentationTriggerContext context = new PresentationTriggerContext(
            null,
            motion: snapshot
        );
        if (session.ProcessTrigger(context))
        {
            motionTracker.Reset();
        }
    }

    private InputAction FindAction(InputActionAsset actions, string actionName)
    {
        return actions?.FindAction($"{actionMapName}/{actionName}", false);
    }

    private static InputAction FindAction(
        InputActionAsset actions,
        string mapName,
        string actionName
    )
    {
        return actions?.FindAction($"{mapName}/{actionName}", false);
    }

    private static void Enable(InputAction action)
    {
        action?.Enable();
    }

    private static void Disable(InputAction action)
    {
        action?.Disable();
    }

    private void CreateFallbackActions()
    {
        fallbackAsset = ScriptableObject.CreateInstance<InputActionAsset>();
        InputActionMap map = new InputActionMap(actionMapName);

        primaryAction = map.AddAction(primaryActionName, InputActionType.Button);
        primaryAction.AddBinding("<XRController>/primaryButton");
        primaryAction.AddBinding("<Keyboard>/enter");

        nextAction = map.AddAction(nextActionName, InputActionType.Button);
        nextAction.AddBinding("<XRController>/secondaryButton");
        nextAction.AddBinding("<Keyboard>/2");

        motionTriggerAction = map.AddAction(motionTriggerActionName, InputActionType.Button);
        motionTriggerAction.AddBinding("<XRController>/trigger");

        motionPositionAction = map.AddAction(motionPositionActionName, InputActionType.Value);
        motionPositionAction.expectedControlType = "Vector3";
        motionPositionAction.AddBinding("<XRController>/devicePosition");

        motionRotationAction = map.AddAction(motionRotationActionName, InputActionType.Value);
        motionRotationAction.expectedControlType = "Quaternion";
        motionRotationAction.AddBinding("<XRController>/deviceRotation");

        fallbackAsset.AddActionMap(map);
    }
}

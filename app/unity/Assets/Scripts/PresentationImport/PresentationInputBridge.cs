using System;
using UnityEngine;
using UnityEngine.InputSystem;

public sealed class PresentationInputBridge : MonoBehaviour
{
    [SerializeField] private PresentationRuntimeSession session;
    [SerializeField] private string actionMapName = "Player";
    [SerializeField] private string primaryActionName = "Attack";
    [SerializeField] private string nextActionName = "Next";
    [SerializeField] private Transform motionReference;
    [SerializeField] private string motionTriggerActionName = "MotionTriggerRight";
    [SerializeField] private string motionPositionActionName = "MotionPositionRight";
    [SerializeField] private string motionRotationActionName = "MotionRotationRight";
    [SerializeField] private bool enableInputLogs = true;

    private InputAction primaryAction;
    private InputAction nextAction;
    private InputAction motionTriggerAction;
    private InputAction motionPositionAction;
    private InputAction motionRotationAction;
    private InputActionAsset fallbackAsset;
    private Action<InputAction.CallbackContext> primaryPerformed;
    private Action<InputAction.CallbackContext> nextPerformed;
    private readonly PresentationMotionTracker motionTracker = new PresentationMotionTracker();
    private bool motionHeldLastFrame;
    private bool missingActionWarningShown;
    private int motionSampleCount;
    private float motionPeakDistance;
    private Vector3 motionPeakDisplacement;
    private Vector3 motionLastDisplacement;

    private void Awake()
    {
        session ??= GetComponent<PresentationRuntimeSession>();
        motionReference ??= transform;

        InputActionAsset actions = InputSystem.actions;
        primaryAction = FindAction(actions, primaryActionName);
        nextAction = FindAction(actions, nextActionName);
        motionTriggerAction = FindAction(actions, motionTriggerActionName);
        motionPositionAction = FindAction(actions, motionPositionActionName);
        motionRotationAction = FindAction(actions, motionRotationActionName);

        if (primaryAction == null || nextAction == null ||
            motionTriggerAction == null || motionPositionAction == null ||
            motionRotationAction == null)
        {
            CreateFallbackActions();
        }

        LogActionConfiguration();
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
        motionHeldLastFrame = false;
        motionSampleCount = 0;
        motionPeakDistance = 0f;
        motionPeakDisplacement = Vector3.zero;
        motionLastDisplacement = Vector3.zero;
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
            if (!missingActionWarningShown)
            {
                Debug.LogWarning(
                    "[Presentation/Input] Motion input unavailable: " +
                    $"trigger={motionTriggerActionName}, position={motionPositionActionName}, " +
                    $"rotation={motionRotationActionName}, session={(session == null ? "missing" : "available")}."
                );
                missingActionWarningShown = true;
            }
            motionTracker.Reset();
            return;
        }

        bool motionTriggerHeld = motionTriggerAction.IsPressed();
        Vector3 currentPosition = motionReference.InverseTransformPoint(
            motionPositionAction.ReadValue<Vector3>()
        );
        Quaternion currentRotation = Quaternion.Inverse(motionReference.rotation) *
            motionRotationAction.ReadValue<Quaternion>();
        if (motionTriggerHeld != motionHeldLastFrame)
        {
            if (motionTriggerHeld)
            {
                motionSampleCount = 0;
                motionPeakDistance = 0f;
                motionPeakDisplacement = Vector3.zero;
                motionLastDisplacement = Vector3.zero;
                LogInput(
                    $"Motion started: action={motionTriggerActionName}, " +
                    $"reference={motionReference.name}, position={currentPosition}."
                );
            }
            else
            {
                LogInput(
                    $"Motion released: samples={motionSampleCount}, " +
                    $"peakDistance={motionPeakDistance:F3}m, " +
                    $"peakDisplacement={motionPeakDisplacement}, " +
                    $"lastDisplacement={motionLastDisplacement}."
                );
                motionSampleCount = 0;
                motionPeakDistance = 0f;
                motionPeakDisplacement = Vector3.zero;
                motionLastDisplacement = Vector3.zero;
            }

            motionHeldLastFrame = motionTriggerHeld;
        }

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

        motionSampleCount++;
        motionLastDisplacement = snapshot.Displacement;
        if (snapshot.Distance > motionPeakDistance)
        {
            motionPeakDistance = snapshot.Distance;
            motionPeakDisplacement = snapshot.Displacement;
        }
        PresentationTriggerContext context = new PresentationTriggerContext(
            null,
            motion: snapshot
        );
        if (session.ProcessTrigger(context))
        {
            LogInput(
                $"Motion accepted: preset=swipe_right, samples={motionSampleCount}, " +
                $"displacement={snapshot.Displacement}, " +
                $"distance={snapshot.Distance:F3}m, duration={snapshot.Duration:F3}s."
            );
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

    private void LogActionConfiguration()
    {
        if (!enableInputLogs)
        {
            return;
        }

        Debug.Log(
            "[Presentation/Input] Actions ready: " +
            $"trigger={DescribeAction(motionTriggerAction)}, " +
            $"position={DescribeAction(motionPositionAction)}, " +
            $"rotation={DescribeAction(motionRotationAction)}."
        );
    }

    private void LogInput(string message)
    {
        if (enableInputLogs)
        {
            Debug.Log($"[Presentation/Input] {message}");
        }
    }

    private static string DescribeAction(InputAction action)
    {
        if (action == null)
        {
            return "missing";
        }

        if (action.bindings.Count == 0)
        {
            return $"{action.name}(no-binding)";
        }

        return $"{action.name}({action.bindings[0].path})";
    }

    private void CreateFallbackActions()
    {
        Debug.LogWarning(
            "[Presentation/Input] Configured motion actions were not found; " +
            "using right-hand fallback bindings."
        );
        fallbackAsset = ScriptableObject.CreateInstance<InputActionAsset>();
        InputActionMap map = new InputActionMap(actionMapName);

        primaryAction = map.AddAction(primaryActionName, InputActionType.Button);
        primaryAction.AddBinding("<XRController>/primaryButton");
        primaryAction.AddBinding("<Keyboard>/enter");

        nextAction = map.AddAction(nextActionName, InputActionType.Button);
        nextAction.AddBinding("<XRController>/secondaryButton");
        nextAction.AddBinding("<Keyboard>/2");

        motionTriggerAction = map.AddAction(motionTriggerActionName, InputActionType.Button);
        motionTriggerAction.AddBinding("<XRController>{RightHand}/trigger");

        motionPositionAction = map.AddAction(motionPositionActionName, InputActionType.Value);
        motionPositionAction.expectedControlType = "Vector3";
        motionPositionAction.AddBinding("<XRController>{RightHand}/devicePosition");

        motionRotationAction = map.AddAction(motionRotationActionName, InputActionType.Value);
        motionRotationAction.expectedControlType = "Quaternion";
        motionRotationAction.AddBinding("<XRController>{RightHand}/deviceRotation");

        fallbackAsset.AddActionMap(map);
    }
}

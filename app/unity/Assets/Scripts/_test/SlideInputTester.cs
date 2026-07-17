using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.XR;

public class SlideInputTester : MonoBehaviour
{
    [SerializeField] private SlideController slideController;
    [SerializeField] private bool enableNavigationInput = false;
    [SerializeField] private float triggerPressThreshold = 0.1f;
    [SerializeField] private float thumbstickDeadzone = 0.5f;

    private bool leftControllerButtonWasPressed;
    private bool rightControllerButtonWasPressed;
    private int leftThumbstickDirection;
    private int rightThumbstickDirection;

    public bool NavigationInputEnabled => enableNavigationInput;

    void Update()
    {
        if (!enableNavigationInput || slideController == null)
        {
            return;
        }

        ProcessKeyboard();
        ProcessController(
            XRNode.LeftHand,
            ref leftControllerButtonWasPressed,
            ref leftThumbstickDirection,
            slideController.PreviousSlide
        );
        ProcessController(
            XRNode.RightHand,
            ref rightControllerButtonWasPressed,
            ref rightThumbstickDirection,
            slideController.NextSlide
        );
    }

    private void ProcessKeyboard()
    {
        if (Keyboard.current == null)
        {
            return;
        }

        if (Keyboard.current.rightArrowKey.wasPressedThisFrame)
        {
            slideController.NextSlide();
        }

        if (Keyboard.current.leftArrowKey.wasPressedThisFrame)
        {
            slideController.PreviousSlide();
        }
    }

    private void ProcessController(
        XRNode node,
        ref bool wasPressed,
        ref int previousThumbstickDirection,
        System.Action buttonAction
    )
    {
        UnityEngine.XR.InputDevice device = InputDevices.GetDeviceAtXRNode(node);
        if (!device.isValid)
        {
            wasPressed = false;
            previousThumbstickDirection = 0;
            return;
        }

        bool isPressed = ReadControllerButtonPressed(device, triggerPressThreshold);

        bool buttonTriggered = ShouldInvokeOnButtonState(isPressed, wasPressed);
        if (buttonTriggered)
        {
            buttonAction();
        }

        wasPressed = isPressed;

        Vector2 thumbstick = TryGetVector2(device, UnityEngine.XR.CommonUsages.primary2DAxis);
        int thumbstickDirection = ResolveHorizontalDirection(thumbstick, thumbstickDeadzone);
        if (!buttonTriggered &&
            ShouldInvokeDirectionalInput(thumbstickDirection, previousThumbstickDirection))
        {
            if (thumbstickDirection < 0)
            {
                slideController.PreviousSlide();
            }
            else
            {
                slideController.NextSlide();
            }
        }

        previousThumbstickDirection = thumbstickDirection;
    }

    private static bool ReadControllerButtonPressed(UnityEngine.XR.InputDevice device, float triggerPressThreshold)
    {
        bool primaryButton = TryGetBool(device, UnityEngine.XR.CommonUsages.primaryButton);
        bool secondaryButton = TryGetBool(device, UnityEngine.XR.CommonUsages.secondaryButton);
        bool triggerButton = TryGetBool(device, UnityEngine.XR.CommonUsages.triggerButton);
        float triggerValue = TryGetFloat(device, UnityEngine.XR.CommonUsages.trigger);

        return IsControllerButtonPressed(
            primaryButton,
            secondaryButton,
            triggerButton,
            triggerValue,
            triggerPressThreshold
        );
    }

    public static bool IsControllerButtonPressed(
        bool primaryButton,
        bool secondaryButton,
        bool triggerButton,
        float triggerValue,
        float triggerPressThreshold
    )
    {
        return primaryButton || secondaryButton || triggerButton || triggerValue >= triggerPressThreshold;
    }

    public static bool ShouldInvokeOnButtonState(bool isPressed, bool wasPressed)
    {
        return isPressed && !wasPressed;
    }

    public static int ResolveHorizontalDirection(Vector2 axis, float deadzone)
    {
        float threshold = Mathf.Clamp01(deadzone);
        if (axis.x <= -threshold)
        {
            return -1;
        }

        if (axis.x >= threshold)
        {
            return 1;
        }

        return 0;
    }

    public static bool ShouldInvokeDirectionalInput(int direction, int previousDirection)
    {
        return direction != 0 && direction != previousDirection;
    }

    private static bool TryGetBool(UnityEngine.XR.InputDevice device, InputFeatureUsage<bool> usage)
    {
        return device.TryGetFeatureValue(usage, out bool value) && value;
    }

    private static float TryGetFloat(UnityEngine.XR.InputDevice device, InputFeatureUsage<float> usage)
    {
        return device.TryGetFeatureValue(usage, out float value) ? value : 0f;
    }

    private static Vector2 TryGetVector2(
        UnityEngine.XR.InputDevice device,
        InputFeatureUsage<Vector2> usage
    )
    {
        return device.TryGetFeatureValue(usage, out Vector2 value) ? value : Vector2.zero;
    }
}

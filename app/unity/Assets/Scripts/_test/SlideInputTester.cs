using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.XR;

public class SlideInputTester : MonoBehaviour
{
    [SerializeField] private SlideController slideController;
    [SerializeField] private float triggerPressThreshold = 0.1f;

    private bool leftControllerButtonWasPressed;
    private bool rightControllerButtonWasPressed;

    void Update()
    {
        if (slideController == null)
        {
            return;
        }

        ProcessKeyboard();
        ProcessController(XRNode.LeftHand, ref leftControllerButtonWasPressed, slideController.PreviousSlide);
        ProcessController(XRNode.RightHand, ref rightControllerButtonWasPressed, slideController.NextSlide);
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

    private void ProcessController(XRNode node, ref bool wasPressed, System.Action onPressed)
    {
        UnityEngine.XR.InputDevice device = InputDevices.GetDeviceAtXRNode(node);
        if (!device.isValid)
        {
            wasPressed = false;
            return;
        }

        bool isPressed = ReadControllerButtonPressed(device, triggerPressThreshold);

        if (ShouldInvokeOnButtonState(isPressed, wasPressed))
        {
            onPressed();
        }

        wasPressed = isPressed;
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

    private static bool TryGetBool(UnityEngine.XR.InputDevice device, InputFeatureUsage<bool> usage)
    {
        return device.TryGetFeatureValue(usage, out bool value) && value;
    }

    private static float TryGetFloat(UnityEngine.XR.InputDevice device, InputFeatureUsage<float> usage)
    {
        return device.TryGetFeatureValue(usage, out float value) ? value : 0f;
    }
}

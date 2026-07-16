using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using UnityEngine.XR;
using UnityEngine.XR.Interaction.Toolkit.Interactors;

public sealed class XRUITriggerClickBridge : MonoBehaviour
{
    [SerializeField] private XRRayInteractor leftRayInteractor;
    [SerializeField] private XRRayInteractor rightRayInteractor;
    [SerializeField] private EventSystem eventSystem;
    [SerializeField] private float triggerPressThreshold = 0.1f;

    private bool leftWasPressed;
    private bool rightWasPressed;
    private Button leftPressedButton;
    private Button rightPressedButton;
    private string lastLeftBridgeEvent = "none";
    private string lastRightBridgeEvent = "none";

    public string LastLeftBridgeEvent => lastLeftBridgeEvent;
    public string LastRightBridgeEvent => lastRightBridgeEvent;

    private void Reset()
    {
        ResolveReferences();
    }

    private void Awake()
    {
        ResolveReferences();
    }

    private void Update()
    {
        ProcessHand(XRNode.LeftHand, leftRayInteractor, ref leftWasPressed, ref leftPressedButton, ref lastLeftBridgeEvent);
        ProcessHand(XRNode.RightHand, rightRayInteractor, ref rightWasPressed, ref rightPressedButton, ref lastRightBridgeEvent);
    }

    private void ResolveReferences()
    {
        eventSystem ??= EventSystem.current ?? FindAnyObjectByType<EventSystem>();

        if (leftRayInteractor == null || rightRayInteractor == null)
        {
            var interactors = FindObjectsByType<XRRayInteractor>(FindObjectsSortMode.None);
            foreach (var interactor in interactors)
            {
                switch (interactor.handedness)
                {
                    case InteractorHandedness.Left:
                        leftRayInteractor ??= interactor;
                        break;
                    case InteractorHandedness.Right:
                        rightRayInteractor ??= interactor;
                        break;
                }
            }
        }
    }

    private void ProcessHand(XRNode xrNode, XRRayInteractor interactor, ref bool wasPressed, ref Button pressedButton, ref string lastBridgeEvent)
    {
        if (interactor == null || eventSystem == null)
        {
            wasPressed = false;
            pressedButton = null;
            lastBridgeEvent = "missing refs";
            return;
        }

        var isPressed = ReadTriggerPressed(xrNode);
        if (isPressed && !wasPressed)
        {
            pressedButton = GetHoveredButton(interactor);
            if (pressedButton != null)
            {
                ExecuteEvents.Execute(pressedButton.gameObject, CreatePointerEventData(interactor, eligibleForClick: true), ExecuteEvents.pointerDownHandler);
                lastBridgeEvent = FormatBridgeEvent("down", pressedButton.gameObject);
            }
            else
            {
                lastBridgeEvent = FormatBridgeEvent("down-miss", null);
            }
        }
        else if (!isPressed && wasPressed)
        {
            if (pressedButton != null)
            {
                ExecuteEvents.Execute(pressedButton.gameObject, CreatePointerEventData(interactor, eligibleForClick: false), ExecuteEvents.pointerUpHandler);
                lastBridgeEvent = FormatBridgeEvent("up", pressedButton.gameObject);

                var hoveredButton = GetHoveredButton(interactor);
                if (hoveredButton == pressedButton)
                {
                    ExecuteEvents.Execute(pressedButton.gameObject, CreatePointerEventData(interactor, eligibleForClick: true), ExecuteEvents.pointerClickHandler);
                    lastBridgeEvent = FormatBridgeEvent("click", pressedButton.gameObject);
                }

                pressedButton = null;
            }
        }

        wasPressed = isPressed;
    }

    private bool ReadTriggerPressed(XRNode xrNode)
    {
        var device = InputDevices.GetDeviceAtXRNode(xrNode);
        if (!device.isValid)
        {
            return false;
        }

        if (device.TryGetFeatureValue(CommonUsages.triggerButton, out var triggerButton) && triggerButton)
        {
            return true;
        }

        return device.TryGetFeatureValue(CommonUsages.trigger, out var triggerValue) && triggerValue >= triggerPressThreshold;
    }

    private static Button GetHoveredButton(XRRayInteractor interactor)
    {
        if (!interactor.IsOverUIGameObject() || !interactor.TryGetUIModel(out var model))
        {
            return null;
        }

        var target = model.currentRaycast.gameObject != null
            ? model.currentRaycast.gameObject
            : model.selectableObject;

        return target != null ? target.GetComponentInParent<Button>() : null;
    }

    private PointerEventData CreatePointerEventData(XRRayInteractor interactor, bool eligibleForClick)
    {
        var eventData = new PointerEventData(eventSystem)
        {
            button = PointerEventData.InputButton.Left,
            eligibleForClick = eligibleForClick,
            clickCount = eligibleForClick ? 1 : 0,
            clickTime = Time.unscaledTime,
        };

        if (interactor.TryGetUIModel(out var model))
        {
            eventData.pointerId = model.pointerId;
            eventData.pointerEnter = model.currentRaycast.gameObject;
            eventData.pointerCurrentRaycast = model.currentRaycast;
            eventData.pointerPressRaycast = model.currentRaycast;
            eventData.position = model.currentRaycast.screenPosition;
            eventData.pressPosition = model.currentRaycast.screenPosition;
        }

        return eventData;
    }

    private static string FormatBridgeEvent(string eventName, GameObject target)
    {
        return string.Concat("@", Time.unscaledTime.ToString("0.00"), " ", eventName, " ", target != null ? target.name : "-");
    }
}

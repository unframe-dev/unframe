using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.XR;
using UnityEngine.XR.Interaction.Toolkit.Interactors;
using UnityEngine.XR.Interaction.Toolkit.UI;

public sealed class XRInputDebugPanel : MonoBehaviour
{
    [SerializeField] private TMP_Text outputText;
    [SerializeField] private XRRayInteractor leftRayInteractor;
    [SerializeField] private XRRayInteractor rightRayInteractor;
    [SerializeField] private XRUIInputModule uiInputModule;
    [SerializeField] private XRUITriggerClickBridge triggerClickBridge;
    [SerializeField] private float refreshInterval = 0.05f;

    private readonly StringBuilder builder = new(1024);

    private float nextRefreshTime;
    private string lastPointerDown = "none";
    private string lastPointerUp = "none";
    private string lastPointerClick = "none";
    private string lastLeftHover = "none";
    private string lastRightHover = "none";

    private void Reset()
    {
        ResolveReferences();
    }

    private void Awake()
    {
        ResolveReferences();
    }

    private void OnEnable()
    {
        ResolveReferences();
        SubscribeEvents();
        RefreshText(force: true);
    }

    private void OnDisable()
    {
        UnsubscribeEvents();
    }

    private void Update()
    {
        if (Time.unscaledTime < nextRefreshTime)
        {
            return;
        }

        RefreshText(force: false);
    }

    private void ResolveReferences()
    {
        outputText ??= GetComponentInChildren<TMP_Text>(true);
        uiInputModule ??= FindAnyObjectByType<XRUIInputModule>();
        triggerClickBridge ??= GetComponent<XRUITriggerClickBridge>();

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

    private void SubscribeEvents()
    {
        if (uiInputModule != null)
        {
            uiInputModule.pointerDown += OnPointerDown;
            uiInputModule.pointerUp += OnPointerUp;
            uiInputModule.pointerClick += OnPointerClick;
        }

        if (leftRayInteractor != null)
        {
            leftRayInteractor.uiHoverEntered.AddListener(OnLeftHoverEntered);
            leftRayInteractor.uiHoverExited.AddListener(OnLeftHoverExited);
        }

        if (rightRayInteractor != null)
        {
            rightRayInteractor.uiHoverEntered.AddListener(OnRightHoverEntered);
            rightRayInteractor.uiHoverExited.AddListener(OnRightHoverExited);
        }
    }

    private void UnsubscribeEvents()
    {
        if (uiInputModule != null)
        {
            uiInputModule.pointerDown -= OnPointerDown;
            uiInputModule.pointerUp -= OnPointerUp;
            uiInputModule.pointerClick -= OnPointerClick;
        }

        if (leftRayInteractor != null)
        {
            leftRayInteractor.uiHoverEntered.RemoveListener(OnLeftHoverEntered);
            leftRayInteractor.uiHoverExited.RemoveListener(OnLeftHoverExited);
        }

        if (rightRayInteractor != null)
        {
            rightRayInteractor.uiHoverEntered.RemoveListener(OnRightHoverEntered);
            rightRayInteractor.uiHoverExited.RemoveListener(OnRightHoverExited);
        }
    }

    private void RefreshText(bool force)
    {
        nextRefreshTime = Time.unscaledTime + Mathf.Max(0.01f, refreshInterval);

        if (outputText == null)
        {
            return;
        }

        builder.Clear();
        builder.AppendLine("XR Input Debug");
        builder.Append("time ").Append(Time.unscaledTime.ToString("0.00")).AppendLine("s");
        builder.AppendLine();

        AppendHandStatus("L", XRNode.LeftHand, leftRayInteractor, lastLeftHover);
        builder.AppendLine();
        AppendHandStatus("R", XRNode.RightHand, rightRayInteractor, lastRightHover);
        builder.AppendLine();

        builder.AppendLine("UI module events");
        builder.Append("down  ").AppendLine(lastPointerDown);
        builder.Append("up    ").AppendLine(lastPointerUp);
        builder.Append("click ").AppendLine(lastPointerClick);

        if (triggerClickBridge != null)
        {
            builder.AppendLine();
            builder.AppendLine("Bridge events");
            builder.Append("left  ").AppendLine(triggerClickBridge.LastLeftBridgeEvent);
            builder.Append("right ").AppendLine(triggerClickBridge.LastRightBridgeEvent);
        }

        var nextText = builder.ToString();
        if (force || outputText.text != nextText)
        {
            outputText.text = nextText;
        }
    }

    private void AppendHandStatus(string label, XRNode xrNode, XRRayInteractor interactor, string lastHover)
    {
        var device = InputDevices.GetDeviceAtXRNode(xrNode);
        var isValid = device.isValid;
        var isTracked = TryGetBool(device, CommonUsages.isTracked, out var trackedValue) && trackedValue;
        var trigger = TryGetFloat(device, CommonUsages.trigger, out var triggerValue) ? triggerValue : -1f;
        var triggerButton = TryGetBool(device, CommonUsages.triggerButton, out var triggerButtonValue) && triggerButtonValue;
        var grip = TryGetFloat(device, CommonUsages.grip, out var gripValue) ? gripValue : -1f;
        var gripButton = TryGetBool(device, CommonUsages.gripButton, out var gripButtonValue) && gripButtonValue;

        builder.Append(label).AppendLine(" hand");
        builder.Append("device valid=").Append(FormatBool(isValid));
        builder.Append(" tracked=").Append(FormatBool(isTracked));
        builder.Append(" trigger=").Append(FormatAxis(trigger));
        builder.Append(" trigBtn=").Append(FormatBool(triggerButton));
        builder.Append(" grip=").Append(FormatAxis(grip));
        builder.Append(" gripBtn=").AppendLine(FormatBool(gripButton));

        if (interactor == null)
        {
            builder.AppendLine("ray missing");
            builder.Append("hover ").AppendLine(lastHover);
            return;
        }

        if (!interactor.TryGetUIModel(out var model))
        {
            builder.AppendLine("uiModel missing");
            builder.Append("hover ").AppendLine(lastHover);
            return;
        }

        builder.Append("uiModel select=").Append(FormatBool(model.select));
        builder.Append(" delta=").Append(model.selectDelta);
        builder.Append(" pointerId=").Append(model.pointerId);
        builder.Append(" overUI=").Append(FormatBool(interactor.IsOverUIGameObject()));
        builder.Append(" hit=").Append(FormatBool(model.currentRaycast.isValid));
        builder.Append(" scroll=").Append(model.scrollDelta.ToString("F2"));
        builder.AppendLine();
        builder.Append("hover ").AppendLine(lastHover);
        builder.Append("ray   ").AppendLine(DescribeTarget(model.currentRaycast.gameObject));
        builder.Append("ui    ").AppendLine(DescribeTarget(model.selectableObject));
    }

    private void OnPointerDown(GameObject target, PointerEventData eventData)
    {
        lastPointerDown = FormatPointerEvent("down", target, eventData);
    }

    private void OnPointerUp(GameObject target, PointerEventData eventData)
    {
        lastPointerUp = FormatPointerEvent("up", target, eventData);
    }

    private void OnPointerClick(GameObject target, PointerEventData eventData)
    {
        lastPointerClick = FormatPointerEvent("click", target, eventData);
    }

    private void OnLeftHoverEntered(UIHoverEventArgs args)
    {
        lastLeftHover = FormatHoverEvent("enter", args.uiObject);
    }

    private void OnLeftHoverExited(UIHoverEventArgs args)
    {
        lastLeftHover = FormatHoverEvent("exit", args.uiObject);
    }

    private void OnRightHoverEntered(UIHoverEventArgs args)
    {
        lastRightHover = FormatHoverEvent("enter", args.uiObject);
    }

    private void OnRightHoverExited(UIHoverEventArgs args)
    {
        lastRightHover = FormatHoverEvent("exit", args.uiObject);
    }

    private static bool TryGetBool(InputDevice device, InputFeatureUsage<bool> usage, out bool value)
    {
        if (!device.isValid)
        {
            value = false;
            return false;
        }

        return device.TryGetFeatureValue(usage, out value);
    }

    private static bool TryGetFloat(InputDevice device, InputFeatureUsage<float> usage, out float value)
    {
        if (!device.isValid)
        {
            value = 0f;
            return false;
        }

        return device.TryGetFeatureValue(usage, out value);
    }

    private static string FormatAxis(float value)
    {
        return value < 0f ? "n/a" : value.ToString("0.00");
    }

    private static string FormatBool(bool value)
    {
        return value ? "Y" : "N";
    }

    private static string DescribeTarget(GameObject target)
    {
        return target == null ? "-" : GetHierarchyPath(target.transform, 3);
    }

    private static string GetHierarchyPath(Transform transform, int maxDepth)
    {
        if (transform == null)
        {
            return "-";
        }

        var pathBuilder = new StringBuilder(transform.name);
        var current = transform.parent;
        var depth = 1;

        while (current != null && depth < maxDepth)
        {
            pathBuilder.Insert(0, current.name + "/");
            current = current.parent;
            depth++;
        }

        return pathBuilder.ToString();
    }

    private static string FormatPointerEvent(string eventName, GameObject target, PointerEventData eventData)
    {
        return string.Concat(
            "@", Time.unscaledTime.ToString("0.00"),
            " ", eventName,
            " pid=", eventData.pointerId.ToString(),
            " eligible=", FormatBool(eventData.eligibleForClick),
            " target=", DescribeTarget(target));
    }

    private static string FormatHoverEvent(string eventName, GameObject target)
    {
        return string.Concat(
            "@", Time.unscaledTime.ToString("0.00"),
            " ", eventName,
            " ", DescribeTarget(target));
    }
}

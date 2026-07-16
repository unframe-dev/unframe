using UnityEngine;
using UnityEngine.UI;
using UnityEngine.XR;
using UnityEngine.XR.Interaction.Toolkit.Interactors;

[RequireComponent(typeof(RectTransform))]
public sealed class XRPanelMoveHandle : MonoBehaviour
{
    private enum DragHand
    {
        None,
        Left,
        Right,
    }

    private struct DragState
    {
        public DragHand hand;
        public float grabDistance;
        public Quaternion rotationOffset;

        public bool IsActive => hand != DragHand.None;
    }

    [Header("Move Target")]
    [SerializeField] private Transform panelRoot;

    [Header("Rotate Target")]
    [SerializeField] private Transform panelVisualRoot;

    [Header("XR Rays")]
    [SerializeField] private XRRayInteractor leftRayInteractor;
    [SerializeField] private XRRayInteractor rightRayInteractor;

    [Header("UI Visual")]
    [SerializeField] private Graphic handleGraphic;
    [SerializeField] private float triggerPressThreshold = 0.1f;
    [SerializeField] private Color idleColor = new(1f, 1f, 1f, 0.95f);
    [SerializeField] private Color hoverColor = new(0.82f, 0.92f, 1f, 0.98f);
    [SerializeField] private Color activeColor = new(0.42f, 0.82f, 1f, 1f);

    [Header("Drag Options")]
    [SerializeField] private bool rotateWithController = true;
    [SerializeField] private float followSpeed = 15f;
    [SerializeField] private float minGrabDistance = 0.25f;
    [SerializeField] private float maxGrabDistance = 5f;

    private RectTransform handleRect;
    private DragState activeDrag;
    private bool leftWasPressed;
    private bool rightWasPressed;

    private void Reset()
    {
        ResolveReferences();
    }

    private void Awake()
    {
        ResolveReferences();
        RefreshVisualState();
    }

    private void OnEnable()
    {
        ResolveReferences();
        activeDrag = default;
        leftWasPressed = false;
        rightWasPressed = false;
        RefreshVisualState();
    }

    private void OnDisable()
    {
        activeDrag = default;
        leftWasPressed = false;
        rightWasPressed = false;
        RefreshVisualState();
    }

    private void Update()
    {
        ProcessHand(DragHand.Left, XRNode.LeftHand, leftRayInteractor, ref leftWasPressed);
        ProcessHand(DragHand.Right, XRNode.RightHand, rightRayInteractor, ref rightWasPressed);

        RefreshVisualState();
    }

    private void ResolveReferences()
    {
        handleRect ??= GetComponent<RectTransform>();
        handleGraphic ??= GetComponent<Graphic>();

        if (panelRoot == null)
        {
            panelRoot = transform.parent;
        }

        if (panelVisualRoot == null)
        {
            panelVisualRoot = panelRoot;
        }

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

    private void ProcessHand(
        DragHand hand,
        XRNode xrNode,
        XRRayInteractor interactor,
        ref bool wasPressed)
    {
        bool isPressed = ReadTriggerPressed(xrNode);
        bool isDraggingThisHand = activeDrag.IsActive && activeDrag.hand == hand;

        if (!activeDrag.IsActive &&
            isPressed &&
            !wasPressed &&
            IsHoveringHandle(interactor) &&
            TryGetInteractorRay(interactor, out Ray startRay) &&
            TryGetControllerRotation(interactor, out Quaternion startControllerRotation) &&
            panelRoot != null &&
            panelVisualRoot != null)
        {
            // ★ パネル中央ではなく、ハンドル中心までの距離を保存する
            Vector3 handleCenter = GetHandleWorldCenter();

            float distance = Vector3.Distance(startRay.origin, handleCenter);
            distance = Mathf.Clamp(distance, minGrabDistance, maxGrabDistance);

            Quaternion startYOnlyRotation = ExtractYOnlyRotation(startControllerRotation);

            activeDrag = new DragState
            {
                hand = hand,
                grabDistance = distance,
                rotationOffset = Quaternion.Inverse(startYOnlyRotation) * panelVisualRoot.rotation,
            };

            isDraggingThisHand = true;
        }

        if (isDraggingThisHand)
        {
            if (!isPressed)
            {
                activeDrag = default;
            }
            else
            {
                UpdateDragging(interactor);
            }
        }

        wasPressed = isPressed;
    }

    private void UpdateDragging(XRRayInteractor interactor)
    {
        if (panelRoot == null ||
            interactor == null ||
            !TryGetInteractorRay(interactor, out Ray currentRay))
        {
            return;
        }

        // ★ Ray上に置きたいのは panelRoot ではなく handleCenter
        Vector3 targetHandlePosition =
            currentRay.origin + currentRay.direction * activeDrag.grabDistance;

        Vector3 currentHandlePosition = GetHandleWorldCenter();

        // ★ ハンドル中心を targetHandlePosition に合わせるための補正量
        Vector3 correction = targetHandlePosition - currentHandlePosition;

        // ★ panelRoot 全体を補正分だけ動かす
        Vector3 targetPanelPosition = panelRoot.position + correction;

        if (followSpeed <= 0f)
        {
            panelRoot.position = targetPanelPosition;
        }
        else
        {
            panelRoot.position = Vector3.Lerp(
                panelRoot.position,
                targetPanelPosition,
                Time.deltaTime * followSpeed
            );
        }

        // 回転はY軸のみ反映
        if (rotateWithController &&
            panelVisualRoot != null &&
            TryGetControllerRotation(interactor, out Quaternion controllerRotation))
        {
            Quaternion yOnlyRotation = ExtractYOnlyRotation(controllerRotation);
            Quaternion targetRotation = yOnlyRotation * activeDrag.rotationOffset;

            panelVisualRoot.rotation = targetRotation;
        }
    }

    private Vector3 GetHandleWorldCenter()
    {
        if (handleRect == null)
        {
            return panelRoot != null ? panelRoot.position : transform.position;
        }

        return handleRect.TransformPoint(handleRect.rect.center);
    }

    private static Quaternion ExtractYOnlyRotation(Quaternion sourceRotation)
    {
        Vector3 forward = sourceRotation * Vector3.forward;
        forward.y = 0f;

        if (forward.sqrMagnitude < 0.0001f)
        {
            return Quaternion.identity;
        }

        forward.Normalize();
        return Quaternion.LookRotation(forward, Vector3.up);
    }

    private bool ReadTriggerPressed(XRNode xrNode)
    {
        var device = InputDevices.GetDeviceAtXRNode(xrNode);

        if (!device.isValid)
        {
            return false;
        }

        if (device.TryGetFeatureValue(CommonUsages.triggerButton, out bool triggerButton) &&
            triggerButton)
        {
            return true;
        }

        return device.TryGetFeatureValue(CommonUsages.trigger, out float triggerValue) &&
               triggerValue >= Mathf.Max(0f, triggerPressThreshold);
    }

    private bool IsHoveringHandle(XRRayInteractor interactor)
    {
        if (interactor == null ||
            handleRect == null ||
            !interactor.IsOverUIGameObject())
        {
            return false;
        }

        GameObject hoveredObject = null;

        if (interactor.TryGetCurrentUIRaycastResult(out var raycastResult) &&
            raycastResult.gameObject != null)
        {
            hoveredObject = raycastResult.gameObject;
        }
        else if (interactor.TryGetUIModel(out var model))
        {
            hoveredObject = model.currentRaycast.gameObject != null
                ? model.currentRaycast.gameObject
                : model.selectableObject;
        }

        return hoveredObject != null &&
               hoveredObject.transform.IsChildOf(handleRect);
    }

    private static bool TryGetInteractorRay(XRRayInteractor interactor, out Ray ray)
    {
        if (interactor == null)
        {
            ray = default;
            return false;
        }

        Transform rayOrigin = interactor.rayOriginTransform != null
            ? interactor.rayOriginTransform
            : interactor.transform;

        ray = new Ray(rayOrigin.position, rayOrigin.forward);
        return true;
    }

    private static bool TryGetControllerRotation(
        XRRayInteractor interactor,
        out Quaternion rotation)
    {
        if (interactor == null)
        {
            rotation = Quaternion.identity;
            return false;
        }

        Transform rayOrigin = interactor.rayOriginTransform != null
            ? interactor.rayOriginTransform
            : interactor.transform;

        rotation = rayOrigin.rotation;
        return true;
    }

    private void RefreshVisualState()
    {
        if (handleGraphic == null)
        {
            return;
        }

        handleGraphic.color = activeDrag.IsActive
            ? activeColor
            : IsHoveringHandle(leftRayInteractor) || IsHoveringHandle(rightRayInteractor)
                ? hoverColor
                : idleColor;
    }
}
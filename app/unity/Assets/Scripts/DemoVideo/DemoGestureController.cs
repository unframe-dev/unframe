using UnityEngine;
using UnityEngine.InputSystem;

public sealed class DemoGestureController : MonoBehaviour
{
    [SerializeField] private Transform effectRoot;
    [SerializeField] private Camera headCamera;
    [SerializeField] private string actionMapName = "Player";
    [SerializeField] private string triggerActionName = "MotionTriggerRight";
    [SerializeField] private string positionActionName = "MotionPositionRight";
    [SerializeField] private string rotationActionName = "MotionRotationRight";
    [SerializeField] private float downwardSpeedThreshold = 1.5f;
    [SerializeField] private float horizontalSpeedThreshold = 1.5f;
    [SerializeField] private float gestureCooldown = 0.8f;

    private InputAction triggerAction;
    private InputAction positionAction;
    private InputAction rotationAction;
    private DemoControllerCubeEffect cubeEffect;
    private Vector3 previousPosition;
    private bool hasPreviousPosition;
    private bool triggerHeld;
    private float cooldownRemaining;

    private void Awake()
    {
        effectRoot ??= transform;
        headCamera ??= Camera.main;
        InputActionAsset actions = InputSystem.actions;
        triggerAction = actions?.FindAction($"{actionMapName}/{triggerActionName}", false);
        positionAction = actions?.FindAction($"{actionMapName}/{positionActionName}", false);
        rotationAction = actions?.FindAction($"{actionMapName}/{rotationActionName}", false);

        if (triggerAction == null || positionAction == null || rotationAction == null)
        {
            Debug.LogWarning(
                "[DemoVideo] Right-hand actions are unavailable. " +
                $"trigger={triggerActionName}, position={positionActionName}, rotation={rotationActionName}."
            );
            return;
        }

        triggerAction.Enable();
        positionAction.Enable();
        rotationAction.Enable();
        cubeEffect = new GameObject("Demo Controller Cube Effect")
            .AddComponent<DemoControllerCubeEffect>();
        cubeEffect.transform.SetParent(effectRoot, false);
    }

    private void OnDisable()
    {
        triggerAction?.Disable();
        positionAction?.Disable();
        rotationAction?.Disable();
        hasPreviousPosition = false;
        triggerHeld = false;
    }

    private void OnDestroy()
    {
        if (cubeEffect != null)
        {
            Destroy(cubeEffect.gameObject);
        }
    }

    private void Update()
    {
        if (triggerAction == null || positionAction == null || rotationAction == null)
        {
            return;
        }

        Vector3 position = positionAction.ReadValue<Vector3>();
        Quaternion rotation = rotationAction.ReadValue<Quaternion>();
        bool held = triggerAction.IsPressed();
        float deltaTime = Mathf.Max(Time.deltaTime, 0.0001f);

        if (!hasPreviousPosition)
        {
            previousPosition = position;
            hasPreviousPosition = true;
        }

        Vector3 velocity = (position - previousPosition) / deltaTime;
        previousPosition = position;
        cooldownRemaining = Mathf.Max(cooldownRemaining - deltaTime, 0f);

        if (held && !triggerHeld)
        {
            cubeEffect?.Show(position, rotation);
            Debug.Log("[DemoVideo] Controller cube shown.");
        }

        triggerHeld = held;
        if (cubeEffect != null && cubeEffect.IsVisible)
        {
            cubeEffect.Follow(position, rotation, deltaTime);
        }

        if (!held || cooldownRemaining > 0f)
        {
            return;
        }

        if (Vector3.Dot(velocity, Vector3.down) >= downwardSpeedThreshold)
        {
            DemoRainTextEffect.Spawn(effectRoot, headCamera);
            cooldownRemaining = gestureCooldown;
            Debug.Log($"[DemoVideo] Downward gesture detected: velocity={velocity}.");
            return;
        }

        Vector3 cameraRight = ResolveHorizontalRight();
        float horizontalSpeed = Vector3.Dot(velocity, cameraRight);
        if (horizontalSpeed >= horizontalSpeedThreshold)
        {
            DemoFlyingTextEffect.Spawn(position, cameraRight);
            cooldownRemaining = gestureCooldown;
            Debug.Log(
                $"[DemoVideo] HMD-right gesture detected: speed={horizontalSpeed:F2}, " +
                $"velocity={velocity}."
            );
        }
    }

    private Vector3 ResolveHorizontalRight()
    {
        Vector3 right = headCamera != null ? headCamera.transform.right : Vector3.right;
        right.y = 0f;
        return right.sqrMagnitude > 0.0001f ? right.normalized : Vector3.right;
    }
}

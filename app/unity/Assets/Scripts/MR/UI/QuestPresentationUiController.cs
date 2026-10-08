using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.XR;
using CommonUsages = UnityEngine.XR.CommonUsages;

public sealed class QuestPresentationUiController : MonoBehaviour
{
    [SerializeField] private Transform head;
    [SerializeField] private Transform rightController;
    [SerializeField] private PassthroughCameraDevicePreview cameraPreview;
    [SerializeField] private ArucoOriginAlignment alignment;
    [SerializeField] private ArucoPresentationCalibration calibration;
    [SerializeField] private LocalPresentationFixtureRunner runner;
    [SerializeField] private QuestLocalPresentationControls controls;
    [SerializeField] private ArucoPresentationOriginBinding binding;
    private QuestPresentationFlowView view;
    private bool triggerWasPressed;
    private bool subscribed;
    private LineRenderer pointer;
    private Material pointerMaterial;
    private string loadError;

    public PresentationUiFlow Flow { get; } = new PresentationUiFlow();

    public void Configure(Transform eye, Transform controller, PassthroughCameraDevicePreview preview,
        ArucoOriginAlignment marker, ArucoPresentationCalibration source, LocalPresentationFixtureRunner presentation,
        QuestLocalPresentationControls input, ArucoPresentationOriginBinding originBinding)
    {
        head = eye;
        rightController = controller;
        cameraPreview = preview;
        alignment = marker;
        calibration = source;
        runner = presentation;
        controls = input;
        binding = originBinding;
        if (view != null) view.Configure(head);
        ApplyGates();
    }

    private void Awake()
    {
        view = GetComponent<QuestPresentationFlowView>();
        if (view == null) view = gameObject.AddComponent<QuestPresentationFlowView>();
        view.Configure(head);
        view.RoleSelected += role => { Flow.SelectRole(role); Refresh(); };
        view.RoomJoinRequested += code => { if (Flow.JoinPreviewRoom(code)) BeginCalibration(); };
        view.AuthenticationPreviewContinued += () => { Flow.ContinueAuthenticationPreview(); Refresh(); };
        view.PresentationSelected += id => { Flow.SelectPresentation(id); Refresh(); };
        view.CreateRoomRequested += () => { if (Flow.CreatePreviewRoom()) BeginCalibration(); };
        view.StartRequested += () => { Flow.EnterPresentation(); Refresh(); };
        view.NextRequested += AdvancePresentation;
        view.RemeasureRequested += Remeasure;
        view.RetryCameraRequested += () => cameraPreview?.RetryCameraPermission();
        view.ExitRequested += () => { Flow.RequestExit(); Refresh(); };
        view.ExitConfirmed += LeavePresentation;
        view.ExitCancelled += () => { Flow.CancelExit(); Refresh(); };
        view.BackRequested += () => { Flow.Back(); Refresh(); };
        subscribed = true;
        Refresh();
    }

    public bool JoinPreview(PresentationUiRole role, string code)
    {
        if (!Flow.SelectRole(role) || !Flow.JoinPreviewRoom(code)) return false;
        BeginCalibration();
        return true;
    }

    private void BeginCalibration()
    {
        loadError = null;
        if (runner != null && !runner.HasLoadedFixture
            && (!runner.TryLoad(out string error) || !runner.TryAdvance(out error)))
        {
            loadError = "The sample could not be loaded. Leave and try again.";
            Debug.LogError("[Presentation UI] Sample loading failed: " + error, this);
        }
        alignment?.ResetAlignment("preview-session-started");
        Refresh();
    }

    public void AdvancePresentation()
    {
        if (!Flow.State.CanControlPresentation || calibration == null || !calibration.Calibration.IsValid) return;
        controls?.TryAdvance(out _);
    }

    private void Remeasure()
    {
        Flow.MarkCalibrationLost();
        alignment?.ResetAlignment("user-requested-remeasurement");
        Refresh();
    }

    public void LeavePresentation()
    {
        if (!Flow.ConfirmExit()) return;
        runner?.Clear();
        calibration?.Calibration.Invalidate("presentation-exited");
        loadError = null;
        Refresh();
    }

    private void ApplyGates()
    {
        var state = Flow.State;
        bool active = enabled && gameObject.activeInHierarchy;
        bool inSession = active && (state.Page == PresentationUiPage.Calibration || state.Page == PresentationUiPage.Presenting
            || state.Page == PresentationUiPage.ExitConfirmation);
        if (runner != null) { runner.KeyboardAdvanceEnabled = false; runner.enabled = inSession; }
        if (controls != null) controls.PresentationInputEnabled = active && state.CanControlPresentation;
        if (binding != null) binding.PresentationVisible = active && (state.Page == PresentationUiPage.Presenting
            || (state.Page == PresentationUiPage.ExitConfirmation && state.CalibrationComplete
                && state.ExitReturnPage == PresentationUiPage.Presenting));
        if (cameraPreview != null)
        {
            cameraPreview.DiagnosticUiVisible = false;
            cameraPreview.DiagnosticInputEnabled = false;
            cameraPreview.enabled = inSession;
        }
        if (alignment != null) alignment.GetComponent<ArucoOriginVisualizer>().Visible = false;
    }

    private void Update()
    {
        if (!subscribed) return;
        calibration?.Refresh();
        bool valid = calibration != null && calibration.Calibration.IsValid;
        if (loadError == null && Flow.State.Page == PresentationUiPage.Calibration && valid && !Flow.State.CalibrationComplete)
            Flow.MarkCalibrationComplete();
        else if (Flow.State.CalibrationComplete && !valid) Flow.MarkCalibrationLost();
        Refresh();
        HandlePointer();
    }

    private void Refresh()
    {
        ApplyGates();
        if (view == null) return;
        var message = loadError ?? (cameraPreview != null ? cameraPreview.CalibrationMessage : "Look at the marker and hold still.");
        view.Render(Flow.State, message, alignment != null ? alignment.CalibrationProgress : 0,
            runner != null ? runner.AppliedEventCount : 0);
        var motion = runner != null ? runner.GetComponent<QuestLocalArmMotionControls>() : null;
        if (motion != null) view.SetProgressionHint(!Flow.State.CanControlPresentation
            ? "Audience: watch the presentation"
            : controls != null && controls.CanAdvance ? motion.ProgressionHint
            : runner.IsAnimating ? "Wait for the animation" : "Presentation complete");
        var next = view.FindButton("Next");
        if (next != null) next.interactable = Flow.State.CanControlPresentation && controls != null && controls.CanAdvance;
    }

    private void HandlePointer()
    {
        var device = InputDevices.GetDeviceAtXRNode(XRNode.RightHand);
        bool tracked = device.TryGetFeatureValue(CommonUsages.isTracked, out bool value) && value;
        bool pressed = tracked && device.TryGetFeatureValue(CommonUsages.triggerButton, out bool trigger) && trigger;
        if (tracked && rightController != null)
        {
            var ray = new Ray(rightController.position, rightController.forward);
            ShowPointer(ray);
            if (pressed && !triggerWasPressed) view.TryPress(ray);
        }
        else if (pointer != null) pointer.enabled = false;
        triggerWasPressed = pressed;
#if UNITY_EDITOR
        var mouse = Mouse.current;
        var camera = head != null ? head.GetComponent<Camera>() : Camera.main;
        if (mouse != null && camera != null && mouse.leftButton.wasPressedThisFrame)
            view.TryPress(camera.ScreenPointToRay(mouse.position.ReadValue()));
#endif
    }

    private void ShowPointer(Ray ray)
    {
        if (pointer == null)
        {
            var obj = new GameObject("UI pointer");
            obj.transform.SetParent(transform, false);
            pointer = obj.AddComponent<LineRenderer>();
            pointerMaterial = new Material(Resources.Load<Material>("ArucoDiagnosticUnlit"));
            pointerMaterial.color = new Color(0.35f, 0.92f, 0.76f);
            pointer.sharedMaterial = pointerMaterial;
            pointer.positionCount = 2;
            pointer.startWidth = 0.002f;
            pointer.endWidth = 0.002f;
            pointer.useWorldSpace = true;
        }
        pointer.enabled = true;
        float distance = 2;
        if (view.Panel != null)
        {
            var plane = new Plane(view.Panel.transform.forward, view.Panel.transform.position);
            if (plane.Raycast(ray, out float hit)) distance = Mathf.Min(hit, 2);
        }
        pointer.SetPosition(0, ray.origin);
        pointer.SetPosition(1, ray.GetPoint(distance));
    }

    private void OnEnable()
    {
        if (view != null) view.enabled = true;
        if (subscribed) Refresh();
    }

    private void OnDisable()
    {
        if (view != null) view.enabled = false;
        if (runner != null) runner.enabled = false;
        if (pointer != null) pointer.enabled = false;
        if (binding != null) binding.PresentationVisible = false;
        if (controls != null) controls.PresentationInputEnabled = false;
        if (cameraPreview != null) cameraPreview.enabled = false;
    }

    private void OnDestroy()
    {
        if (pointerMaterial != null) Destroy(pointerMaterial);
    }
}

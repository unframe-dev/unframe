using System;
using System.Collections.Generic;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.XR;

public sealed class QuestLocalPresentationControls : MonoBehaviour
{
    [SerializeField] private ArucoPresentationCalibration calibrationSource;
    [SerializeField] private LocalPresentationFixtureRunner runner;
    private readonly List<XRInputSubsystem> xrSubsystems = new List<XRInputSubsystem>();
    private readonly HashSet<XRInputSubsystem> subscribedSubsystems = new HashSet<XRInputSubsystem>();
    private bool advanceWasPressed;
    private bool restartWasPressed;
    private bool remeasureWasPressed;
    private bool applicationPaused;
    private string errorSummary;

    public bool CanAdvance => CanInteract && runner.CanAdvance;
    private bool CanInteract => isActiveAndEnabled && !applicationPaused && runner != null && runner.isActiveAndEnabled
        && calibrationSource != null && calibrationSource.isActiveAndEnabled && calibrationSource.Calibration.IsValid;

    public string Summary
    {
        get
        {
            string progress = runner == null ? "Fixture not configured"
                : !runner.HasLoadedFixture ? "Fixture not loaded"
                : "Event " + runner.AppliedEventCount + "/" + runner.ReliableEventCount
                    + (runner.IsAnimating ? " (animating)" : !runner.CanAdvance ? " (complete)" : "");
            string calibration = calibrationSource == null ? "Calibration source unavailable"
                : calibrationSource.Calibration.IsValid ? "Marker calibration confirmed"
                : "Calibration required: " + calibrationSource.Calibration.Reason;
            return "Local presentation: " + progress + "\n" + calibration
                + (errorSummary == null ? "" : "\n" + errorSummary)
                + "\nA: next | X: restart | B/Y: align again";
        }
    }

    public void Configure(ArucoPresentationCalibration calibration, LocalPresentationFixtureRunner presentation)
    {
        if (calibration == null || presentation == null)
            throw new ArgumentException("Marker calibration and local presentation runner are required.");
        calibrationSource = calibration;
        runner = presentation;
        CaptureButtons();
    }

    public bool TryAdvance(out string error)
    {
        if (!CanInteract)
        {
            error = "An active, calibrated local presentation is required.";
            return false;
        }
        bool advanced = runner.TryAdvance(out error);
        errorSummary = advanced ? null : error;
        return advanced;
    }

    public bool ResetPresentation(out string error)
    {
        if (!isActiveAndEnabled || applicationPaused || runner == null || !runner.isActiveAndEnabled)
        {
            error = "An active local presentation runner is required.";
            return false;
        }
        bool reset = runner.TryLoad(out error) && runner.TryAdvance(out error);
        errorSummary = reset ? null : error;
        return reset;
    }

    public void ResetCalibration() => InvalidateCalibration("user-requested-remeasurement");

    public void ProcessButtons(bool advance, bool restart, bool remeasure)
    {
        bool shouldRemeasure = remeasure && !remeasureWasPressed;
        bool shouldRestart = restart && !restartWasPressed;
        bool shouldAdvance = advance && !advanceWasPressed;
        advanceWasPressed = advance;
        restartWasPressed = restart;
        remeasureWasPressed = remeasure;
        if (!isActiveAndEnabled) return;
        if (shouldRemeasure) ResetCalibration();
        else if (CanInteract)
        {
            if (shouldRestart) ResetPresentation(out _);
            else if (shouldAdvance && CanAdvance) TryAdvance(out _);
        }
    }

    private void Start()
    {
        if (runner != null && !runner.HasLoadedFixture) ResetPresentation(out _);
    }

    private void OnEnable()
    {
        InputTracking.trackingLost += OnTrackingLost;
        SubscribeTrackingOrigins();
        CaptureButtons();
    }

    private void Update()
    {
        SubscribeTrackingOrigins();
        ProcessButtons(IsPressed(XRNode.RightHand, CommonUsages.primaryButton),
            IsPressed(XRNode.LeftHand, CommonUsages.primaryButton),
            IsPressed(XRNode.LeftHand, CommonUsages.secondaryButton)
                || IsPressed(XRNode.RightHand, CommonUsages.secondaryButton));
    }

    private void CaptureButtons()
    {
        advanceWasPressed = IsPressed(XRNode.RightHand, CommonUsages.primaryButton);
        restartWasPressed = IsPressed(XRNode.LeftHand, CommonUsages.primaryButton);
        remeasureWasPressed = IsPressed(XRNode.LeftHand, CommonUsages.secondaryButton)
            || IsPressed(XRNode.RightHand, CommonUsages.secondaryButton);
    }

    private static bool IsPressed(XRNode hand, InputFeatureUsage<bool> feature)
    {
        InputDevice device = InputDevices.GetDeviceAtXRNode(hand);
        return device.isValid && device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked) && tracked
            && device.TryGetFeatureValue(feature, out bool pressed) && pressed;
    }

    private void SubscribeTrackingOrigins()
    {
        SubsystemManager.GetSubsystems(xrSubsystems);
        foreach (XRInputSubsystem subsystem in xrSubsystems)
            if (subscribedSubsystems.Add(subsystem)) subsystem.trackingOriginUpdated += OnTrackingOriginUpdated;
    }

    private void OnTrackingLost(XRNodeState state)
    {
        if (state.nodeType == XRNode.Head) InvalidateCalibration("head-tracking-lost");
    }

    private void OnTrackingOriginUpdated(XRInputSubsystem _) => InvalidateCalibration("tracking-origin-changed");

    private void OnApplicationPause(bool paused)
    {
        applicationPaused = paused;
        if (paused) InvalidateCalibration("application-paused");
        CaptureButtons();
    }

    private void InvalidateCalibration(string reason) => calibrationSource?.Calibration.Invalidate(reason);

    private void OnDisable()
    {
        InputTracking.trackingLost -= OnTrackingLost;
        foreach (XRInputSubsystem subsystem in subscribedSubsystems) subsystem.trackingOriginUpdated -= OnTrackingOriginUpdated;
        subscribedSubsystems.Clear();
        InvalidateCalibration("local-controls-disabled");
    }
}

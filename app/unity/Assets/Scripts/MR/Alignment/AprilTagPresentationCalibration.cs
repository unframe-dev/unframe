using System;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class AprilTagPresentationCalibration : MonoBehaviour
{
    [SerializeField] private AprilTagOriginAlignment alignment;
    public PassthroughCameraDevicePreview CameraPreview => alignment != null ? alignment.GetComponent<PassthroughCameraDevicePreview>() : null;
    [SerializeField] private Transform questTrackingOrigin;
    private AprilTagOriginAlignment subscribedAlignment;
    private Pose capturedTrackingFrame;
    private bool hasCapturedFrame;
    private bool changingCalibration;
    private bool placementEnabled;
    private Transform head;
    public PresenterOriginPlacement Placement { get; } = new PresenterOriginPlacement();
    public void ConfigureHead(Transform source)
    {
        bool markerOnlyMeasurement = !placementEnabled && hasCapturedFrame;
        bool headChanged = placementEnabled && !ReferenceEquals(head, source);
        placementEnabled = true;
        head = source;
        if (headChanged) ResetSource("placement-head-changed-show-marker-again");
        else if (markerOnlyMeasurement) ResetSource("placement-enabled-show-marker-again");
        Refresh();
    }
    public void BeginSession(string id)
    {
        if (Placement.BeginSession(id)) ResetSource("session-changed-show-marker-again");
    }
    public void RequestPlacement()
    {
        Placement.RequestPlacement();
        ResetSource("user-requested-remeasurement");
    }

    public PresentationCalibrationState Calibration { get; } = new PresentationCalibrationState();
    public Transform QuestTrackingOrigin => questTrackingOrigin;
    public bool AlignmentVisualizationVisible
    {
        get => alignment == null || alignment.VisualizationVisible;
        set { if (alignment != null) alignment.VisualizationVisible = value; }
    }
    public int MarkerSizeMillimeters => alignment != null ? alignment.MarkerSizeMillimeters : 150;
    public void SelectMarkerSize(int millimeters)
    {
        if (alignment == null) return;
        alignment.SelectMarkerSize(millimeters);
        Refresh();
    }

    public void Configure(AprilTagOriginAlignment source, Transform trackingOrigin)
    {
        if (source == null || trackingOrigin == null)
            throw new ArgumentException("Alignment and Quest tracking origin are required.");
        Unsubscribe();
        InvalidateCalibration("calibration-source-changed");
        hasCapturedFrame = false;
        alignment = source;
        questTrackingOrigin = trackingOrigin;
        Subscribe();
        Refresh();
    }

    public void Refresh()
    {
        if (!isActiveAndEnabled || alignment == null || !alignment.isActiveAndEnabled
            || !alignment.TrackingAvailable || questTrackingOrigin == null
            || !questTrackingOrigin.gameObject.activeInHierarchy)
        {
            ResetSource("calibration-source-unavailable");
            return;
        }
        if (!alignment.IsConfirmed)
        {
            if (Calibration.IsValid) InvalidateCalibration("marker-not-confirmed");
            hasCapturedFrame = false;
            return;
        }
        Pose trackingFrame = new Pose(questTrackingOrigin.position, questTrackingOrigin.rotation);
        if (hasCapturedFrame && (!capturedTrackingFrame.position.Equals(trackingFrame.position)
            || !capturedTrackingFrame.rotation.Equals(trackingFrame.rotation)))
        {
            ResetSource("Tracking origin changed; show ID 0 again");
            return;
        }
        Pose marker = alignment.OriginPose;
        if (!PresentationCalibrationMath.TryFromWorldOrigin(marker, questTrackingOrigin,
            out var calibration, out string error))
        {
            ResetSource(error);
            return;
        }
        if (!hasCapturedFrame && placementEnabled)
        {
            if (head == null || !head.gameObject.activeInHierarchy)
            {
                ResetSource("placement-head-unavailable-show-marker-again");
                return;
            }
            Placement.Capture(marker, new Pose(head.position, head.rotation));
        }
        capturedTrackingFrame = trackingFrame;
        hasCapturedFrame = true;
        if (!Calibration.TrySet(calibration, out error)) ResetSource(error);
    }

    private void ResetSource(string reason)
    {
        InvalidateCalibration(reason);
        hasCapturedFrame = false;
        if (alignment != null && alignment.IsConfirmed) alignment.ResetAlignment(reason);
    }

    private void OnSourceReset()
    {
        if (!changingCalibration) InvalidateCalibration("marker-alignment-reset");
        hasCapturedFrame = false;
    }

    private void InvalidateCalibration(string reason)
    {
        Placement.InvalidateCapture();
        bool previous = changingCalibration;
        changingCalibration = true;
        try { Calibration.Invalidate(reason); }
        finally { changingCalibration = previous; }
    }

    private void OnCalibrationChanged()
    {
        if (changingCalibration || Calibration.IsValid) return;
        Placement.InvalidateCapture();
        hasCapturedFrame = false;
        if (alignment == null || !alignment.IsConfirmed) return;
        changingCalibration = true;
        try { alignment.ResetAlignment(Calibration.Reason); }
        finally { changingCalibration = false; }
    }

    private void Subscribe()
    {
        if (!isActiveAndEnabled || alignment == null || subscribedAlignment == alignment) return;
        subscribedAlignment = alignment;
        subscribedAlignment.AlignmentInvalidated += OnSourceReset;
    }

    private void Unsubscribe()
    {
        if (subscribedAlignment != null) subscribedAlignment.AlignmentInvalidated -= OnSourceReset;
        subscribedAlignment = null;
    }

    private void OnEnable()
    {
        Calibration.Changed += OnCalibrationChanged;
        Subscribe();
        Refresh();
    }

    private void LateUpdate() => Refresh();

    private void OnDisable()
    {
        Calibration.Changed -= OnCalibrationChanged;
        Unsubscribe();
        ResetSource("calibration-disabled");
    }

    private void OnDestroy()
    {
        Calibration.Changed -= OnCalibrationChanged;
        Unsubscribe();
        InvalidateCalibration("calibration-destroyed");
    }
}

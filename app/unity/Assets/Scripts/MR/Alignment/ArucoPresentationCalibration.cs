using System;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class ArucoPresentationCalibration : MonoBehaviour
{
    [SerializeField] private ArucoOriginAlignment alignment;
    [SerializeField] private Transform questTrackingOrigin;
    private ArucoOriginAlignment subscribedAlignment;
    private Pose capturedTrackingFrame;
    private bool hasCapturedFrame;
    private bool changingCalibration;

    public PresentationCalibrationState Calibration { get; } = new PresentationCalibrationState();
    public Transform QuestTrackingOrigin => questTrackingOrigin;

    public void Configure(ArucoOriginAlignment source, Transform trackingOrigin)
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
        if (!PresentationCalibrationMath.TryFromWorldOrigin(alignment.OriginPose, questTrackingOrigin,
            out var calibration, out string error))
        {
            ResetSource(error);
            return;
        }
        if (!Calibration.TrySet(calibration, out error))
        {
            ResetSource(error);
            return;
        }
        capturedTrackingFrame = trackingFrame;
        hasCapturedFrame = true;
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
        bool previous = changingCalibration;
        changingCalibration = true;
        try { Calibration.Invalidate(reason); }
        finally { changingCalibration = previous; }
    }

    private void OnCalibrationChanged()
    {
        if (changingCalibration || Calibration.IsValid) return;
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

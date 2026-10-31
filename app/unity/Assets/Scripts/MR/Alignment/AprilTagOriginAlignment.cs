using System;
using UnityEngine;

[RequireComponent(typeof(AprilTagTrackingDiagnosticSession))]
[RequireComponent(typeof(AprilTagOriginVisualizer))]
[RequireComponent(typeof(AprilTagCameraMarkerDetection))]
public sealed class AprilTagOriginAlignment : MonoBehaviour
{
    [SerializeField] private AprilTagMarkerSize markerSize = AprilTagMarkerSize.Mm150;
    public int MarkerSizeMillimeters => (int)markerSize;
    public void SelectMarkerSize(int millimeters)
    {
        var selected = AprilTagMarkerSizes.FromMillimeters(millimeters);
        if (selected == markerSize) return;
        markerSize = selected;
        GetComponent<AprilTagCameraMarkerDetection>().SelectMarkerSize(millimeters);
        ResetAlignment($"Marker size changed to {millimeters} mm; show ID 0 again");
    }

    private bool visualizationVisible = true;
    public bool VisualizationVisible
    {
        get => visualizationVisible;
        set
        {
            if (visualizationVisible == value) return;
            visualizationVisible = value;
            if (visualizer == null) visualizer = GetComponent<AprilTagOriginVisualizer>();
            if (visualizer == null) return;
            visualizer.Visible = value;
            if (!value) return;
            if (IsConfirmed) visualizer.Show(stability.Pose);
            else visualizer.Hide();
        }
    }
    private readonly AprilTagOriginStability stability = new AprilTagOriginStability();
    private AprilTagOriginVisualizer visualizer;
    private AprilTagTrackingDiagnosticSession diagnostics;
    private OVRDisplay display;
    private OVRCameraRig rig;
    private long lastTimestamp;
    private double loggedAt = double.NegativeInfinity;
    private string reason = "Show ID 0; hold still or tilt the marker slightly";
    public event Action ResetRequested;
    public event Action AlignmentInvalidated;
    public bool IsConfirmed => stability.IsConfirmed;
    public float CalibrationProgress => IsConfirmed ? 1 : Mathf.Clamp01(Mathf.Min(
        stability.SampleCount / (float)AprilTagOriginStability.MinimumSamples,
        (float)(stability.StableDurationSeconds / AprilTagOriginStability.MinimumStableDurationSeconds)));
    public bool TrackingAvailable { get; private set; } = true;
    public Pose OriginPose => stability.Pose;
    public string Summary => IsConfirmed ? $"ALIGNED | ID 0 / {MarkerSizeMillimeters} mm | camera stopped | X red / Y green / Z blue"
        : $"ALIGNING | ID 0 / {MarkerSizeMillimeters} mm | {stability.SampleCount}/8 samples | {stability.StableDurationSeconds:F1}s | {reason}";

    private void Awake()
    {
        GetComponent<AprilTagCameraMarkerDetection>().SelectMarkerSize(MarkerSizeMillimeters);
        diagnostics = GetComponent<AprilTagTrackingDiagnosticSession>();
        visualizer = GetComponent<AprilTagOriginVisualizer>();
        visualizer.Visible = visualizationVisible;
    }

    private void OnEnable()
    {
#if !UNITY_EDITOR
        OVRManager.TrackingLost += OnTrackingLost;
        OVRManager.TrackingAcquired += OnTrackingAcquired;
        rig = FindFirstObjectByType<OVRCameraRig>();
        if (rig != null) rig.TrackingSpaceChanged += OnTrackingSpaceChanged;
#endif
    }

    private void Update()
    {
#if !UNITY_EDITOR
        if (display == null && OVRManager.display != null)
        {
            display = OVRManager.display;
            display.RecenteredPose += OnRecenter;
        }
        if (OVRManager.tracker != null && TrackingAvailable != OVRManager.tracker.isPositionTracked)
        {
            if (OVRManager.tracker.isPositionTracked) OnTrackingAcquired();
            else OnTrackingLost();
        }
#endif
    }

    public void Observe(AprilTagPoseObservation observation, double now)
    {
        if (!isActiveAndEnabled || IsConfirmed || !TrackingAvailable) return;
        if (observation == null)
        {
            stability.ObserveMissing(now);
            return;
        }
        if (observation.Frame.CaptureTimestampTicks <= lastTimestamp) return;
        lastTimestamp = observation.Frame.CaptureTimestampTicks;
        var estimate = observation.Estimate;
        bool valid = estimate != null && estimate.IsValid && observation.Geometry.HasValidCameraPose;
        reason = valid ? "Hold still" : estimate?.RejectionReason ?? "Show the entire ID 0 marker";
        bool candidate = estimate != null && estimate.HasPoseCandidate && observation.Geometry.HasValidCameraPose;
        var pose = candidate ? observation.Geometry.ToWorld(estimate.CameraPose) : Pose.identity;
        candidate = candidate && AprilTagMarkerPoseEstimate.ValidPose(pose) && !double.IsNaN(now) && !double.IsInfinity(now);
        stability.Observe(pose, lastTimestamp, now, valid && candidate);
        if (IsConfirmed)
        {
            visualizer.Show(stability.Pose);
            Record("alignment_confirmed", observation, stability.Pose);
        }
        else
        {
            if (now - loggedAt >= 1)
            {
                loggedAt = now;
                Record("pose_estimated", observation, pose);
            }
        }
    }

    public void ResetAlignment(string message, bool notify = true)
    {
        stability.Reset();
        lastTimestamp = 0;
        loggedAt = double.NegativeInfinity;
        reason = message;
        if (visualizer != null) visualizer.Hide();
        Record("alignment_reset", null, Pose.identity);
        AlignmentInvalidated?.Invoke();
        if (notify) ResetRequested?.Invoke();
    }

    private void OnTrackingLost()
    {
        TrackingAvailable = false;
        ResetAlignment("Tracking lost; reacquire tracking and show ID 0");
    }
    private void OnTrackingAcquired()
    {
        TrackingAvailable = true;
        ResetAlignment("Tracking restored; show ID 0");
    }
    private void OnRecenter() => ResetAlignment("Origin changed; show ID 0 again");
    private void OnTrackingSpaceChanged(Transform _) => ResetAlignment("Tracking space changed; show ID 0 again");

    private void Record(string eventType, AprilTagPoseObservation observation, Pose pose)
    {
        if (diagnostics == null) return;
        var estimate = observation?.Estimate;
        bool valid = estimate != null && estimate.IsValid && observation.Geometry.HasValidCameraPose;
        diagnostics.TryRecord(new AprilTagTrackingDiagnosticEvent
        {
            eventType = eventType,
            message = reason,
            markerDictionary = AprilTagMarkerDetector.DictionaryName,
            markerSizeMeters = MarkerSizeMillimeters / 1000.0,
            markerIds = observation?.Frame.MarkerIds ?? new int[0],
            cameraWidth = observation?.Frame.Resolution.x ?? 0,
            cameraHeight = observation?.Frame.Resolution.y ?? 0,
            cameraFx = (float)(observation?.Geometry.Fx ?? 0),
            cameraFy = (float)(observation?.Geometry.Fy ?? 0),
            cameraCx = (float)(observation?.Geometry.Cx ?? 0),
            cameraCy = (float)(observation?.Geometry.Cy ?? 0),
            worldFromCameraPositionMeters = observation != null && observation.Geometry.HasValidCameraPose
                ? Position(observation.Geometry.CameraPose) : new float[0],
            worldFromCameraRotationXyzw = observation != null && observation.Geometry.HasValidCameraPose
                ? Rotation(observation.Geometry.CameraPose) : new float[0],
            captureTimestampSeconds = observation == null ? 0
                : (new DateTime(observation.Frame.CaptureTimestampTicks, DateTimeKind.Utc) - DateTime.UnixEpoch).TotalSeconds,
            poseValid = valid,
            cameraFromMarkerPositionMeters = valid ? Position(estimate.CameraPose) : new float[0],
            cameraFromMarkerRotationXyzw = valid ? Rotation(estimate.CameraPose) : new float[0],
            hasReprojectionError = estimate != null && !double.IsNaN(estimate.ReprojectionErrorPixels)
                && !double.IsInfinity(estimate.ReprojectionErrorPixels),
            reprojectionErrorPixels = estimate == null || double.IsNaN(estimate.ReprojectionErrorPixels)
                || double.IsInfinity(estimate.ReprojectionErrorPixels) ? 0 : (float)estimate.ReprojectionErrorPixels,
            trackingAvailable = TrackingAvailable,
            alignmentConfirmed = IsConfirmed,
            alignmentSampleCount = stability.SampleCount,
            worldFromMarkerPositionMeters = valid ? Position(pose) : new float[0],
            worldFromMarkerRotationXyzw = valid ? Rotation(pose) : new float[0]
        });
    }

    private static float[] Position(Pose pose) => new[] { pose.position.x, pose.position.y, pose.position.z };
    private static float[] Rotation(Pose pose) => new[] { pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w };

    private void OnDisable()
    {
        ResetAlignment("Alignment disabled", false);
        UnsubscribeTracking();
    }

    private void UnsubscribeTracking()
    {
        OVRManager.TrackingLost -= OnTrackingLost;
        OVRManager.TrackingAcquired -= OnTrackingAcquired;
        if (display != null) display.RecenteredPose -= OnRecenter;
        if (rig != null) rig.TrackingSpaceChanged -= OnTrackingSpaceChanged;
        display = null;
        rig = null;
    }

    private void OnDestroy() => UnsubscribeTracking();
}

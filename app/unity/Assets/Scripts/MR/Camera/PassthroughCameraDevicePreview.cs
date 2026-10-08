using System;
using System.IO;
using Meta.XR;
using UnityEngine;
using UnityEngine.Android;

[RequireComponent(typeof(ArucoTrackingDiagnosticSession))]
[RequireComponent(typeof(ArucoCameraMarkerDetection))]
[RequireComponent(typeof(ArucoOriginAlignment))]
public sealed class PassthroughCameraDevicePreview : MonoBehaviour
{
    [SerializeField] private PassthroughCameraAccess cameraAccess;
    [SerializeField] private Transform head;
    [SerializeField] private bool handleRemeasurementInput = true;
    [SerializeField] private bool diagnosticUiVisible = true;
    [SerializeField] private bool diagnosticInputEnabled = true;

    public bool DiagnosticUiVisible
    {
        get => diagnosticUiVisible;
        set
        {
            diagnosticUiVisible = value;
            view?.SetVisible(value && isActiveAndEnabled);
        }
    }
    public bool DiagnosticInputEnabled
    {
        get => diagnosticInputEnabled;
        set => diagnosticInputEnabled = value;
    }

    public void RetryCameraPermission() => RequestCameraPermission();

    public string CalibrationMessage
    {
        get
        {
            if (alignment != null && alignment.IsConfirmed) return "Alignment complete";
            if (alignment != null && !alignment.TrackingAvailable) return "Tracking lost. Look around to recover.";
#if UNITY_EDITOR
            return "Use Quest 3 to align with the marker.";
#else
            if (!sessionState.Supported) return "This device does not support camera alignment.";
            if (requesting) return "Allow camera access to continue.";
            if (!sessionState.PermissionGranted) return "Camera access required. Retry or allow it in app settings.";
#if !UNFRAME_OPENCV_FOR_UNITY
            return "Marker recognition is unavailable in this build.";
#else
            if (health.GetState(Time.realtimeSinceStartupAsDouble) == PassthroughCameraFeedState.Stalled)
                return "Camera paused. Retry camera access.";
            if (alignment != null && alignment.HasAverageMeasurementPose) return "Marker found. Hold still.";
            return "Find the marker. Keep the full border visible.";
#endif
#endif
        }
    }

    private const string CameraPermission = OVRPermissionsRequester.PassthroughCameraAccessPermission;
    private readonly PassthroughCameraPreviewHealth health = new PassthroughCameraPreviewHealth();
    private readonly ArucoCameraSessionState sessionState = new ArucoCameraSessionState();
    private ArucoCameraPreviewView view;
    private ArucoCameraMarkerDetection markerDetection;
    private ArucoOriginAlignment alignment;
    private ArucoTrackingDiagnosticSession diagnosticSession;
    private PermissionCallbacks permissionCallbacks;
    private bool? lastAcquisitionAllowed;
    private bool started;
    private bool requesting;
    private string permissionStatus = "Not requested";
    private string lastState;
    private double requestedAt;
    private double sampleAt;
    private int framesAtSample;
    private float observedFps;
    private double refreshAt;

    private void Start()
    {
        diagnosticSession = GetComponent<ArucoTrackingDiagnosticSession>();
        markerDetection = GetComponent<ArucoCameraMarkerDetection>();
        alignment = GetComponent<ArucoOriginAlignment>();
        alignment.ResetRequested += OnAlignmentReset;
        if (cameraAccess == null || head == null)
        {
            Debug.LogError("[PCA Preview] Camera access and head references are required.", this);
            enabled = false;
            return;
        }

        cameraAccess.enabled = false;
        view = new ArucoCameraPreviewView(head);
        view.SetVisible(diagnosticUiVisible && isActiveAndEnabled);
        GetComponent<ArucoOriginVisualizer>().SetPreviewHead(head);
        started = true;
        health.Reset(Time.realtimeSinceStartupAsDouble);
        Debug.Log($"[PCA Preview] Application: {Application.identifier}", this);
#if UNITY_ANDROID && !UNITY_EDITOR
        try
        {
            sessionState.Supported = PassthroughCameraAccess.IsSupported;
        }
        catch (Exception exception)
        {
            Record("error", exception.Message);
        }
        if (sessionState.Supported)
        {
            RequestCameraPermission();
        }
#endif
        RefreshPanel();
    }

    private void Update()
    {
        double now = Time.realtimeSinceStartupAsDouble;
        SyncSessionState();
        if (lastAcquisitionAllowed != sessionState.ShouldRunCamera) ApplyCameraState();
        if (diagnosticInputEnabled && OVRInput.GetDown(OVRInput.Button.One))
        {
            RequestCameraPermission();
        }
        HandleRemeasurementInput(OVRInput.GetDown(OVRInput.Button.Two));

        if (requesting && now - requestedAt >= 30)
        {
            requesting = false;
            permissionStatus = "No response - press A/X to retry";
            Record("permission_result", permissionStatus);
        }

        bool newFrame = false;
        if (sessionState.ShouldRunCamera && cameraAccess.enabled && cameraAccess.IsPlaying)
        {
            if (cameraAccess.IsUpdatedThisFrame)
            {
                newFrame = health.ObserveFrame(cameraAccess.Timestamp.Ticks, now);
            }
        }

        bool live = sessionState.ShouldRunCamera && cameraAccess.enabled && cameraAccess.IsPlaying
            && health.GetState(now) == PassthroughCameraFeedState.Live;
        Texture texture = live ? cameraAccess.GetTexture() : null;
        if (live && newFrame)
        {
            var intrinsics = cameraAccess.Intrinsics;
            var resolution = ArucoCameraMarkerDetection.DetectionResolution(texture.width, texture.height);
            var geometry = ArucoCameraGeometry.FromSensor(intrinsics.FocalLength, intrinsics.PrincipalPoint,
                intrinsics.SensorResolution, resolution, cameraAccess.GetCameraPose());
            markerDetection.SubmitFrame(texture, cameraAccess.Timestamp.Ticks, geometry);
        }
        else if (!live) markerDetection.ClearFeed();
        alignment.Observe(live ? markerDetection.CurrentObservation : null, now);
        if (alignment.IsConfirmed && cameraAccess.enabled)
        {
            ApplyCameraState();
            live = false;
            texture = null;
        }
        view.SetFeed(texture, live ? markerDetection.CurrentFrame : null, cameraAccess.CurrentResolution);

        if (now >= sampleAt + 1 && live)
        {
            observedFps = (float)((health.FrameCount - framesAtSample) / (now - sampleAt));
            framesAtSample = health.FrameCount;
            sampleAt = now;
            if (health.FrameCount > 0)
            {
                var intrinsics = cameraAccess.Intrinsics;
                Record(new ArucoTrackingDiagnosticEvent
                {
                    eventType = "camera_frame_summary",
                    message = cameraAccess.CameraPosition.ToString(),
                    cameraWidth = cameraAccess.CurrentResolution.x,
                    cameraHeight = cameraAccess.CurrentResolution.y,
                    cameraFramesPerSecond = observedFps,
                    captureTimestampSeconds = (cameraAccess.Timestamp - DateTime.UnixEpoch).TotalSeconds,
                    cameraFx = intrinsics.FocalLength.x,
                    cameraFy = intrinsics.FocalLength.y,
                    cameraCx = intrinsics.PrincipalPoint.x,
                    cameraCy = intrinsics.PrincipalPoint.y
                });
            }
        }

        if (now >= refreshAt)
        {
            refreshAt = now + 0.25;
            RefreshPanel();
        }
    }

    private void RequestCameraPermission()
    {
        SyncSessionState();
        if (!sessionState.CanRequestPermission || requesting)
        {
            return;
        }
#if UNITY_ANDROID && !UNITY_EDITOR
        if (Permission.HasUserAuthorizedPermission(CameraPermission))
        {
            OnPermissionGranted(CameraPermission);
            return;
        }

        sessionState.PermissionGranted = false;
        ApplyCameraState();
        requesting = true;
        requestedAt = Time.realtimeSinceStartupAsDouble;
        permissionStatus = "Requesting";
        Record("permission_result", permissionStatus);
        if (permissionCallbacks == null)
        {
            permissionCallbacks = new PermissionCallbacks();
            permissionCallbacks.PermissionGranted += OnPermissionGranted;
            permissionCallbacks.PermissionDenied += OnPermissionDenied;
        }
        Permission.RequestUserPermission(CameraPermission, permissionCallbacks);
#endif
    }

    private void OnPermissionGranted(string permission)
    {
        if (permission != CameraPermission) return;
        bool changed = !sessionState.PermissionGranted || requesting;
        requesting = false;
        sessionState.PermissionGranted = true;
        permissionStatus = "Granted";
        if (changed) Record("permission_result", permissionStatus);
        ApplyCameraState();
    }

    private void OnPermissionDenied(string permission)
    {
        if (permission != CameraPermission) return;
        requesting = false;
        sessionState.PermissionGranted = false;
        permissionStatus = "Denied - grant Camera access in device app settings, then press A/X";
        ApplyCameraState();
        Record("permission_result", permissionStatus);
    }

    private void SyncSessionState()
    {
        sessionState.Active = isActiveAndEnabled;
        sessionState.TrackingAvailable = alignment != null && alignment.TrackingAvailable;
        sessionState.AlignmentConfirmed = alignment != null && alignment.IsConfirmed;
    }

    private void ApplyCameraState(bool restart = false)
    {
        if (!started || cameraAccess == null) return;
        SyncSessionState();
        lastAcquisitionAllowed = sessionState.ShouldRunCamera;
        switch (sessionState.GetAction(cameraAccess.enabled, restart))
        {
            case ArucoCameraAction.Start:
                StopCamera();
                ResetHealth();
                cameraAccess.enabled = true;
                Record("camera_state", "Camera started");
                break;
            case ArucoCameraAction.Stop:
                StopCamera();
                break;
        }
    }

    private void RestartCamera()
    {
        SyncSessionState();
        if (!sessionState.CanStartAlignment) return;
        alignment.ResetAlignment("Show ID 0 (20 cm) to align again", false);
        ApplyCameraState(true);
    }

    private void HandleRemeasurementInput(bool pressed)
    {
        if (diagnosticInputEnabled && handleRemeasurementInput && pressed) RestartCamera();
    }

    private void OnAlignmentReset()
    {
        if (!started) return;
        ResetHealth();
        ApplyCameraState(true);
        if (isActiveAndEnabled) RefreshPanel();
    }

    private void ResetHealth()
    {
        if (markerDetection != null) markerDetection.ClearFeed();
        double now = Time.realtimeSinceStartupAsDouble;
        health.Reset(now);
        sampleAt = now;
        framesAtSample = 0;
        observedFps = 0;
    }

    private void StopCamera()
    {
        if (markerDetection != null) markerDetection.DrainReadbackBeforeCameraStops();
        if (cameraAccess != null) cameraAccess.enabled = false;
        view?.ClearFeed();
    }

    private void OnApplicationPause(bool isPaused)
    {
        sessionState.Paused = isPaused;
        if (!started) return;
        if (sessionState.Paused)
        {
            alignment.ResetAlignment("Resumed session requires alignment", false);
            view.ClearFeed();
            markerDetection.ClearFeed();
            RefreshPanel();
        }
        else
        {
            ResetHealth();
            RefreshPermission();
            ApplyCameraState();
        }
    }

    private void OnApplicationFocus(bool hasFocus)
    {
        if (started && hasFocus && !sessionState.Paused) RefreshPermission();
    }

    private void RefreshPermission()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        if (!sessionState.Supported) return;
        if (Permission.HasUserAuthorizedPermission(CameraPermission))
        {
            OnPermissionGranted(CameraPermission);
        }
        else if (!requesting)
        {
            OnPermissionDenied(CameraPermission);
        }
#endif
    }

    private void RefreshPanel()
    {
        string state;
#if UNITY_ANDROID && !UNITY_EDITOR
        state = !sessionState.Supported ? "UNSUPPORTED - Quest 3/3S, Horizon OS 74+ required"
            : sessionState.Paused ? "PAUSED"
            : !alignment.TrackingAvailable ? "TRACKING LOST"
            : alignment.IsConfirmed ? "ALIGNED"
            : !sessionState.PermissionGranted ? "CAMERA PERMISSION REQUIRED"
            : health.GetState(Time.realtimeSinceStartupAsDouble).ToString().ToUpperInvariant();
#else
        state = "EDITOR - Build and Run on Quest 3/3S";
#endif
        string timestamp = health.FrameCount > 0 ? cameraAccess.Timestamp.ToString("HH:mm:ss.fff 'UTC'") : "-";
        string logFile = diagnosticSession.LoggingFailed ? "Stopped"
            : diagnosticSession.Diagnostics != null ? Path.GetFileName(diagnosticSession.Diagnostics.FilePath) : "Unavailable";
        view.ShowStatus(new ArucoCameraPreviewStatus
        {
            State = state,
            PermissionStatus = permissionStatus,
            CameraPosition = cameraAccess.CameraPosition.ToString(),
            Resolution = cameraAccess.CurrentResolution,
            FramesPerSecond = observedFps,
            FrameCount = health.FrameCount,
            CaptureTimestamp = timestamp,
            LogFileName = logFile,
            DetectionSummary = markerDetection.Summary,
            AlignmentSummary = alignment.Summary,
            MeasurementSummary = alignment.MeasurementSummary,
            MeasurementPreviewEnabled = alignment.MeasurementPreviewEnabled,
            AlignmentConfirmed = alignment.IsConfirmed
        });
        if (state != lastState)
        {
            lastState = state;
            Debug.Log($"[PCA Preview] {state}", this);
            Record("camera_state", state);
        }
    }

    private void OnDisable()
    {
        if (!started) return;
        if (alignment != null) alignment.ResetAlignment("Preview disabled; align again", false);
        ApplyCameraState();
        view?.ClearFeed();
        view?.SetVisible(false);
    }

    private void OnEnable()
    {
        if (!started) return;
        view?.SetVisible(diagnosticUiVisible);
        ResetHealth();
        RefreshPermission();
        ApplyCameraState();
    }

    private void Record(string eventType, string message)
    {
        Record(new ArucoTrackingDiagnosticEvent { eventType = eventType, message = message });
    }

    private void Record(ArucoTrackingDiagnosticEvent diagnosticEvent)
    {
        diagnosticSession?.TryRecord(diagnosticEvent);
    }

    private void OnDestroy()
    {
        started = false;
        if (alignment != null) alignment.ResetRequested -= OnAlignmentReset;
        view?.Dispose();
        if (markerDetection != null) markerDetection.DrainReadbackBeforeCameraStops();
        if (cameraAccess != null) cameraAccess.enabled = false;
        if (permissionCallbacks == null) return;
        permissionCallbacks.PermissionGranted -= OnPermissionGranted;
        permissionCallbacks.PermissionDenied -= OnPermissionDenied;
    }
}

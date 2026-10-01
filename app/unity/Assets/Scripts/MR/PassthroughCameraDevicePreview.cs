using System;
using System.IO;
using Meta.XR;
using UnityEngine;
using UnityEngine.Android;
using UnityEngine.UI;

[RequireComponent(typeof(ArucoTrackingDiagnosticSession))]
[RequireComponent(typeof(ArucoCameraMarkerDetection))]
[RequireComponent(typeof(ArucoOriginAlignment))]
public sealed class PassthroughCameraDevicePreview : MonoBehaviour
{
    [SerializeField] private PassthroughCameraAccess cameraAccess;
    [SerializeField] private Transform head;

    private const string CameraPermission = OVRPermissionsRequester.PassthroughCameraAccessPermission;
    private readonly PassthroughCameraPreviewHealth health = new PassthroughCameraPreviewHealth();
    private RectTransform panelRoot;
    private RawImage preview;
    private AspectRatioFitter previewAspect;
    private Text statusText;
    private Text detailsText;
    private ArucoMarkerOverlay markerOverlay;
    private ArucoCameraMarkerDetection markerDetection;
    private ArucoOriginAlignment alignment;
    private ArucoTrackingDiagnosticSession diagnosticSession;
    private PermissionCallbacks permissionCallbacks;
    private bool supported;
    private bool started;
    private bool paused;
    private bool granted;
    private bool requesting;
    private bool loggingFailed;
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
        CreatePanel();
        started = true;
        health.Reset(Time.realtimeSinceStartupAsDouble);
        Debug.Log($"[PCA Preview] Application: {Application.identifier}", this);
#if UNITY_ANDROID && !UNITY_EDITOR
        try
        {
            supported = PassthroughCameraAccess.IsSupported;
        }
        catch (Exception exception)
        {
            Record("error", exception.Message);
        }
        if (supported)
        {
            RequestCameraPermission();
        }
#endif
        RefreshPanel();
    }

    private void Update()
    {
        double now = Time.realtimeSinceStartupAsDouble;
        if (OVRInput.GetDown(OVRInput.Button.One))
        {
            RequestCameraPermission();
        }
        if (OVRInput.GetDown(OVRInput.Button.Two))
        {
            RestartCamera();
        }

        if (requesting && now - requestedAt >= 30)
        {
            requesting = false;
            permissionStatus = "No response - press A/X to retry";
            Record("permission_result", permissionStatus);
        }

        bool newFrame = false;
        if (!paused && granted && cameraAccess.enabled && cameraAccess.IsPlaying)
        {
            if (cameraAccess.IsUpdatedThisFrame)
            {
                newFrame = health.ObserveFrame(cameraAccess.Timestamp.Ticks, now);
            }
        }

        bool live = !alignment.IsConfirmed && alignment.TrackingAvailable && !paused && granted && cameraAccess.enabled && cameraAccess.IsPlaying
            && health.GetState(now) == PassthroughCameraFeedState.Live;
        preview.texture = live ? cameraAccess.GetTexture() : null;
        preview.enabled = live;
        if (live && newFrame)
        {
            var intrinsics = cameraAccess.Intrinsics;
            var resolution = ArucoCameraMarkerDetection.DetectionResolution(preview.texture.width, preview.texture.height);
            var geometry = ArucoCameraGeometry.FromSensor(intrinsics.FocalLength, intrinsics.PrincipalPoint,
                intrinsics.SensorResolution, resolution, cameraAccess.GetCameraPose());
            markerDetection.SubmitFrame(preview.texture, cameraAccess.Timestamp.Ticks, geometry);
        }
        else if (!live) markerDetection.ClearFeed();
        alignment.Observe(live ? markerDetection.CurrentObservation : null, now);
        if (alignment.IsConfirmed && cameraAccess.enabled)
        {
            StopCamera();
            preview.enabled = false;
            live = false;
        }
        markerOverlay.SetFrame(live ? markerDetection.CurrentFrame : null);
        if (live && cameraAccess.CurrentResolution.y > 0)
        {
            previewAspect.aspectRatio = (float)cameraAccess.CurrentResolution.x / cameraAccess.CurrentResolution.y;
        }

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
        if (!supported || paused || requesting)
        {
            return;
        }
#if UNITY_ANDROID && !UNITY_EDITOR
        if (Permission.HasUserAuthorizedPermission(CameraPermission))
        {
            OnPermissionGranted(CameraPermission);
            return;
        }

        StopCamera();
        granted = false;
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
        bool changed = !granted || requesting;
        requesting = false;
        granted = true;
        permissionStatus = "Granted";
        if (changed) Record("permission_result", permissionStatus);
        if (!paused && !alignment.IsConfirmed && alignment.TrackingAvailable && !cameraAccess.enabled)
        {
            RestartCamera();
        }
    }

    private void OnPermissionDenied(string permission)
    {
        if (permission != CameraPermission) return;
        requesting = false;
        granted = false;
        permissionStatus = "Denied - grant Camera access in device app settings, then press A/X";
        StopCamera();
        Record("permission_result", permissionStatus);
    }

    private void RestartCamera()
    {
        if (!supported || !granted || paused || !alignment.TrackingAvailable) return;
        alignment.ResetAlignment("Show ID 0 (20 cm) to align again", false);
        StopCamera();
        ResetHealth();
        cameraAccess.enabled = true;
        Record("camera_state", "Camera started");
    }

    private void OnAlignmentReset()
    {
        if (!started || !isActiveAndEnabled) return;
        StopCamera();
        ResetHealth();
        if (supported && granted && !paused && alignment.TrackingAvailable) cameraAccess.enabled = true;
        RefreshPanel();
    }

    private void ResetHealth()
    {
        markerDetection.ClearFeed();
        double now = Time.realtimeSinceStartupAsDouble;
        health.Reset(now);
        sampleAt = now;
        framesAtSample = 0;
        observedFps = 0;
    }

    private void StopCamera()
    {
        markerDetection.DrainReadbackBeforeCameraStops();
        if (markerOverlay != null) markerOverlay.SetFrame(null);
        cameraAccess.enabled = false;
        if (preview != null) preview.texture = null;
    }

    private void OnApplicationPause(bool isPaused)
    {
        paused = isPaused;
        if (!started) return;
        if (paused)
        {
            alignment.ResetAlignment("Resumed session requires alignment", false);
            // MRUK owns the camera's pause/resume lifecycle; disabling it here would race its restart.
            preview.texture = null;
            preview.enabled = false;
            markerDetection.ClearFeed();
            markerOverlay.SetFrame(null);
            RefreshPanel();
        }
        else
        {
            ResetHealth();
            RefreshPermission();
        }
    }

    private void OnApplicationFocus(bool hasFocus)
    {
        if (started && hasFocus && !paused) RefreshPermission();
    }

    private void RefreshPermission()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        if (!supported) return;
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
        state = !supported ? "UNSUPPORTED - Quest 3/3S, Horizon OS 74+ required"
            : paused ? "PAUSED"
            : !alignment.TrackingAvailable ? "TRACKING LOST"
            : alignment.IsConfirmed ? "ALIGNED"
            : !granted ? "CAMERA PERMISSION REQUIRED"
            : health.GetState(Time.realtimeSinceStartupAsDouble).ToString().ToUpperInvariant();
#else
        state = "EDITOR - Build and Run on Quest 3/3S";
#endif
        statusText.text = $"PCA CAMERA TEST | {state}\nPermission: {permissionStatus}";
        statusText.color = (state == "LIVE" || state == "ALIGNED") ? new Color(0.4f, 1f, 0.5f) : Color.white;
        string timestamp = health.FrameCount > 0 ? cameraAccess.Timestamp.ToString("HH:mm:ss.fff 'UTC'") : "-";
        string logFile = diagnosticSession.Diagnostics != null
            ? Path.GetFileName(diagnosticSession.Diagnostics.FilePath) : "Unavailable";
        UpdatePanelLayout();
        detailsText.text = alignment.IsConfirmed
            ? alignment.Summary + "\nB/Y: align again | Move your head to check the cube stays in place"
            : $"{cameraAccess.CameraPosition} camera | {cameraAccess.CurrentResolution.x} x {cameraAccess.CurrentResolution.y}"
            + $" | {observedFps:F1} camera FPS | {health.FrameCount} frames\nCapture: {timestamp}"
            + $"\n{(alignment.IsConfirmed ? "" : markerDetection.Summary + "\n")}{alignment.Summary}"
            + $"\nA/X: permission check | B/Y: align again\nLog: {logFile}";
        if (state != lastState)
        {
            lastState = state;
            Debug.Log($"[PCA Preview] {state}", this);
            Record("camera_state", state);
        }
    }

    private void CreatePanel()
    {
        var panel = new GameObject("PCA Preview Panel", typeof(RectTransform), typeof(Canvas));
        panelRoot = panel.GetComponent<RectTransform>();
        panel.transform.SetParent(head, false);
        panel.transform.localPosition = new Vector3(0, 0, 1.25f);
        panel.transform.localScale = Vector3.one * 0.001f;
        panel.GetComponent<RectTransform>().sizeDelta = new Vector2(1000, 920);
        panel.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
        panel.GetComponent<Canvas>().worldCamera = head.GetComponent<Camera>();
        var background = panel.AddComponent<Image>();
        background.color = new Color(0.015f, 0.025f, 0.04f, 0.95f);
        background.raycastTarget = false;
        var region = new GameObject("Camera Feed Region", typeof(RectTransform));
        region.transform.SetParent(panel.transform, false);
        region.GetComponent<RectTransform>().sizeDelta = new Vector2(800, 600);
        var image = new GameObject("Camera Feed", typeof(RectTransform), typeof(RawImage));
        image.transform.SetParent(region.transform, false);
        preview = image.GetComponent<RawImage>();
        preview.raycastTarget = false;
        preview.enabled = false;
        previewAspect = image.AddComponent<AspectRatioFitter>();
        previewAspect.aspectMode = AspectRatioFitter.AspectMode.FitInParent;
        previewAspect.aspectRatio = 4f / 3f;
        var overlay = new GameObject("ArUco Marker Outlines", typeof(RectTransform));
        overlay.transform.SetParent(image.transform, false);
        var overlayRect = overlay.GetComponent<RectTransform>();
        overlayRect.anchorMin = Vector2.zero;
        overlayRect.anchorMax = Vector2.one;
        overlayRect.sizeDelta = Vector2.zero;
        markerOverlay = overlay.AddComponent<ArucoMarkerOverlay>();
        markerOverlay.color = new Color(0.2f, 1f, 0.3f, 1f);
        markerOverlay.raycastTarget = false;
        statusText = CreateText(panel.transform, "Status", new Vector2(0, 410), new Vector2(940, 90), 26);
        detailsText = CreateText(panel.transform, "Diagnostics", new Vector2(0, -395), new Vector2(940, 170), 20);
    }

    private void UpdatePanelLayout()
    {
        bool compact = alignment.IsConfirmed;
        panelRoot.sizeDelta = compact ? new Vector2(1000, 160) : new Vector2(1000, 920);
        panelRoot.localPosition = compact ? new Vector3(0, 0.5f, 1.25f) : new Vector3(0, 0, 1.25f);
        statusText.rectTransform.anchoredPosition = new Vector2(0, compact ? 45 : 410);
        statusText.rectTransform.sizeDelta = new Vector2(940, compact ? 60 : 90);
        detailsText.rectTransform.anchoredPosition = new Vector2(0, compact ? -30 : -395);
        detailsText.rectTransform.sizeDelta = new Vector2(940, compact ? 80 : 170);
    }

    private void OnDisable()
    {
        if (!started) return;
        alignment.ResetAlignment("Preview disabled; align again", false);
        StopCamera();
        if (panelRoot != null) panelRoot.gameObject.SetActive(false);
    }

    private void OnEnable()
    {
        if (!started) return;
        if (panelRoot != null) panelRoot.gameObject.SetActive(true);
        ResetHealth();
        RefreshPermission();
    }

    private static Text CreateText(Transform parent, string name, Vector2 position, Vector2 size, int fontSize)
    {
        var textObject = new GameObject(name, typeof(RectTransform), typeof(Text));
        textObject.transform.SetParent(parent, false);
        var rect = textObject.GetComponent<RectTransform>();
        rect.anchoredPosition = position;
        rect.sizeDelta = size;
        var text = textObject.GetComponent<Text>();
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = fontSize;
        text.alignment = TextAnchor.MiddleLeft;
        text.color = Color.white;
        text.raycastTarget = false;
        return text;
    }

    private void Record(string eventType, string message)
    {
        Record(new ArucoTrackingDiagnosticEvent { eventType = eventType, message = message });
    }

    private void Record(ArucoTrackingDiagnosticEvent diagnosticEvent)
    {
        if (loggingFailed || diagnosticSession.Diagnostics == null) return;
        try
        {
            diagnosticSession.Diagnostics.Record(diagnosticEvent);
        }
        catch (Exception exception)
        {
            loggingFailed = true;
            Debug.LogError($"[PCA Preview] Diagnostic logging stopped: {exception.Message}", this);
        }
    }

    private void OnDestroy()
    {
        if (alignment != null) alignment.ResetRequested -= OnAlignmentReset;
        if (panelRoot != null) Destroy(panelRoot.gameObject);
        if (markerDetection != null) markerDetection.DrainReadbackBeforeCameraStops();
        if (cameraAccess != null) cameraAccess.enabled = false;
        if (permissionCallbacks == null) return;
        permissionCallbacks.PermissionGranted -= OnPermissionGranted;
        permissionCallbacks.PermissionDenied -= OnPermissionDenied;
    }
}

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

[RequireComponent(typeof(ArucoTrackingDiagnosticSession))]
public sealed class ArucoOriginAlignment : MonoBehaviour
{
    private readonly ArucoOriginStability stability = new ArucoOriginStability();
    private readonly List<Material> materials = new List<Material>();
    private Transform origin;
    private ArucoTrackingDiagnosticSession diagnostics;
    private OVRDisplay display;
    private OVRCameraRig rig;
    private long lastTimestamp;
    private double loggedAt = double.NegativeInfinity;
    private bool loggingFailed;
    private string reason = "Show ID 0 (20 cm); hold still or tilt the marker slightly";
    public event Action ResetRequested;
    public bool IsConfirmed => stability.IsConfirmed;
    public bool TrackingAvailable { get; private set; } = true;
    public Pose OriginPose => stability.Pose;
    public string Summary => IsConfirmed ? "ALIGNED | ID 0 / 20 cm | camera stopped | X red / Y green / Z blue"
        : $"ALIGNING | {stability.SampleCount}/8 samples | {stability.StableDurationSeconds:F1}s | {reason}";

    private void Awake() => diagnostics = GetComponent<ArucoTrackingDiagnosticSession>();

    private void Start()
    {
        CreateOrigin();
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

    public void Observe(ArucoPoseObservation observation, double now)
    {
        if (IsConfirmed || !TrackingAvailable) return;
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
        var pose = valid ? observation.Geometry.ToWorld(estimate.CameraPose) : Pose.identity;
        stability.Observe(pose, lastTimestamp, now, valid);
        if (IsConfirmed)
        {
            if (origin == null) CreateOrigin();
            origin.SetPositionAndRotation(stability.Pose.position, stability.Pose.rotation);
            origin.gameObject.SetActive(true);
            Record("alignment_confirmed", observation, stability.Pose);
        }
        else if (now - loggedAt >= 1)
        {
            loggedAt = now;
            Record("pose_estimated", observation, pose);
        }
    }

    public void ResetAlignment(string message, bool notify = true)
    {
        stability.Reset();
        lastTimestamp = 0;
        loggedAt = double.NegativeInfinity;
        reason = message;
        if (origin != null) origin.gameObject.SetActive(false);
        Record("alignment_reset", null, Pose.identity);
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

    private void CreateOrigin()
    {
        origin = new GameObject("ArUco ID 0 Origin (20 cm)").transform;
        AddBox("Origin Cube", new Vector3(0, 0, -0.03f), Vector3.one * 0.04f, Color.yellow);
        AddBox("X Right", new Vector3(0.1f, 0, 0), new Vector3(0.2f, 0.005f, 0.005f), Color.red);
        AddBox("Y Up", new Vector3(0, 0.1f, 0), new Vector3(0.005f, 0.2f, 0.005f), Color.green);
        AddBox("Z Into Paper", new Vector3(0, 0, 0.1f), new Vector3(0.005f, 0.005f, 0.2f), Color.blue);
        origin.gameObject.SetActive(false);
    }

    private void AddBox(string name, Vector3 position, Vector3 scale, Color color)
    {
        var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
        box.name = name;
        box.transform.SetParent(origin, false);
        box.transform.localPosition = position;
        box.transform.localScale = scale;
        ReleaseOwnedObject(box.GetComponent<Collider>());
        var template = Resources.Load<Material>("ArucoDiagnosticUnlit");
        if (template == null) throw new InvalidOperationException("Open the PCA device test scene from the Unframe menu to prepare its material.");
        var material = new Material(template);
        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
        if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        materials.Add(material);
        var renderer = box.GetComponent<MeshRenderer>();
        renderer.sharedMaterial = material;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
    }

    private void Record(string eventType, ArucoPoseObservation observation, Pose pose)
    {
        if (loggingFailed || diagnostics == null || diagnostics.Diagnostics == null) return;
        var estimate = observation?.Estimate;
        bool valid = estimate != null && estimate.IsValid && observation.Geometry.HasValidCameraPose;
        try
        {
            diagnostics.Diagnostics.Record(new ArucoTrackingDiagnosticEvent
            {
                eventType = eventType,
                message = reason,
                markerDictionary = ArucoMarkerDetector.DictionaryName,
                markerSizeMeters = ArucoMarkerPoseEstimator.MarkerSizeMeters,
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
        catch (Exception exception)
        {
            loggingFailed = true;
            Debug.LogError("[ArUco Alignment] Diagnostic logging stopped: " + exception.Message, this);
        }
    }

    private static float[] Position(Pose pose) => new[] { pose.position.x, pose.position.y, pose.position.z };
    private static float[] Rotation(Pose pose) => new[] { pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w };

    private static void ReleaseOwnedObject(UnityEngine.Object value)
    {
        if (Application.isPlaying) Destroy(value);
        else DestroyImmediate(value);
    }

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

    private void OnDestroy()
    {
        UnsubscribeTracking();
        if (origin != null) ReleaseOwnedObject(origin.gameObject);
        foreach (var material in materials) ReleaseOwnedObject(material);
    }
}

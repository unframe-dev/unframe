using System;
using System.Threading;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ImgprocModule;
using OpenCVForUnity.Extensions;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

[RequireComponent(typeof(ArucoTrackingDiagnosticSession))]
public sealed class ArucoCameraMarkerDetection : MonoBehaviour
{
    private readonly ArucoDetectionFrameGate gate = new ArucoDetectionFrameGate();
    private ArucoMarkerDetector detector;
    private Mat rgba;
    private Mat gray;
    private RenderTexture snapshot;
    private readonly ArucoMarkerPoseEstimator poseEstimator = new ArucoMarkerPoseEstimator();
    private ArucoPoseObservation observation;
    private CancellationToken destructionToken;
    private ArucoTrackingDiagnosticSession diagnostics;
    private ArucoMarkerDetectionFrame result;
    private double receivedAt;
    private double requestedAt;
    private AsyncGPUReadbackRequest readback;
    private bool readbackIssued;
    private double loggedAt = double.NegativeInfinity;
    private bool feedAvailable;
    private bool destroying;
    private bool loggingFailed;
    private string error;
    private string previousIds;
    public int ProcessedFrames { get; private set; }
    public double ReadbackMilliseconds { get; private set; }

    public ArucoPoseObservation CurrentObservation => CurrentFrame == null ? null : observation;

    public static Vector2Int DetectionResolution(int width, int height) => new Vector2Int(width, height);

    public ArucoMarkerDetectionFrame CurrentFrame => feedAvailable && result != null
        && Time.realtimeSinceStartupAsDouble - requestedAt <= 0.5 ? result : null;

    public string Summary
    {
        get
        {
            if (error != null) return "ArUco ERROR: " + error;
            var frame = CurrentFrame;
            string ids = frame == null ? "waiting" : frame.MarkerIds.Length == 0 ? "none" : string.Join(", ", frame.MarkerIds);
            return $"ArUco {ArucoMarkerDetector.DictionaryName} | IDs: {ids} | {ProcessedFrames} samples"
                + (frame == null ? "" : $" | {frame.ProcessingMilliseconds:F1} ms detect / {ReadbackMilliseconds:F1} ms readback");
        }
    }

    private void Awake()
    {
        destructionToken = destroyCancellationToken;
        diagnostics = GetComponent<ArucoTrackingDiagnosticSession>();
    }

    public void SubmitFrame(Texture texture, long captureTimestampTicks, ArucoCameraGeometry geometry)
    {
        if (!isActiveAndEnabled || texture == null || error != null) return;
        feedAvailable = true;
        if (!SystemInfo.supportsAsyncGPUReadback)
        {
            SetError("AsyncGPUReadback is not supported on this device.");
            return;
        }
        if (!gate.TryBegin(captureTimestampTicks, Time.realtimeSinceStartupAsDouble, out int generation)) return;
        DetectFrame(texture, captureTimestampTicks, generation, geometry);
    }

    private async void DetectFrame(Texture texture, long timestamp, int generation, ArucoCameraGeometry geometry)
    {
        try
        {
            var resolution = DetectionResolution(texture.width, texture.height);
            EnsureBuffers(resolution.x, resolution.y);
            double startedAt = Time.realtimeSinceStartupAsDouble;
            // Keep the sampled image separate from the PCA texture, which the render thread continues updating.
            Graphics.Blit(texture, snapshot);
            readback = AsyncGPUReadback.Request(snapshot, 0, GraphicsFormat.R8G8B8A8_UNorm);
            readbackIssued = true;
            while (!readback.done) await Awaitable.NextFrameAsync(destructionToken);
            if (destroying || generation != gate.Generation || !isActiveAndEnabled) return;
            ReadbackMilliseconds = (Time.realtimeSinceStartupAsDouble - startedAt) * 1000;
            if (readback.hasError) throw new InvalidOperationException("GPU camera readback failed. Press B/Y to retry.");
            if (Time.realtimeSinceStartupAsDouble - startedAt > 0.5) return;
            MatBufferUtils.CopyToMat<byte>(readback.GetData<byte>(), rgba);
            await Awaitable.BackgroundThreadAsync();
            ArucoMarkerDetectionFrame detected;
            ArucoMarkerPoseEstimate estimated = null;
            try
            {
                // GPU pixels use Unity's lower-left origin; OpenCV corners use the upper-left origin.
                Core.flip(rgba, rgba, 0);
                Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY);
                detected = detector.Detect(gray, timestamp);
                int index = Array.IndexOf(detected.MarkerIds, ArucoMarkerPoseEstimator.TargetMarkerId);
                if (index >= 0 && CornersInsideImage(detected, index))
                    estimated = poseEstimator.Estimate(detected.CornersPixels, index * 8, geometry.Fx, geometry.Fy, geometry.Cx, geometry.Cy);
            }
            finally { await Awaitable.MainThreadAsync(); }
            if (destroying || generation != gate.Generation || !isActiveAndEnabled
                || Time.realtimeSinceStartupAsDouble - startedAt > 0.5) return;
            result = detected;
            observation = new ArucoPoseObservation(detected, estimated, geometry);
            requestedAt = startedAt;
            receivedAt = Time.realtimeSinceStartupAsDouble;
            ProcessedFrames++;
            RecordDetection(result);
        }
        catch (OperationCanceledException) { }
        catch (Exception exception)
        {
            if (!destroying && generation == gate.Generation) SetError(exception.Message);
        }
        finally
        {
            await Awaitable.MainThreadAsync();
            if (readbackIssued && readback.done) readbackIssued = false;
            gate.Complete(generation);
            if (destroying) DisposeResources();
        }
    }

    private void EnsureBuffers(int width, int height)
    {
        if (rgba != null && rgba.cols() == width && rgba.rows() == height) return;
        DisposeResources();
        detector = new ArucoMarkerDetector();
        rgba = new Mat(height, width, CvType.CV_8UC4);
        gray = new Mat(height, width, CvType.CV_8UC1);
        snapshot = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
        snapshot.Create();
    }

    public void ClearFeed()
    {
        if (!feedAvailable) return;
        feedAvailable = false;
        gate.Invalidate();
        result = null;
        observation = null;
        error = null;
        previousIds = null;
    }

    public void DrainReadbackBeforeCameraStops()
    {
        ClearFeed();
        // Finish the GPU copy before PCA releases its source texture. Worker buffers stay owned until completion.
        if (readbackIssued && !readback.done) readback.WaitForCompletion();
    }

    private void RecordDetection(ArucoMarkerDetectionFrame frame)
    {
        var sortedIds = (int[])frame.MarkerIds.Clone();
        Array.Sort(sortedIds);
        string ids = string.Join(",", sortedIds);
        if (ids == previousIds && receivedAt - loggedAt < 1) return;
        previousIds = ids;
        loggedAt = receivedAt;
        Record(new ArucoTrackingDiagnosticEvent
        {
            eventType = "marker_detection",
            markerDictionary = ArucoMarkerDetector.DictionaryName,
            captureTimestampSeconds = (new DateTime(frame.CaptureTimestampTicks, DateTimeKind.Utc) - DateTime.UnixEpoch).TotalSeconds,
            cameraWidth = frame.Resolution.x,
            cameraHeight = frame.Resolution.y,
            detectedMarkerCount = frame.MarkerIds.Length,
            markerIds = frame.MarkerIds,
            markerCornersPixels = frame.CornersPixels,
            detectionProcessingMilliseconds = frame.ProcessingMilliseconds,
            cameraReadbackMilliseconds = ReadbackMilliseconds
        });
    }

    private void SetError(string message)
    {
        error = message;
        result = null;
        Debug.LogError("[ArUco Detection] " + message, this);
        Record(new ArucoTrackingDiagnosticEvent { eventType = "marker_detection_error", message = message });
    }

    private void Record(ArucoTrackingDiagnosticEvent diagnosticEvent)
    {
        if (loggingFailed || diagnostics == null || diagnostics.Diagnostics == null) return;
        try { diagnostics.Diagnostics.Record(diagnosticEvent); }
        catch (Exception exception)
        {
            loggingFailed = true;
            Debug.LogError("[ArUco Detection] Diagnostic logging stopped: " + exception.Message, this);
        }
    }

    private void OnDisable() => ClearFeed();

    private void OnDestroy()
    {
        destroying = true;
        DrainReadbackBeforeCameraStops();
        gate.Invalidate();
        if (!gate.Busy) DisposeResources();
    }

    private static bool CornersInsideImage(ArucoMarkerDetectionFrame frame, int marker)
    {
        for (int i = marker * 8; i < marker * 8 + 8; i += 2)
            if (frame.CornersPixels[i] < 3 || frame.CornersPixels[i] > frame.Resolution.x - 3
                || frame.CornersPixels[i + 1] < 3 || frame.CornersPixels[i + 1] > frame.Resolution.y - 3) return false;
        return true;
    }

    private void DisposeResources()
    {
        if (snapshot != null)
        {
            snapshot.Release();
            if (Application.isPlaying) Destroy(snapshot);
            else DestroyImmediate(snapshot);
            snapshot = null;
        }
        detector?.Dispose();
        rgba?.Dispose();
        gray?.Dispose();
        detector = null;
        rgba = null;
        gray = null;
    }
}

using UnityEngine;
#if UNFRAME_OPENCV_FOR_UNITY
using System;
using System.Threading;
using Stopwatch = System.Diagnostics.Stopwatch;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.Extensions;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
#endif

[RequireComponent(typeof(ArucoTrackingDiagnosticSession))]
public sealed class ArucoCameraMarkerDetection : MonoBehaviour
{
    public static Vector2Int DetectionResolution(int width, int height) => new Vector2Int(width, height);

#if UNFRAME_OPENCV_FOR_UNITY
    private readonly ArucoDetectionFrameGate gate = new ArucoDetectionFrameGate();
    private IArucoFrameProcessor processor;
    private Mat rgba;
    private RenderTexture snapshot;
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
    private double metricsLoggedAt = double.NegativeInfinity;
    private string error;
    private string previousIds;
    public int ProcessedFrames { get; private set; }
    public double ReadbackMilliseconds { get; private set; }
    public ArucoDetectionMetrics Metrics { get; } = new ArucoDetectionMetrics();
    public ArucoDetectionPhase Phase { get; private set; }
    public bool IsProcessing => gate.Busy;

    public void ConfigureProcessor(IArucoFrameProcessor frameProcessor)
    {
        if (frameProcessor == null) throw new ArgumentNullException(nameof(frameProcessor));
        if (gate.Busy || destroying) throw new InvalidOperationException("Cannot replace a processor while detection is active or destroyed.");
        ClearFeed();
        DisposeResources();
        processor = frameProcessor;
    }

    public ArucoPoseObservation CurrentObservation => CurrentFrame == null ? null : observation;

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
                + $" | {Phase} | {Metrics.LastTimings.TotalMilliseconds:F1} ms total | drops {Metrics.TimedOut + Metrics.Invalidated + Metrics.Failed} ({Metrics.LastOutcome})"
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
        Metrics.Begin();
        DetectFrame(texture, captureTimestampTicks, generation, geometry);
    }

    private async void DetectFrame(Texture texture, long timestamp, int generation, ArucoCameraGeometry geometry)
    {
        var total = Stopwatch.StartNew();
        double startedAt = Time.realtimeSinceStartupAsDouble;
        double readbackMs = 0, copyMs = 0, preprocessingMs = 0, detectionMs = 0, poseMs = 0;
        var outcome = ArucoDetectionOutcome.Invalidated;
        try
        {
            var resolution = DetectionResolution(texture.width, texture.height);
            EnsureBuffers(resolution.x, resolution.y);
            Phase = ArucoDetectionPhase.Readback;
            var stage = Stopwatch.StartNew();
            // Keep the sampled image separate from the PCA texture, which the render thread continues updating.
            Graphics.Blit(texture, snapshot);
            readback = AsyncGPUReadback.Request(snapshot, 0, GraphicsFormat.R8G8B8A8_UNorm);
            readbackIssued = true;
            while (!readback.done) await Awaitable.NextFrameAsync(destructionToken);
            readbackMs = stage.Elapsed.TotalMilliseconds;
            ReadbackMilliseconds = readbackMs;
            if (IsInvalidated(generation)) return;
            if (readback.hasError) throw new InvalidOperationException("GPU camera readback failed. Press B/Y to retry.");
            if (total.Elapsed.TotalSeconds > 0.5)
            {
                outcome = ArucoDetectionOutcome.TimedOut;
                return;
            }
            stage.Restart();
            MatBufferUtils.CopyToMat<byte>(readback.GetData<byte>(), rgba);
            copyMs = stage.Elapsed.TotalMilliseconds;
            Phase = ArucoDetectionPhase.Processing;
            await Awaitable.BackgroundThreadAsync();
            ArucoFrameProcessingResult processed;
            try { processed = processor.Process(rgba, timestamp, geometry); }
            finally { await Awaitable.MainThreadAsync(); }
            preprocessingMs = processed.PreprocessingMilliseconds;
            detectionMs = processed.Frame.ProcessingMilliseconds;
            poseMs = processed.PoseMilliseconds;
            if (IsInvalidated(generation)) return;
            if (total.Elapsed.TotalSeconds > 0.5)
            {
                outcome = ArucoDetectionOutcome.TimedOut;
                return;
            }
            result = processed.Frame;
            observation = new ArucoPoseObservation(result, processed.Estimate, geometry);
            requestedAt = startedAt;
            receivedAt = Time.realtimeSinceStartupAsDouble;
            ProcessedFrames++;
            outcome = ArucoDetectionOutcome.Accepted;
            RecordDetection(result);
        }
        catch (OperationCanceledException) { }
        catch (Exception exception)
        {
            outcome = ArucoDetectionOutcome.Failed;
            if (!IsInvalidated(generation)) SetError(exception.Message);
        }
        finally
        {
            await Awaitable.MainThreadAsync();
            Metrics.Complete(outcome, new ArucoDetectionTimings(readbackMs, copyMs, preprocessingMs,
                detectionMs, poseMs, total.Elapsed.TotalMilliseconds));
            Phase = ArucoDetectionPhase.Idle;
            if (readbackIssued && readback.done) readbackIssued = false;
            gate.Complete(generation);
            if (destroying) DisposeResources();
            else RecordPipelineMetrics();
        }
    }

    private bool IsInvalidated(int generation) => destroying || generation != gate.Generation || !isActiveAndEnabled;

    private void EnsureBuffers(int width, int height)
    {
        processor ??= new ArucoFrameProcessor();
        if (rgba != null && rgba.cols() == width && rgba.rows() == height) return;
        DisposeBuffers();
        rgba = new Mat(height, width, CvType.CV_8UC4);
        snapshot = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
        snapshot.Create();
    }

    private void RecordPipelineMetrics()
    {
        double now = Time.realtimeSinceStartupAsDouble;
        if (now - metricsLoggedAt < 1) return;
        metricsLoggedAt = now;
        var timings = Metrics.LastTimings;
        Record(new ArucoTrackingDiagnosticEvent
        {
            eventType = "detection_pipeline_summary",
            cameraReadbackMilliseconds = timings.ReadbackMilliseconds,
            cameraCopyMilliseconds = timings.CopyMilliseconds,
            imagePreprocessingMilliseconds = timings.PreprocessingMilliseconds,
            detectionProcessingMilliseconds = timings.DetectionMilliseconds,
            poseEstimationMilliseconds = timings.PoseMilliseconds,
            detectionTotalMilliseconds = timings.TotalMilliseconds,
            detectionRequestCount = Metrics.Requests,
            detectionAcceptedCount = Metrics.Accepted,
            detectionTimeoutCount = Metrics.TimedOut,
            detectionInvalidatedCount = Metrics.Invalidated,
            detectionFailureCount = Metrics.Failed,
            detectionDropReason = Metrics.LastOutcome.ToString()
        });
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

    private void Record(ArucoTrackingDiagnosticEvent diagnosticEvent) => diagnostics?.TryRecord(diagnosticEvent);

    private void OnDisable() => ClearFeed();

    private void OnDestroy()
    {
        destroying = true;
        DrainReadbackBeforeCameraStops();
        gate.Invalidate();
        if (!gate.Busy) DisposeResources();
    }

    private void DisposeResources()
    {
        DisposeBuffers();
        processor?.Dispose();
        processor = null;
    }

    private void DisposeBuffers()
    {
        if (snapshot != null)
        {
            snapshot.Release();
            if (Application.isPlaying) Destroy(snapshot);
            else DestroyImmediate(snapshot);
            snapshot = null;
        }
        rgba?.Dispose();
        rgba = null;
    }
#else
    public int ProcessedFrames => 0;
    public double ReadbackMilliseconds => 0;
    public ArucoDetectionMetrics Metrics { get; } = new ArucoDetectionMetrics();
    public ArucoDetectionPhase Phase => ArucoDetectionPhase.Idle;
    public bool IsProcessing => false;
    public ArucoPoseObservation CurrentObservation => null;
    public ArucoMarkerDetectionFrame CurrentFrame => null;
    public string Summary => "ArUco DISABLED: install OpenCV for Unity and enable UNFRAME_OPENCV_FOR_UNITY.";

    public void SubmitFrame(Texture texture, long captureTimestampTicks, ArucoCameraGeometry geometry) { }
    public void ClearFeed() { }
    public void DrainReadbackBeforeCameraStops() { }
#endif
}

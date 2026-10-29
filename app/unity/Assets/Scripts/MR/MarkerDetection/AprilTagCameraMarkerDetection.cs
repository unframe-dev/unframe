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

[RequireComponent(typeof(AprilTagTrackingDiagnosticSession))]
public sealed class AprilTagCameraMarkerDetection : MonoBehaviour
{
    private AprilTagMarkerSize markerSize = AprilTagMarkerSize.Mm150;
    public int MarkerSizeMillimeters => (int)markerSize;

    public void SelectMarkerSize(int millimeters)
    {
        var selected = AprilTagMarkerSizes.FromMillimeters(millimeters);
        if (selected == markerSize) return;
        markerSize = selected;
#if UNFRAME_OPENCV_FOR_UNITY
        gate.Invalidate();
        result = null;
        observation = null;
#endif
    }

    public static Vector2Int DetectionResolution(int width, int height) => new Vector2Int(width, height);

#if UNFRAME_OPENCV_FOR_UNITY
    private readonly AprilTagDetectionFrameGate gate = new AprilTagDetectionFrameGate();
    private IAprilTagFrameProcessor processor;
    private int processorMarkerSizeMillimeters = 150;
    private Mat rgba;
    private RenderTexture snapshot;
    private AprilTagPoseObservation observation;
    private CancellationToken destructionToken;
    private AprilTagTrackingDiagnosticSession diagnostics;
    private AprilTagMarkerDetectionFrame result;
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
    public AprilTagDetectionMetrics Metrics { get; } = new AprilTagDetectionMetrics();
    public AprilTagDetectionPhase Phase { get; private set; }
    public bool IsProcessing => gate.Busy;

    public void ConfigureProcessor(IAprilTagFrameProcessor frameProcessor)
    {
        if (frameProcessor == null) throw new ArgumentNullException(nameof(frameProcessor));
        if (gate.Busy || destroying) throw new InvalidOperationException("Cannot replace a processor while detection is active or destroyed.");
        ClearFeed();
        DisposeResources();
        processor = frameProcessor;
        processorMarkerSizeMillimeters = MarkerSizeMillimeters;
    }

    public AprilTagPoseObservation CurrentObservation => CurrentFrame == null ? null : observation;

    public AprilTagMarkerDetectionFrame CurrentFrame => feedAvailable && result != null
        && Time.realtimeSinceStartupAsDouble - requestedAt <= 0.5 ? result : null;

    public string Summary
    {
        get
        {
            if (error != null) return "AprilTag ERROR: " + error;
            var frame = CurrentFrame;
            string ids = frame == null ? "waiting" : frame.MarkerIds.Length == 0 ? "none" : string.Join(", ", frame.MarkerIds);
            return $"AprilTag {AprilTagMarkerDetector.DictionaryName} | IDs: {ids} | {ProcessedFrames} samples"
                + $" | {Phase} | {Metrics.LastTimings.TotalMilliseconds:F1} ms total | drops {Metrics.TimedOut + Metrics.Invalidated + Metrics.Failed} ({Metrics.LastOutcome})"
                + (frame == null ? "" : $" | {frame.ProcessingMilliseconds:F1} ms detect / {ReadbackMilliseconds:F1} ms readback");
        }
    }

    private void Awake()
    {
        destructionToken = destroyCancellationToken;
        diagnostics = GetComponent<AprilTagTrackingDiagnosticSession>();
    }

    public void SubmitFrame(Texture texture, long captureTimestampTicks, AprilTagCameraGeometry geometry)
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

    private async void DetectFrame(Texture texture, long timestamp, int generation, AprilTagCameraGeometry geometry)
    {
        var total = Stopwatch.StartNew();
        double startedAt = Time.realtimeSinceStartupAsDouble;
        double readbackMs = 0, copyMs = 0, preprocessingMs = 0, detectionMs = 0, poseMs = 0;
        var outcome = AprilTagDetectionOutcome.Invalidated;
        try
        {
            var resolution = DetectionResolution(texture.width, texture.height);
            EnsureBuffers(resolution.x, resolution.y);
            Phase = AprilTagDetectionPhase.Readback;
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
                outcome = AprilTagDetectionOutcome.TimedOut;
                return;
            }
            stage.Restart();
            MatBufferUtils.CopyToMat<byte>(readback.GetData<byte>(), rgba);
            copyMs = stage.Elapsed.TotalMilliseconds;
            Phase = AprilTagDetectionPhase.Processing;
            await Awaitable.BackgroundThreadAsync();
            AprilTagFrameProcessingResult processed;
            try { processed = processor.Process(rgba, timestamp, geometry); }
            finally { await Awaitable.MainThreadAsync(); }
            preprocessingMs = processed.PreprocessingMilliseconds;
            detectionMs = processed.Frame.ProcessingMilliseconds;
            poseMs = processed.PoseMilliseconds;
            if (IsInvalidated(generation)) return;
            if (total.Elapsed.TotalSeconds > 0.5)
            {
                outcome = AprilTagDetectionOutcome.TimedOut;
                return;
            }
            result = processed.Frame;
            observation = new AprilTagPoseObservation(result, processed.Estimate, geometry);
            requestedAt = startedAt;
            receivedAt = Time.realtimeSinceStartupAsDouble;
            ProcessedFrames++;
            outcome = AprilTagDetectionOutcome.Accepted;
            RecordDetection(result);
        }
        catch (OperationCanceledException) { }
        catch (Exception exception)
        {
            outcome = AprilTagDetectionOutcome.Failed;
            if (!IsInvalidated(generation)) SetError(exception.Message);
        }
        finally
        {
            await Awaitable.MainThreadAsync();
            Metrics.Complete(outcome, new AprilTagDetectionTimings(readbackMs, copyMs, preprocessingMs,
                detectionMs, poseMs, total.Elapsed.TotalMilliseconds));
            Phase = AprilTagDetectionPhase.Idle;
            if (readbackIssued && readback.done) readbackIssued = false;
            gate.Complete(generation);
            if (destroying) DisposeResources();
            else RecordPipelineMetrics();
        }
    }

    private bool IsInvalidated(int generation) => destroying || generation != gate.Generation || !isActiveAndEnabled;

    private void EnsureBuffers(int width, int height)
    {
        if (processor != null && processorMarkerSizeMillimeters != MarkerSizeMillimeters)
        {
            processor.Dispose();
            processor = null;
        }
        processor ??= new AprilTagFrameProcessor(MarkerSizeMillimeters);
        processorMarkerSizeMillimeters = MarkerSizeMillimeters;
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
        Record(new AprilTagTrackingDiagnosticEvent
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

    private void RecordDetection(AprilTagMarkerDetectionFrame frame)
    {
        var sortedIds = (int[])frame.MarkerIds.Clone();
        Array.Sort(sortedIds);
        string ids = string.Join(",", sortedIds);
        if (ids == previousIds && receivedAt - loggedAt < 1) return;
        previousIds = ids;
        loggedAt = receivedAt;
        Record(new AprilTagTrackingDiagnosticEvent
        {
            eventType = "marker_detection",
            markerDictionary = AprilTagMarkerDetector.DictionaryName,
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
        Debug.LogError("[AprilTag Detection] " + message, this);
        Record(new AprilTagTrackingDiagnosticEvent { eventType = "marker_detection_error", message = message });
    }

    private void Record(AprilTagTrackingDiagnosticEvent diagnosticEvent) => diagnostics?.TryRecord(diagnosticEvent);

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
    public AprilTagDetectionMetrics Metrics { get; } = new AprilTagDetectionMetrics();
    public AprilTagDetectionPhase Phase => AprilTagDetectionPhase.Idle;
    public bool IsProcessing => false;
    public AprilTagPoseObservation CurrentObservation => null;
    public AprilTagMarkerDetectionFrame CurrentFrame => null;
    public string Summary => "AprilTag DISABLED: install OpenCV for Unity and enable UNFRAME_OPENCV_FOR_UNITY.";

    public void SubmitFrame(Texture texture, long captureTimestampTicks, AprilTagCameraGeometry geometry) { }
    public void ClearFeed() { }
    public void DrainReadbackBeforeCameraStops() { }
#endif
}

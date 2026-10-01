using System;
using System.Globalization;
using Stopwatch = System.Diagnostics.Stopwatch;
using System.IO;
using System.Text;
using UnityEngine;

[Serializable]
public sealed class ArucoTrackingDiagnosticEvent
{
    public int schemaVersion = 1;
    public string sessionId;
    public long sequence;
    public string eventType;
    public string timestampUtc;
    public long elapsedMilliseconds;
    public string applicationVersion;
    public string unityVersion;
    public string platform;
    public string deviceModel;
    public string operatingSystem;
    public string message;
    public double captureTimestampSeconds;
    public int cameraWidth;
    public int cameraHeight;
    public float cameraFramesPerSecond;
    public float cameraFx;
    public float cameraFy;
    public float cameraCx;
    public float cameraCy;
    public float[] cameraDistortionCoefficients = new float[0];
    public int detectedMarkerCount;
    public int[] markerIds = new int[0];
    public string markerDictionary;
    public double markerSizeMeters;
    public bool alignmentConfirmed;
    public int alignmentSampleCount;
    public float[] worldFromMarkerPositionMeters = new float[0];
    public float[] worldFromMarkerRotationXyzw = new float[0];
    public float[] worldFromCameraPositionMeters = new float[0];
    public float[] worldFromCameraRotationXyzw = new float[0];
    public float[] markerCornersPixels = new float[0];
    public double detectionProcessingMilliseconds;
    public double cameraReadbackMilliseconds;
    public bool poseValid;
    public float[] cameraFromMarkerPositionMeters = new float[0];
    public float[] cameraFromMarkerRotationXyzw = new float[0];
    public bool hasReprojectionError;
    public float reprojectionErrorPixels;
    public bool trackingAvailable;
    public float[] presentationFromQuestLocalPositionMeters = new float[0];
    public float[] presentationFromQuestLocalRotationXyzw = new float[0];
}

public sealed class ArucoTrackingDiagnostics : IDisposable
{
    private readonly object writeLock = new object();
    private readonly StreamWriter writer;
    private readonly Stopwatch elapsed = Stopwatch.StartNew();
    private long nextSequence;
    private bool disposed;

    public ArucoTrackingDiagnostics(string directoryPath)
    {
        if (string.IsNullOrWhiteSpace(directoryPath))
        {
            throw new ArgumentException("A diagnostics directory is required.", nameof(directoryPath));
        }

        Directory.CreateDirectory(directoryPath);
        SessionId = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmssfff'Z'", CultureInfo.InvariantCulture)
            + "-"
            + Guid.NewGuid().ToString("N");
        FilePath = Path.Combine(directoryPath, SessionId + ".jsonl");
        writer = new StreamWriter(FilePath, false, new UTF8Encoding(false));

        WriteRecord(new ArucoTrackingDiagnosticEvent { eventType = "session_start" });
        Debug.Log($"[ArucoTracking] Diagnostic log: {FilePath}");
    }

    public string SessionId { get; }

    public string FilePath { get; }

    public static ArucoTrackingDiagnostics CreateForCurrentDevice()
    {
        string directoryPath = Path.Combine(Application.persistentDataPath, "ArucoDiagnostics");
        return new ArucoTrackingDiagnostics(directoryPath);
    }

    public void Record(ArucoTrackingDiagnosticEvent diagnosticEvent)
    {
        if (diagnosticEvent == null)
        {
            throw new ArgumentNullException(nameof(diagnosticEvent));
        }

        if (string.IsNullOrWhiteSpace(diagnosticEvent.eventType))
        {
            throw new ArgumentException("An event type is required.", nameof(diagnosticEvent));
        }

        lock (writeLock)
        {
            ThrowIfDisposed();
            WriteRecord(diagnosticEvent);
        }
    }

    public void Dispose()
    {
        lock (writeLock)
        {
            if (disposed)
            {
                return;
            }

            WriteRecord(new ArucoTrackingDiagnosticEvent { eventType = "session_end" });
            writer.Dispose();
            disposed = true;
        }
    }

    private void WriteRecord(ArucoTrackingDiagnosticEvent diagnosticEvent)
    {
        diagnosticEvent.schemaVersion = 1;
        diagnosticEvent.sessionId = SessionId;
        diagnosticEvent.sequence = nextSequence++;
        diagnosticEvent.timestampUtc = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        diagnosticEvent.elapsedMilliseconds = elapsed.ElapsedMilliseconds;
        diagnosticEvent.applicationVersion = Application.version;
        diagnosticEvent.unityVersion = Application.unityVersion;
        diagnosticEvent.platform = Application.platform.ToString();
        diagnosticEvent.deviceModel = SystemInfo.deviceModel;
        diagnosticEvent.operatingSystem = SystemInfo.operatingSystem;

        writer.WriteLine(JsonUtility.ToJson(diagnosticEvent));
        writer.Flush();
    }

    private void ThrowIfDisposed()
    {
        if (disposed)
        {
            throw new ObjectDisposedException(nameof(ArucoTrackingDiagnostics));
        }
    }
}

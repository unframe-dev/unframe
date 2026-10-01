using System;
using UnityEngine;

public sealed class ArucoTrackingDiagnosticSession : MonoBehaviour
{
    public ArucoTrackingDiagnostics Diagnostics { get; private set; }
    public bool LoggingFailed { get; private set; }

    public void Initialize(ArucoTrackingDiagnostics diagnostics)
    {
        if (diagnostics == null) throw new ArgumentNullException(nameof(diagnostics));
        if (Diagnostics != null) throw new InvalidOperationException("A diagnostic session is already initialized.");
        Diagnostics = diagnostics;
    }

    public bool TryRecord(ArucoTrackingDiagnosticEvent diagnosticEvent)
    {
        if (LoggingFailed || Diagnostics == null) return false;
        try
        {
            Diagnostics.Record(diagnosticEvent);
            return true;
        }
        catch (Exception exception)
        {
            ReportFailure(exception);
            CloseDiagnostics();
            return false;
        }
    }

    private void Awake()
    {
        if (Diagnostics != null) return;
        try
        {
            Diagnostics = ArucoTrackingDiagnostics.CreateForCurrentDevice();
        }
        catch (Exception exception)
        {
            ReportFailure(exception);
        }
    }

    private void OnApplicationPause(bool isPaused)
    {
        TryRecord(new ArucoTrackingDiagnosticEvent
        {
            eventType = isPaused ? "application_pause" : "application_resume"
        });
    }

    private void ReportFailure(Exception exception)
    {
        if (LoggingFailed) return;
        LoggingFailed = true;
        Debug.LogError($"[ArucoTracking] Diagnostic logging stopped: {exception.Message}", this);
    }

    private void CloseDiagnostics()
    {
        try { Diagnostics?.Dispose(); }
        catch (Exception exception) { ReportFailure(exception); }
    }

    private void OnDestroy()
    {
        CloseDiagnostics();
        Diagnostics = null;
    }
}

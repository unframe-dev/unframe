using System;
using UnityEngine;

public sealed class ArucoTrackingDiagnosticSession : MonoBehaviour
{
    public ArucoTrackingDiagnostics Diagnostics { get; private set; }

    private void Awake()
    {
        try
        {
            Diagnostics = ArucoTrackingDiagnostics.CreateForCurrentDevice();
        }
        catch (Exception exception)
        {
            Debug.LogError($"[ArucoTracking] Unable to create diagnostic log: {exception.Message}", this);
        }
    }

    private void OnApplicationPause(bool isPaused)
    {
        if (Diagnostics == null)
        {
            return;
        }

        Diagnostics.Record(
            new ArucoTrackingDiagnosticEvent
            {
                eventType = isPaused ? "application_pause" : "application_resume"
            }
        );
    }

    private void OnDestroy()
    {
        Diagnostics?.Dispose();
        Diagnostics = null;
    }
}

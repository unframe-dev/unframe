using System;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class QuestPresentationSession : MonoBehaviour
{
    [SerializeField] private QuestPresentationEntry entry;
    [SerializeField] private ArucoPresentationCalibration calibrationSource;

    public void Connect(Uri controlPlaneOrigin, string sessionId,
        Func<CancellationToken, Task<string>> credentialProvider, string advanceLogicalEventName = null)
    {
        if (!isActiveAndEnabled || entry == null || calibrationSource == null
            || !calibrationSource.isActiveAndEnabled || calibrationSource.QuestTrackingOrigin == null
            || entry.QuestTrackingOrigin != calibrationSource.QuestTrackingOrigin)
            throw new InvalidOperationException("Session and marker calibration must use the same active tracking origin.");
        entry.Configure(controlPlaneOrigin, sessionId, credentialProvider,
            calibrationSource.Calibration, advanceLogicalEventName);
    }

    private void Start()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        try
        {
            string origin = ReadLaunchExtra("unframe.controlPlaneOrigin");
            string sessionId = ReadLaunchExtra("unframe.sessionId");
            if (String.IsNullOrEmpty(origin) || String.IsNullOrEmpty(sessionId)) return;
            Connect(new Uri(origin), sessionId, _ => Task.FromResult(ReadLaunchExtra("unframe.credential")),
                ReadLaunchExtra("unframe.advanceLogicalEvent"));
        }
        catch (Exception exception)
        {
            Debug.LogError("[Presentation] Quest launch configuration invalid: " + exception.GetType().Name, this);
        }
#endif
    }

#if UNITY_ANDROID && !UNITY_EDITOR
    private static string ReadLaunchExtra(string key)
    {
        using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
        using (AndroidJavaObject activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
        using (AndroidJavaObject intent = activity.Call<AndroidJavaObject>("getIntent"))
            return intent.Call<string>("getStringExtra", key);
    }
#endif
}

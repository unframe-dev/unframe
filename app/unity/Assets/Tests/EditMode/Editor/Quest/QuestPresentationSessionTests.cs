using System;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;

public sealed class QuestPresentationSessionTests
{
    [Test]
    public async Task ConnectionUsesSharedMarkerStateAndCanLoadWhileCalibrationIsPending()
    {
        var host = new GameObject("Session");
        QuestPresentationEntry entry = null;
        try
        {
            entry = host.AddComponent<QuestPresentationEntry>();
            var alignment = host.AddComponent<ArucoOriginAlignment>();
            var source = host.AddComponent<ArucoPresentationCalibration>();
            source.Configure(alignment, host.transform);
            var session = host.AddComponent<QuestPresentationSession>();
            SetReference(entry, "questTrackingOrigin", host.transform);
            SetReference(session, "entry", entry);
            SetReference(session, "calibrationSource", source);
            async Task<string> WaitForCredential(CancellationToken token)
            {
                await Task.Delay(Timeout.Infinite, token);
                return "never-used";
            }
            session.Connect(new Uri("https://api.example.com/"), "session", WaitForCredential);
            Assert.That(entry.Calibration, Is.SameAs(source.Calibration));
            Assert.That(entry.Calibration.IsValid, Is.False);
            source.Calibration.TrySet(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _);
            Assert.That(entry.GetComponent<PresentationBakedRuntime>().CalibrationReady, Is.True);
            source.Calibration.Invalidate("user-requested-remeasurement");
            Assert.That(entry.GetComponent<PresentationBakedRuntime>().CanSendInput, Is.False);
            await entry.StopAsync();
            Assert.That(entry.Calibration, Is.SameAs(source.Calibration));
        }
        finally
        {
            if (entry != null) await entry.StopAsync();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void MismatchedTrackingOriginsRejectConnectionBeforeChangingSessionState()
    {
        var host = new GameObject("Session");
        var other = new GameObject("Other tracking origin");
        try
        {
            var entry = host.AddComponent<QuestPresentationEntry>();
            var alignment = host.AddComponent<ArucoOriginAlignment>();
            var source = host.AddComponent<ArucoPresentationCalibration>();
            source.Configure(alignment, other.transform);
            var session = host.AddComponent<QuestPresentationSession>();
            SetReference(entry, "questTrackingOrigin", host.transform);
            SetReference(session, "entry", entry);
            SetReference(session, "calibrationSource", source);
            Assert.Throws<InvalidOperationException>(() => session.Connect(new Uri("https://api.example.com/"),
                "session", _ => Task.FromResult("never-used")));
            Assert.That(entry.Calibration, Is.Null);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); UnityEngine.Object.DestroyImmediate(other); }
    }

    private static void SetReference(UnityEngine.Object target, string property, UnityEngine.Object value)
    {
        var settings = new SerializedObject(target);
        settings.FindProperty(property).objectReferenceValue = value;
        settings.ApplyModifiedPropertiesWithoutUndo();
    }
}

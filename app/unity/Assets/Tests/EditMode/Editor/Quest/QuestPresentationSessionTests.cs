using System;
using System.Threading;
using System.Threading.Tasks;
using System.Linq;
using UnityEditor.SceneManagement;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;

public sealed class QuestPresentationSessionTests
{
    [Test]
    public async Task DirectConnectionReleasesOnboardingWithoutGrantingUncalibratedInput()
    {
        var host = new GameObject("External session");
        var head = new GameObject("Head", typeof(Camera));
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
            var onboarding = host.AddComponent<QuestOnboardingView>();
            onboarding.Configure(session, entry, source, head.transform, null);
            async Task<string> Wait(CancellationToken token) { await Task.Delay(Timeout.Infinite, token); return "unused"; }
            session.Connect(new Uri("https://api.example.com/"), "session", Wait);
            Assert.That(onboarding.IsComplete, Is.True);
            Assert.That(onboarding.Panel.activeSelf, Is.False);
            Assert.That(host.GetComponent<PresentationBakedRuntime>().CanSendInput, Is.False);
            await session.ExitAsync();
        }
        finally
        {
            if (entry != null) await entry.StopAsync();
            UnityEngine.Object.DestroyImmediate(host);
            UnityEngine.Object.DestroyImmediate(head);
        }
    }

    [Test]
    public void DisablingEnteredOnboardingRestoresRoleSelectionOnEnable()
    {
        var host = new GameObject("Disabled session");
        var head = new GameObject("Head", typeof(Camera));
        try
        {
            var onboarding = host.AddComponent<QuestOnboardingView>();
            onboarding.Configure(null, null, null, head.transform, null);
            typeof(QuestOnboardingView).GetProperty("IsComplete").SetValue(onboarding, true);
            typeof(QuestOnboardingView).GetMethod("OnDisable", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(onboarding, null);
            typeof(QuestOnboardingView).GetMethod("OnEnable", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(onboarding, null);
            Assert.That(onboarding.IsComplete, Is.False);
            Assert.That(onboarding.Flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
            Assert.That(onboarding.Panel.activeSelf, Is.True);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); UnityEngine.Object.DestroyImmediate(head); }
    }

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

    [Test]
    public async Task ConnectionSettingsStayInMemoryAndExitClearsThem()
    {
        var host = new GameObject("Session");
        try
        {
            var session = host.AddComponent<QuestPresentationSession>();
            session.ConfigureConnection(new Uri("https://api.example.com/"), "session", _ => Task.FromResult("private-token"));
            Assert.That(session.HasConnectionSettings, Is.True);
            Assert.That(session.ControlPlaneOrigin, Is.EqualTo("https://api.example.com/"));
            Assert.That(JsonUtility.ToJson(session), Does.Not.Contain("private-token"));
            await session.ExitAsync();
            Assert.That(session.HasConnectionSettings, Is.False);
            Assert.That(session.SessionId, Is.Empty);
            Assert.That(session.ControlPlaneOrigin, Is.Empty);
            Assert.That(session.IsBusy, Is.False);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); }
    }

    [TestCase("http://api.example.com/")]
    [TestCase("https://user:password@api.example.com/")]
    [TestCase("https://api.example.com/path")]
    public void InvalidOriginIsRejectedWithoutSavingConnection(string origin)
    {
        var host = new GameObject("Session");
        try
        {
            var session = host.AddComponent<QuestPresentationSession>();
            Assert.Throws<ArgumentException>(() => session.ConfigureConnection(new Uri(origin), "session", _ => Task.FromResult("private-token")));
            Assert.That(session.HasConnectionSettings, Is.False);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); }
    }

    [Test]
    public async Task RetryStopsOldConnectionAndUsesReplacementCredentialProvider()
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
            bool oldCancelled = false;
            int refreshed = 0;
            async Task<string> OldCredential(CancellationToken token)
            {
                try { await Task.Delay(Timeout.Infinite, token); }
                finally { oldCancelled = token.IsCancellationRequested; }
                return "unused";
            }
            async Task<string> RefreshedCredential(CancellationToken token)
            {
                refreshed++;
                await Task.Delay(Timeout.Infinite, token);
                return "unused";
            }
            session.Connect(new Uri("https://api.example.com/"), "first", OldCredential);
            session.ConfigureConnection(new Uri("https://api.example.com/"), "replacement", RefreshedCredential);
            await session.RetryAsync();
            Assert.That(oldCancelled, Is.True);
            Assert.That(refreshed, Is.EqualTo(1));
            Assert.That(session.SessionId, Is.EqualTo("replacement"));
            Assert.That(session.IsBusy, Is.False);
            await session.ExitAsync();
            Assert.That(entry.IsRunning, Is.False);
            Assert.That(session.HasConnectionSettings, Is.False);
        }
        finally
        {
            if (entry != null) await entry.StopAsync();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void ProductionSceneWiresStatusToItsSessionAndEntry()
    {
        var scene = EditorSceneManager.OpenScene(QuestPresentationSceneEditor.ScenePath, OpenSceneMode.Additive);
        try
        {
            var session = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<QuestPresentationSession>(true)).Single();
            var view = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<QuestPresentationStatusView>(true)).Single();
            var settings = new SerializedObject(view);
            Assert.That(settings.FindProperty("session").objectReferenceValue, Is.SameAs(session));
            Assert.That(settings.FindProperty("entry").objectReferenceValue, Is.SameAs(session.GetComponent<QuestPresentationEntry>()));
            Assert.That(settings.FindProperty("head").objectReferenceValue, Is.Not.Null);
        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }

    private static void SetReference(UnityEngine.Object target, string property, UnityEngine.Object value)
    {
        var settings = new SerializedObject(target);
        settings.FindProperty(property).objectReferenceValue = value;
        settings.ApplyModifiedPropertiesWithoutUndo();
    }
}

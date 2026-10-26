using System.Reflection;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;

public sealed class QuestPresentationStatusViewTests
{
    private GameObject host;
    private GameObject head;

    [TearDown]
    public void TearDown()
    {
        if (host != null) Object.DestroyImmediate(host);
        if (head != null) Object.DestroyImmediate(head);
    }

    [Test]
    public void StatusShowsSessionCalibrationAndControllerHintWithoutConfigurationDetails()
    {
        host = new GameObject("Session");
        var entry = host.AddComponent<QuestPresentationEntry>();
        var calibration = host.AddComponent<ArucoPresentationCalibration>();
        var view = host.AddComponent<QuestPresentationStatusView>();
        head = new GameObject("Head", typeof(Camera));
        view.Configure(entry, calibration, head.transform);
        view.Refresh();

        Assert.That(view.StatusText, Does.Contain("接続情報"));
        Assert.That(view.StatusText, Does.Not.Contain("Origin:"));
        Assert.That(view.StatusText, Does.Not.Contain("Session:"));
        Assert.That(host.GetComponentInChildren<Canvas>().renderMode, Is.EqualTo(RenderMode.WorldSpace));
        Assert.That(host.GetComponentInChildren<Text>().raycastTarget, Is.False);
        Assert.That(host.GetComponentInChildren<Image>().raycastTarget, Is.False);
        typeof(QuestPresentationStatusView).GetMethod("OnDestroy", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Object.DestroyImmediate(view);
        Assert.That(host.GetComponentInChildren<Canvas>(), Is.Null);
    }

    [Test]
    public void UnconnectedPanelDisablesPlaybackAndConsumesRaysOverDisabledControls()
    {
        host = new GameObject("Session");
        var entry = host.AddComponent<QuestPresentationEntry>();
        var session = host.AddComponent<QuestPresentationSession>();
        var view = host.AddComponent<QuestPresentationStatusView>();
        head = new GameObject("Head", typeof(Camera));
        view.Configure(entry, null, head.transform, session);
        Assert.That(view.FindButton("Resume").interactable, Is.False);
        Assert.That(view.FindButton("Next").interactable, Is.False);
        Assert.That(view.FindButton("Connect").interactable, Is.False);
        var target = view.FindButton("Resume").transform.position;
        Assert.That(view.TryPress(new Ray(head.transform.position, target - head.transform.position)), Is.True);
        Assert.That(entry.UiRayHandler, Is.Not.Null);
        view.enabled = false;
        Assert.That(view.TryPress(new Ray(head.transform.position, target - head.transform.position)), Is.False);
        // Ordinary MonoBehaviour callbacks are not dispatched automatically by EditMode tests.
        typeof(QuestPresentationStatusView).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Assert.That(entry.UiRayHandler, Is.Null);
        Assert.That(view.Panel.activeSelf, Is.False);
    }

    [Test]
    public void ProvidedSessionShowsOriginAndIndependentStagesWithoutCredential()
    {
        host = new GameObject("Session");
        var entry = host.AddComponent<QuestPresentationEntry>();
        var session = host.AddComponent<QuestPresentationSession>();
        session.ConfigureConnection(new System.Uri("https://api.example.com/"), "provided-session",
            _ => System.Threading.Tasks.Task.FromResult("private-credential"));
        var view = host.AddComponent<QuestPresentationStatusView>();
        head = new GameObject("Head", typeof(Camera));
        view.Configure(entry, null, head.transform, session);
        Assert.That(view.StatusText, Does.Not.Contain("https://api.example.com/"));
        Assert.That(view.StatusText, Does.Not.Contain("provided-session"));
        Assert.That(view.StatusText, Does.Contain("接続情報"));
        Assert.That(view.StatusText, Does.Not.Contain("Sync:"));
        Assert.That(view.StatusText, Does.Not.Contain("private-credential"));
        Assert.That(view.FindButton("Connect").interactable, Is.True);
    }

    [Test]
    public void ControllerAimShowsPanelIntersectionAndHidesWhenRayMisses()
    {
        host = new GameObject("Session");
        var entry = host.AddComponent<QuestPresentationEntry>();
        var view = host.AddComponent<QuestPresentationStatusView>();
        head = new GameObject("Head", typeof(Camera));
        view.Configure(entry, null, head.transform);
        Vector3 target = view.FindButton("Resume").transform.position;
        Assert.That(view.ShowAim(new Ray(head.transform.position, target - head.transform.position), true), Is.True);
        Image aim = view.Panel.transform.Find("Right controller aim").GetComponent<Image>();
        Assert.That(aim.enabled, Is.True);
        Assert.That(Vector3.Distance(aim.transform.position, target), Is.LessThan(0.0001f));
        Assert.That(view.ShowAim(new Ray(head.transform.position, Vector3.back), true), Is.False);
        Assert.That(aim.enabled, Is.False);
    }

    [Test]
    public void OnEnableFindsSessionWhenOlderSceneDoesNotSerializeIt()
    {
        host = new GameObject("Session");
        host.AddComponent<QuestPresentationEntry>();
        var session = host.AddComponent<QuestPresentationSession>();
        var view = host.AddComponent<QuestPresentationStatusView>();
        typeof(QuestPresentationStatusView).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Assert.That(typeof(QuestPresentationStatusView).GetField("session", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(view), Is.SameAs(session));
    }


    [Test]
    public void ClosingMenuDoesNotConsumePresentationRaysAndReopeningPlacesItInFrontOfHead()
    {
        host = new GameObject("Session");
        var entry = host.AddComponent<QuestPresentationEntry>();
        var view = host.AddComponent<QuestPresentationStatusView>();
        head = new GameObject("Head", typeof(Camera));
        view.Configure(entry, null, head.transform);
        Vector3 original = view.Panel.transform.position;
        head.transform.SetPositionAndRotation(new Vector3(2, 1, 3), Quaternion.Euler(25, 90, 15));
        Assert.That(view.Panel.transform.position, Is.EqualTo(original));
        view.SetMenuOpen(false);
        Assert.That(view.TryPress(new Ray(head.transform.position, original - head.transform.position)), Is.False);
        Assert.That(view.ShowAim(new Ray(Vector3.zero, Vector3.forward), true), Is.False);
        view.SetMenuOpen(true);
        Assert.That(view.Panel.transform.position.x, Is.GreaterThan(3));
        Assert.That(Mathf.Abs(Vector3.Dot(view.Panel.transform.forward, Vector3.up)), Is.LessThan(0.001f));
    }

    [Test]
    public void ProductionStatusOwnsAndHidesLegacyCameraDiagnostics()
    {
        host = new GameObject("Session");
        var preview = host.AddComponent<PassthroughCameraDevicePreview>();
        var view = host.AddComponent<QuestPresentationStatusView>();
        typeof(QuestPresentationStatusView).GetField("cameraPreview", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(view, preview);
        view.Refresh();
        Assert.That(preview.DiagnosticUiVisible, Is.False);
        Assert.That(preview.DiagnosticInputEnabled, Is.False);
        head = new GameObject("Head", typeof(Camera));
        view.Configure(null, null, head.transform);
        Assert.That(view.FindButton("CameraPermission").gameObject.activeSelf, Is.False);
        var state = (ArucoCameraSessionState)typeof(PassthroughCameraDevicePreview)
            .GetField("sessionState", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(preview);
        state.Supported = true;
        state.PermissionGranted = false;
        view.Refresh();
        Assert.That(view.FindButton("CameraPermission").gameObject.activeSelf, Is.True);
    }

    [Test]
    public void EndingPlaybackRequiresAnExplicitConfirmation()
    {
        host = new GameObject("Session");
        var view = host.AddComponent<QuestPresentationStatusView>();
        head = new GameObject("Head", typeof(Camera));
        view.Configure(null, null, head.transform);
        Assert.That(view.FindButton("ConfirmEnd").gameObject.activeSelf, Is.False);
        view.FindButton("End").onClick.Invoke();
        Assert.That(view.FindButton("ConfirmEnd").gameObject.activeSelf, Is.True);
        Assert.That(view.FindButton("End").gameObject.activeSelf, Is.False);
        view.FindButton("CancelEnd").onClick.Invoke();
        Assert.That(view.FindButton("ConfirmEnd").gameObject.activeSelf, Is.False);
    }

    [Test]
    public void RemeasurementInvalidatesCalibrationBeforeSessionIsConnected()
    {
        host = new GameObject("Session");
        var calibration = host.AddComponent<ArucoPresentationCalibration>();
        var view = host.AddComponent<QuestPresentationStatusView>();
        head = new GameObject("Head");
        view.Configure(null, calibration, head.transform);
        calibration.Calibration.TrySet(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _);
        view.Refresh();
        Assert.That(view.StatusText, Does.Contain("接続情報"));

        view.ResetCalibration();

        Assert.That(calibration.Calibration.IsValid, Is.False);
        Assert.That(calibration.Calibration.Reason, Is.EqualTo("user-requested-remeasurement"));
        Assert.That(view.StatusText, Does.Not.Contain("user-requested-remeasurement"));
    }
}

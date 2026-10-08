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

        Assert.That(view.StatusText, Does.Contain("Session not configured"));
        Assert.That(view.StatusText, Does.Contain("Calibration required"));
        Assert.That(view.StatusText, Does.Contain("B/Y: align again"));
        Assert.That(head.GetComponentInChildren<Canvas>().renderMode, Is.EqualTo(RenderMode.WorldSpace));
        Assert.That(head.GetComponentInChildren<Text>().raycastTarget, Is.False);
        Assert.That(head.GetComponentInChildren<Image>().raycastTarget, Is.False);
        typeof(QuestPresentationStatusView).GetMethod("OnDestroy", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, null);
        Object.DestroyImmediate(view);
        Assert.That(head.GetComponentInChildren<Canvas>(), Is.Null);
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
        Assert.That(view.StatusText, Does.Contain("Marker calibration confirmed"));

        view.ResetCalibration();

        Assert.That(calibration.Calibration.IsValid, Is.False);
        Assert.That(calibration.Calibration.Reason, Is.EqualTo("user-requested-remeasurement"));
        Assert.That(view.StatusText, Does.Contain("user-requested-remeasurement"));
    }
}

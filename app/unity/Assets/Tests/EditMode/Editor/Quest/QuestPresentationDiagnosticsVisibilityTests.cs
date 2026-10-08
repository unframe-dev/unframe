using System.Reflection;
using NUnit.Framework;
using UnityEngine;

public sealed class QuestPresentationDiagnosticsVisibilityTests
{
    [Test]
    public void DiagnosticControlsRemainEnabledByDefaultAndCanBeDisabled()
    {
        var host = new GameObject("Diagnostic visibility");
        try
        {
            var preview = host.AddComponent<PassthroughCameraDevicePreview>();
            var visualizer = host.GetComponent<ArucoOriginVisualizer>();
            Assert.That(preview.DiagnosticUiVisible, Is.True);
            Assert.That(preview.DiagnosticInputEnabled, Is.True);
            Assert.That(visualizer.Visible, Is.True);
            preview.DiagnosticUiVisible = false;
            preview.DiagnosticInputEnabled = false;
            visualizer.Visible = false;
            Assert.That(preview.DiagnosticUiVisible, Is.False);
            Assert.That(preview.DiagnosticInputEnabled, Is.False);
            visualizer.Show(Pose.identity);
            visualizer.ShowProvisional(Pose.identity);
            Assert.That(typeof(ArucoOriginVisualizer).GetField("origin", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(visualizer), Is.Null);
        }
        finally { DestroyHost(host); }
    }

    [Test]
    public void DisablingDiagnosticInputPreventsLegacyRemeasurement()
    {
        var host = new GameObject("Diagnostic input ownership");
        try
        {
            var preview = host.AddComponent<PassthroughCameraDevicePreview>();
            var alignment = host.GetComponent<ArucoOriginAlignment>();
            var flags = BindingFlags.Instance | BindingFlags.NonPublic;
            var stability = (ArucoOriginStability)typeof(ArucoOriginAlignment).GetField("stability", flags).GetValue(alignment);
            for (var index = 0; index < 8; index++) stability.Observe(Pose.identity, index + 1, index * 0.2);
            typeof(PassthroughCameraDevicePreview).GetField("alignment", flags).SetValue(preview, alignment);
            var session = (ArucoCameraSessionState)typeof(PassthroughCameraDevicePreview).GetField("sessionState", flags).GetValue(preview);
            session.Supported = true;
            session.PermissionGranted = true;
            preview.DiagnosticInputEnabled = false;
            typeof(PassthroughCameraDevicePreview).GetMethod("HandleRemeasurementInput", flags).Invoke(preview, new object[] { true });
            Assert.That(alignment.IsConfirmed, Is.True);
        }
        finally { DestroyHost(host); }
    }

    [Test]
    public void HidingVisualizerImmediatelyHidesExistingDiagnosticAxes()
    {
        var host = new GameObject("Diagnostic axes visibility");
        try
        {
            var visualizer = host.AddComponent<ArucoOriginVisualizer>();
            visualizer.Show(Pose.identity);
            var origin = ((Transform)typeof(ArucoOriginVisualizer).GetField("origin", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(visualizer)).gameObject;
            Assert.That(origin, Is.Not.Null);
            visualizer.Visible = false;
            Assert.That(origin.activeSelf, Is.False);
            visualizer.Show(Pose.identity);
            Assert.That(origin.activeSelf, Is.False);
        }
        finally { DestroyHost(host); }
    }

    [Test]
    public void ProgressRequiresBothStableSamplesAndDurationAndResets()
    {
        var host = new GameObject("Calibration progress");
        try
        {
            var alignment = host.AddComponent<ArucoOriginAlignment>();
            var stability = (ArucoOriginStability)typeof(ArucoOriginAlignment)
                .GetField("stability", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(alignment);
            Assert.That(alignment.CalibrationProgress, Is.Zero);
            for (var index = 0; index < 5; index++) stability.Observe(Pose.identity, index + 1, index * 0.1);
            Assert.That(alignment.CalibrationProgress, Is.EqualTo(0.4f).Within(0.0001f));
            for (var index = 5; index < 11; index++) stability.Observe(Pose.identity, index + 1, index * 0.1);
            Assert.That(alignment.CalibrationProgress, Is.EqualTo(1));
            stability.Reset();
            Assert.That(alignment.CalibrationProgress, Is.Zero);
        }
        finally { DestroyHost(host); }
    }
    private static void DestroyHost(GameObject host)
    {
        // EditMode does not dispatch lifecycle callbacks for ordinary MonoBehaviours.
        var visualizer = host.GetComponent<ArucoOriginVisualizer>();
        if (visualizer != null)
            typeof(ArucoOriginVisualizer).GetMethod("OnDestroy", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(visualizer, null);
        Object.DestroyImmediate(host);
    }

}

using System.Reflection;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.XR;

public sealed class QuestLocalPresentationControlsTests
{
    private GameObject host;
    private ArucoPresentationCalibration calibration;
    private LocalPresentationFixtureRunner runner;
    private QuestLocalPresentationControls controls;

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Local presentation");
        calibration = host.AddComponent<ArucoPresentationCalibration>();
        runner = host.AddComponent<LocalPresentationFixtureRunner>();
        controls = host.AddComponent<QuestLocalPresentationControls>();
        controls.Configure(calibration, runner);
        Assert.That(controls.ResetPresentation(out string error), Is.True, error);
    }

    [TearDown]
    public void TearDown() => Object.DestroyImmediate(host);

    private void ConfirmCalibration() => Assert.That(calibration.Calibration.TrySet(
        QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _), Is.True);

    [Test]
    public void AdvanceRequiresCalibrationAndActiveComponents()
    {
        int count = runner.AppliedEventCount;
        Assert.That(controls.TryAdvance(out _), Is.False);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(count));
        ConfirmCalibration();
        runner.enabled = false;
        Assert.That(controls.TryAdvance(out _), Is.False);
        runner.enabled = true;
        Assert.That(controls.TryAdvance(out string error), Is.True, error);
        controls.enabled = false;
        ConfirmCalibration();
        Assert.That(controls.TryAdvance(out _), Is.False);
    }

    [Test]
    public void HeldAdvanceButtonAppliesOnlyOneEventAndRemeasurementWins()
    {
        ConfirmCalibration();
        int initial = runner.AppliedEventCount;
        controls.ProcessButtons(true, false, false);
        controls.ProcessButtons(true, false, false);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(initial + 1));
        controls.ProcessButtons(false, false, false);
        controls.ProcessButtons(true, false, true);
        Assert.That(calibration.Calibration.IsValid, Is.False);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(initial + 1));
        Assert.That(controls.Summary, Does.Contain("Calibration required"));
    }

    [Test]
    public void RestartRestoresFirstEventWithoutDiscardingCalibration()
    {
        ConfirmCalibration();
        Assert.That(controls.TryAdvance(out string error), Is.True, error);
        controls.ProcessButtons(false, true, false);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(1));
        Assert.That(calibration.Calibration.IsValid, Is.True);
        Assert.That(controls.Summary, Does.Contain("Local presentation"));
        Assert.That(controls.Summary, Does.Contain("A: next"));
        Assert.That(controls.Summary, Does.Contain("X: restart"));
        Assert.That(controls.Summary, Does.Contain("B/Y: align again"));
    }

    [Test]
    public void ButtonHeldDuringMeasurementDoesNotAdvanceWhenCalibrationBecomesValid()
    {
        int initial = runner.AppliedEventCount;
        controls.ProcessButtons(true, false, false);
        ConfirmCalibration();
        controls.ProcessButtons(true, false, false);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(initial));
        controls.ProcessButtons(false, false, false);
        controls.ProcessButtons(true, false, false);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(initial + 1));
    }

    [Test]
    public void PauseAndRecenterRequireRemeasurement()
    {
        ConfirmCalibration();
        Invoke("OnApplicationPause", true);
        Assert.That(calibration.Calibration.Reason, Is.EqualTo("application-paused"));
        Assert.That(controls.TryAdvance(out _), Is.False);
        Invoke("OnApplicationPause", false);
        Assert.That(calibration.Calibration.IsValid, Is.False);
        Assert.That(controls.TryAdvance(out _), Is.False);
        ConfirmCalibration();
        Invoke("OnTrackingOriginUpdated", new object[] { null });
        Assert.That(calibration.Calibration.Reason, Is.EqualTo("tracking-origin-changed"));
    }

    [Test]
    public void HeadTrackingLossRequiresRemeasurementButHandTrackingLossDoesNot()
    {
        ConfirmCalibration();
        Invoke("OnTrackingLost", new XRNodeState { nodeType = XRNode.LeftHand });
        Assert.That(calibration.Calibration.IsValid, Is.True);
        Invoke("OnTrackingLost", new XRNodeState { nodeType = XRNode.Head });
        Assert.That(calibration.Calibration.IsValid, Is.False);
        Assert.That(calibration.Calibration.Reason, Is.EqualTo("head-tracking-lost"));
    }

    [Test]
    public void PauseBlocksAdvanceEvenIfCalibrationIsConfirmedBeforeResume()
    {
        ConfirmCalibration();
        Invoke("OnApplicationPause", true);
        ConfirmCalibration();
        Assert.That(controls.TryAdvance(out _), Is.False);
        Invoke("OnApplicationPause", false);
        Assert.That(controls.TryAdvance(out string error), Is.True, error);
    }

    private void Invoke(string name, params object[] args) => typeof(QuestLocalPresentationControls)
        .GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(controls, args);
}

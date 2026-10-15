using System.Reflection;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class ArucoPresentationCalibrationTests
{
    private GameObject host;
    private GameObject origin;
    private ArucoOriginAlignment alignment;
    private ArucoPresentationCalibration bridge;

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Calibration");
        origin = new GameObject("Quest Tracking Origin");
        origin.transform.SetPositionAndRotation(new Vector3(3, 1, -2), Quaternion.Euler(0, 40, 0));
        alignment = host.AddComponent<ArucoOriginAlignment>();
        Invoke(alignment, "Awake");
        bridge = host.AddComponent<ArucoPresentationCalibration>();
        Invoke(bridge, "OnEnable");
        bridge.Configure(alignment, origin.transform);
    }

    [TearDown]
    public void TearDown()
    {
        if (bridge != null) Invoke(bridge, "OnDestroy");
        var visualizer = host.GetComponent<ArucoOriginVisualizer>();
        if (visualizer != null) Invoke(visualizer, "OnDestroy");
        Object.DestroyImmediate(host);
        Object.DestroyImmediate(origin);
    }

    [Test]
    public void ConfirmationPublishesInverseComposedQuestCalibrationAndKeepsItWithoutNewMarkerFrames()
    {
        var marker = new Pose(new Vector3(1, 2, 3), Quaternion.Euler(0, 25, 0));
        Confirm(marker);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.True);
        Assert.That(PresentationCalibrationMath.TryWorldFromPresentation(
            bridge.Calibration.PresentationFromQuestLocal, origin.transform, out Pose restored, out string error), Is.True, error);
        Assert.That(Vector3.Distance(restored.position, marker.position), Is.LessThan(0.00001));
        Assert.That(Quaternion.Angle(restored.rotation, marker.rotation), Is.LessThan(0.01));
        ulong revision = bridge.Calibration.Revision;
        bridge.Refresh();
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.True);
        Assert.That(bridge.Calibration.Revision, Is.EqualTo(revision));
    }

    [Test]
    public void ResetImmediatelyInvalidatesThenReconfirmationPublishesTheNewPose()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        alignment.ResetAlignment("Remeasure");
        Assert.That(bridge.Calibration.IsValid, Is.False);
        bridge.Refresh();
        Confirm(new Pose(new Vector3(4, 5, 6), Quaternion.identity));
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.True);
        Assert.That(PresentationCalibrationMath.TryWorldFromPresentation(
            bridge.Calibration.PresentationFromQuestLocal, origin.transform, out Pose restored, out _), Is.True);
        Assert.That(Vector3.Distance(restored.position, new Vector3(4, 5, 6)), Is.LessThan(0.00001));
    }

    [Test]
    public void SilentResetAndDisabledSourceImmediatelyInvalidateThePublishedState()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        alignment.ResetAlignment("Reset without restarting camera", false);
        Assert.That(bridge.Calibration.IsValid, Is.False);
        Confirm(Pose.identity);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.True);
        alignment.enabled = false;
        Invoke(alignment, "OnDisable");
        Assert.That(bridge.Calibration.IsValid, Is.False);
        alignment.enabled = true;
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
    }

    [Test]
    public void ExternalInvalidationResetsConfirmedMarkerAndRequiresASecondMeasurement()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        int changes = 0;
        bridge.Calibration.Changed += () => changes++;
        bridge.Calibration.Invalidate("xr-recentered");
        Assert.That(alignment.IsConfirmed, Is.False);
        bridge.Refresh();
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
        Assert.That(bridge.Calibration.Reason, Is.EqualTo("xr-recentered"));
        Assert.That(changes, Is.EqualTo(1), "The source reset must not recursively republish or invalidate the shared state.");
        Confirm(Pose.identity);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.True);
        Assert.That(changes, Is.EqualTo(2));
    }

    [Test]
    public void TrackingRecoveryDoesNotRestoreAnOldCalibration()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        Invoke(alignment, "OnTrackingLost");
        Assert.That(bridge.Calibration.IsValid, Is.False);
        Invoke(alignment, "OnTrackingAcquired");
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
        Confirm(Pose.identity);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.True);
    }

    [Test]
    public void ChangedTrackingFrameRequestsRemeasurementRatherThanReusingWorldCalibration()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        origin.transform.position += Vector3.right;
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
        Assert.That(alignment.IsConfirmed, Is.False);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
    }

    [Test]
    public void NonUnitTrackingScaleRejectsConfirmation()
    {
        origin.transform.localScale = new Vector3(1, 2, 1);
        Confirm(Pose.identity);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
        Assert.That(alignment.IsConfirmed, Is.False);
    }

    [Test]
    public void DisabledBridgeRequiresNewConfirmationAfterItIsEnabled()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        bridge.enabled = false;
        Invoke(bridge, "OnDisable");
        Assert.That(bridge.Calibration.IsValid, Is.False);
        bridge.enabled = true;
        Invoke(bridge, "OnEnable");
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
    }

    [Test]
    public void InactiveTrackingOriginInvalidatesCalibration()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        origin.SetActive(false);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
        origin.SetActive(true);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
    }

    [Test]
    public void DestroyedSourceInvalidatesCalibration()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        Object.DestroyImmediate(alignment);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.False);
    }

    [Test]
    public void DestroyedBridgeInvalidatesTheStateHeldByTheSession()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        PresentationCalibrationState state = bridge.Calibration;
        Invoke(bridge, "OnDestroy");
        Object.DestroyImmediate(bridge);
        Assert.That(state.IsValid, Is.False);
    }

    private void Confirm(Pose pose)
    {
        for (int i = 0; i < 8; i++)
        {
            var frame = new ArucoMarkerDetectionFrame(i + 1, new Vector2Int(640, 480), new[] { 0 }, new float[8], 1);
            var estimate = new ArucoMarkerPoseEstimate(true, null, pose, 0.1, 1, 2);
            alignment.Observe(new ArucoPoseObservation(frame, estimate,
                new ArucoCameraGeometry(450, 450, 320, 240, Pose.identity)), i * 0.2);
        }
        Assert.That(alignment.IsConfirmed, Is.True);
    }

    private static void Invoke(MonoBehaviour component, string method) => component.GetType()
        .GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(component, null);
}

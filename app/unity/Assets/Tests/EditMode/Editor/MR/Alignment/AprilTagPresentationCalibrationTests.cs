using System.Reflection;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using ProtoVector3 = Unframe.Presentation.Vector3;

public sealed class AprilTagPresentationCalibrationTests
{
    private GameObject host;
    private GameObject origin;
    private AprilTagOriginAlignment alignment;
    private AprilTagPresentationCalibration bridge;

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Calibration");
        origin = new GameObject("Quest Tracking Origin");
        origin.transform.SetPositionAndRotation(new Vector3(3, 1, -2), Quaternion.Euler(0, 40, 0));
        alignment = host.AddComponent<AprilTagOriginAlignment>();
        Invoke(alignment, "Awake");
        bridge = host.AddComponent<AprilTagPresentationCalibration>();
        Invoke(bridge, "OnEnable");
        bridge.Configure(alignment, origin.transform);
    }

    [TearDown]
    public void TearDown()
    {
        if (bridge != null) Invoke(bridge, "OnDestroy");
        var visualizer = host.GetComponent<AprilTagOriginVisualizer>();
        if (visualizer != null) Invoke(visualizer, "OnDestroy");
        Object.DestroyImmediate(host);
        Object.DestroyImmediate(origin);
    }

    [Test]
    public void PlacementCapturesHeadHeightAndPreservesPhysicalMarkerOrientation()
    {
        var head = new GameObject("HMD");
        try
        {
            head.transform.SetPositionAndRotation(new Vector3(2, 1.8f, 3), Quaternion.Euler(20, 45, 10));
            bridge.ConfigureHead(head.transform);
            var marker = new Pose(new Vector3(1, 0.6f, 3), Quaternion.Euler(20, 40, 10));
            Confirm(marker);
            bridge.Refresh();
            Assert.That(PresentationCalibrationMath.TryWorldFromPresentation(bridge.Calibration.PresentationFromQuestLocal,
                origin.transform, out Pose physicalMarker, out _), Is.True);
            Assert.That(Vector3.Distance(physicalMarker.position, marker.position), Is.LessThan(0.00001f));
            Assert.That(Quaternion.Angle(physicalMarker.rotation, marker.rotation), Is.LessThan(0.02f));
            head.transform.SetPositionAndRotation(Vector3.up * 2.4f, Quaternion.Euler(0, 100, 0));
            bridge.BeginSession("first");
            var initial = new Unframe.Realtime.PresentationOrigin { Pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity) };
            var command = bridge.Placement.Prepare(initial, 3, new ProtoVector3());
            Assert.That(PresentationCoordinateAdapter.TryToUnityPose(command.PresentationOrigin.Pose, out Pose stage), Is.True);
            Assert.That((marker.position + marker.rotation * stage.position).y, Is.EqualTo(1.5f).Within(0.00001f));
            Assert.That(Quaternion.Angle(marker.rotation * stage.rotation, marker.rotation), Is.LessThan(0.02f));
            bridge.BeginSession("second");
            Assert.That(bridge.Calibration.IsValid, Is.False);
            Assert.That(alignment.IsConfirmed, Is.False);
            Assert.That(bridge.Placement.Prepare(initial, 3, new ProtoVector3()), Is.Null);
            Confirm(marker);
            bridge.Refresh();
            command = bridge.Placement.Prepare(initial, 3, new ProtoVector3());
            Assert.That(PresentationCoordinateAdapter.TryToUnityPose(command.PresentationOrigin.Pose, out stage), Is.True);
            Assert.That((marker.position + marker.rotation * stage.position).y, Is.EqualTo(2.1f).Within(0.00001f));
            Assert.That(Quaternion.Angle(marker.rotation * stage.rotation, marker.rotation), Is.LessThan(0.02f));
        }
        finally { Object.DestroyImmediate(head); }
    }

    [TestCase("tracking-frame")]
    [TestCase("source-reset")]
    [TestCase("disable")]
    [TestCase("external-invalidation")]
    public void RemeasurementBeforePlacementUsesTheNewMarkerAndHeadSample(string invalidation)
    {
        var head = new GameObject("HMD");
        try
        {
            head.transform.position = Vector3.up * 1.8f;
            bridge.ConfigureHead(head.transform);
            bridge.BeginSession("session");
            Confirm(Pose.identity);
            bridge.Refresh();
            var initial = new Unframe.Realtime.PresentationOrigin { Pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity) };
            var old = bridge.Placement.Prepare(initial, 3, new ProtoVector3());
            Assert.That(old, Is.Not.Null);
            if (invalidation == "tracking-frame") { origin.transform.position += Vector3.right; bridge.Refresh(); }
            if (invalidation == "source-reset") alignment.ResetAlignment("reset");
            if (invalidation == "disable") { bridge.enabled = false; Invoke(bridge, "OnDisable"); bridge.enabled = true; Invoke(bridge, "OnEnable"); }
            if (invalidation == "external-invalidation") bridge.Calibration.Invalidate("recentered");
            Assert.That(bridge.Placement.Prepare(initial, 3, new ProtoVector3()), Is.Null, "Invalidated coordinates cannot retain a pending placement command.");
            initial.Version = 1;
            head.transform.position = Vector3.up * 2.4f;
            var marker = new Pose(new Vector3(2, 0.6f, -1), Quaternion.Euler(20, 40, 10));
            Confirm(marker);
            bridge.Refresh();
            var command = bridge.Placement.Prepare(initial, 3, new ProtoVector3());
            Assert.That(command.PresentationOrigin.ClientEventId, Is.Not.EqualTo(old.PresentationOrigin.ClientEventId));
            Assert.That(PresentationCoordinateAdapter.TryToUnityPose(command.PresentationOrigin.Pose, out Pose stage), Is.True);
            Assert.That((marker.position + marker.rotation * stage.position).y, Is.EqualTo(2.1f).Within(0.00001f));
        }
        finally { Object.DestroyImmediate(head); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void PlacementRequiresFreshMarkerMeasurementIfHeadIsUnavailableAtConfirmation(bool headConfigured)
    {
        var head = new GameObject("HMD");
        try
        {
            head.SetActive(false);
            bridge.ConfigureHead(headConfigured ? head.transform : null);
            Confirm(Pose.identity);
            bridge.Refresh();
            Assert.That(alignment.IsConfirmed, Is.False);
            Assert.That(bridge.Calibration.IsValid, Is.False);

            head.transform.position = Vector3.up * 2.4f;
            head.SetActive(true);
            bridge.ConfigureHead(head.transform);
            var initial = new Unframe.Realtime.PresentationOrigin { Pose = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity) };
            Assert.That(bridge.Placement.Prepare(initial, 3, null), Is.Null);

            Confirm(Pose.identity);
            bridge.Refresh();
            var command = bridge.Placement.Prepare(initial, 3, null);
            Assert.That(command, Is.Not.Null);
            Assert.That(command.PresentationOrigin.Pose.Position.Y, Is.EqualTo(2.1f).Within(0.00001f));
        }
        finally { Object.DestroyImmediate(head); }
    }

    [Test]
    public void EnablingPlacementRequiresFreshMeasurementAfterMarkerOnlyCalibration()
    {
        Confirm(Pose.identity);
        bridge.Refresh();
        Assert.That(bridge.Calibration.IsValid, Is.True);

        var head = new GameObject("HMD");
        try
        {
            bridge.ConfigureHead(head.transform);
            Assert.That(alignment.IsConfirmed, Is.False);
            Assert.That(bridge.Calibration.IsValid, Is.False);
        }
        finally { Object.DestroyImmediate(head); }
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
            var frame = new AprilTagMarkerDetectionFrame(i + 1, new Vector2Int(640, 480), new[] { 0 }, new float[8], 1);
            var estimate = new AprilTagMarkerPoseEstimate(true, null, pose, 0.1, 1, 2);
            alignment.Observe(new AprilTagPoseObservation(frame, estimate,
                new AprilTagCameraGeometry(450, 450, 320, 240, Pose.identity)), i * 0.2);
        }
        Assert.That(alignment.IsConfirmed, Is.True);
    }

    private static void Invoke(MonoBehaviour component, string method) => component.GetType()
        .GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(component, null);
}

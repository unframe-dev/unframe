using System.Reflection;
using NUnit.Framework;
using UnityEngine;

public sealed class ArucoOriginMeasurementPreviewTests
{
    private GameObject host;
    private ArucoOriginAlignment alignment;
    private ArucoOriginVisualizer visualizer;
    private long timestamp;

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Measurement Preview Test");
        alignment = host.AddComponent<ArucoOriginAlignment>();
        visualizer = host.GetComponent<ArucoOriginVisualizer>();
        Invoke(alignment, "Awake");
        timestamp = 0;
    }

    [TearDown]
    public void TearDown()
    {
        Invoke(alignment, "OnDisable");
        Invoke(alignment, "OnDestroy");
        Invoke(visualizer, "OnDestroy");
        Object.DestroyImmediate(host);
    }

    [Test]
    public void NearbyCopyPreservesMeasurementMotionWhileFollowingTheHeadAndResettingItsReference()
    {
        var head = new GameObject("Preview Head").transform;
        try
        {
            head.SetPositionAndRotation(new Vector3(1, 2, 0), Quaternion.Euler(0, 15, 0));
            visualizer.SetPreviewHead(head);
            var first = new Pose(new Vector3(0, 0, 3), Quaternion.identity);
            Observe(first, 0);
            var nearby = (Transform)typeof(ArucoOriginVisualizer)
                .GetField("nearbyOrigin", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(visualizer);
            var offset = new Vector3(0.35f, -0.2f, 0.65f);
            Assert.That(nearby.gameObject.activeSelf, Is.True);
            AssertPose(new Pose(nearby.position, nearby.rotation),
                new Pose(head.TransformPoint(offset), first.rotation));
            AssertPose(new Pose(Origin.position, Origin.rotation), first);

            var next = new Pose(first.position + Vector3.right * 0.01f, Quaternion.Euler(0, 30, 0));
            Observe(next, 0.1);
            AssertPose(new Pose(nearby.position, nearby.rotation),
                new Pose(head.TransformPoint(offset) + Vector3.right * 0.01f, next.rotation));
            AssertPose(new Pose(Origin.position, Origin.rotation), next);

            head.position += Vector3.right;
            Invoke(visualizer, "LateUpdate");
            AssertPose(new Pose(nearby.position, nearby.rotation),
                new Pose(head.TransformPoint(offset) + Vector3.right * 0.01f, next.rotation));
            AssertPose(new Pose(Origin.position, Origin.rotation), next);

            alignment.Observe(null, 0.2);
            Assert.That(nearby.gameObject.activeSelf, Is.False);
            Assert.That(Origin.gameObject.activeSelf, Is.False);
            alignment.ResetAlignment("Test reset");
            var restarted = new Pose(new Vector3(4, 1, 5), Quaternion.Euler(10, 20, 30));
            Observe(restarted, 0.3);
            AssertPose(new Pose(nearby.position, nearby.rotation),
                new Pose(head.TransformPoint(offset), restarted.rotation));

            for (int i = 1; i < 8; i++) Observe(restarted, 0.3 + i * 0.2);
            Assert.That(alignment.IsConfirmed, Is.True);
            Assert.That(nearby.gameObject.activeSelf, Is.False);
            Assert.That(Origin.gameObject.activeSelf, Is.True);
            AssertPose(new Pose(Origin.position, Origin.rotation), restarted);
        }
        finally
        {
            Object.DestroyImmediate(head.gameObject);
        }
    }

    [Test]
    public void ValidMeasurementsUpdateTheProvisionalWorldPoseAndStableAverage()
    {
        var camera = new Pose(new Vector3(2, 3, 4), Quaternion.Euler(0, 90, 0));
        var first = new Pose(new Vector3(0, 0, 1), Quaternion.Euler(5, 10, 15));
        var second = new Pose(new Vector3(0.01f, 0, 1), Quaternion.Euler(5, 11, 15));
        Observe(first, 0, camera);
        Observe(second, 0.2, camera);

        var geometry = Geometry(camera);
        Pose expectedLatest = geometry.ToWorld(second);
        Pose expectedFirst = geometry.ToWorld(first);
        Assert.That(alignment.MeasurementPreviewEnabled, Is.True);
        Assert.That(alignment.IsConfirmed, Is.False);
        Assert.That(alignment.HasMeasurementPose, Is.True);
        Assert.That(alignment.HasAverageMeasurementPose, Is.True);
        AssertPose(alignment.LatestMeasurementPose, expectedLatest);
        Assert.That(Vector3.Distance(alignment.AverageMeasurementPose.position,
            (expectedFirst.position + expectedLatest.position) * 0.5f), Is.LessThan(0.0001f));
        Assert.That(Quaternion.Angle(alignment.AverageMeasurementPose.rotation,
            Quaternion.Slerp(expectedFirst.rotation, expectedLatest.rotation, 0.5f)), Is.LessThan(0.01f));
        AssertPose(new Pose(Origin.position, Origin.rotation), expectedLatest);
        Assert.That(Origin.gameObject.activeSelf, Is.True);
        AssertCubeColor(Color.cyan);
        StringAssert.Contains("latest", alignment.MeasurementSummary.ToLowerInvariant());
        StringAssert.Contains("average", alignment.MeasurementSummary.ToLowerInvariant());
    }

    [TestCase(false)]
    [TestCase(true)]
    public void MissingOrCandidateLessObservationsImmediatelyHideTheProvisionalPose(bool missing)
    {
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0);
        if (missing) alignment.Observe(null, 0.1);
        else Observe(Pose.identity, 0.1, valid: false, hasCandidate: false);

        Assert.That(Origin.gameObject.activeSelf, Is.False);
        Assert.That(alignment.HasMeasurementPose, Is.False);
        Assert.That(alignment.HasAverageMeasurementPose, Is.False);
        StringAssert.Contains("unavailable", alignment.MeasurementSummary.ToLowerInvariant());
        Assert.That(alignment.IsConfirmed, Is.False);
    }

    [TestCase("ambiguous pose")]
    [TestCase("excessive reprojection error")]
    public void RejectedCandidatesUpdateThePreviewWithoutBecomingAnAlignment(string rejection)
    {
        var camera = new Pose(new Vector3(2, 3, 4), Quaternion.Euler(0, 90, 0));
        for (int i = 0; i < 12; i++)
        {
            var candidate = new Pose(new Vector3(0.01f * i, 0, 2), Quaternion.Euler(10, i, 5));
            Observe(candidate, i * 0.2, camera, valid: false, rejection: rejection);
            var expected = Geometry(camera).ToWorld(candidate);
            Assert.That(alignment.HasMeasurementPose, Is.True);
            Assert.That(alignment.HasAverageMeasurementPose, Is.False);
            Assert.That(alignment.IsConfirmed, Is.False);
            AssertPose(alignment.LatestMeasurementPose, expected);
            AssertPose(new Pose(Origin.position, Origin.rotation), expected);
            Assert.That(Origin.gameObject.activeSelf, Is.True);
            AssertCubeColor(Color.cyan);
            StringAssert.Contains("Latest", alignment.MeasurementSummary);
            StringAssert.Contains(rejection, alignment.MeasurementSummary);
            StringAssert.Contains("Average unavailable", alignment.MeasurementSummary);
            StringAssert.Contains("0/8 samples", alignment.Summary);
        }
    }

    [Test]
    public void RejectedCandidateCannotContaminateTheExistingStableAverage()
    {
        var first = new Pose(Vector3.forward, Quaternion.Euler(5, 10, 15));
        var second = new Pose(new Vector3(0.01f, 0, 1), Quaternion.Euler(5, 11, 15));
        Observe(first, 0);
        Observe(second, 0.1);
        var previousAverage = alignment.AverageMeasurementPose;
        var rejected = new Pose(new Vector3(10, 20, 30), Quaternion.Euler(90, 90, 90));
        Observe(rejected, 0.2, valid: false);
        Assert.That(alignment.HasMeasurementPose, Is.True);
        Assert.That(alignment.HasAverageMeasurementPose, Is.False);
        AssertPose(alignment.LatestMeasurementPose, rejected);
        AssertPose(alignment.OriginPose, previousAverage);
        StringAssert.Contains("2/8 samples", alignment.Summary);
        Observe(first, 0.3);
        Assert.That(alignment.HasAverageMeasurementPose, Is.True);
        Assert.That(Vector3.Distance(alignment.AverageMeasurementPose.position,
            (first.position * 2 + second.position) / 3), Is.LessThan(0.0001f));
        StringAssert.Contains("3/8 samples", alignment.Summary);
        Assert.That(alignment.IsConfirmed, Is.False);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void InvalidPoseCandidateIsHiddenRegardlessOfQualityStatus(bool valid)
    {
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0);
        Observe(new Pose(Vector3.forward, new Quaternion(0, 0, 0, 0)), 0.1, valid: valid);
        Assert.That(alignment.HasMeasurementPose, Is.False);
        Assert.That(Origin.gameObject.activeSelf, Is.False);
        Observe(new Pose(new Vector3(float.PositiveInfinity, 0, 1), Quaternion.identity), 0.2, valid: valid);
        Assert.That(alignment.HasMeasurementPose, Is.False);
        Assert.That(Origin.gameObject.activeSelf, Is.False);
    }

    [Test]
    public void RejectedCandidateNeedsAFiniteCameraWorldPoseForSpatialDisplay()
    {
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0);
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0.1,
            new Pose(new Vector3(float.NaN, 0, 0), Quaternion.identity), valid: false);
        Assert.That(alignment.HasMeasurementPose, Is.False);
        Assert.That(Origin.gameObject.activeSelf, Is.False);
    }

    [Test]
    public void PreviewToggleHidesAndRestoresTheLatestValidMeasurement()
    {
        var expected = new Pose(new Vector3(1, 2, 3), Quaternion.Euler(10, 20, 30));
        Observe(expected, 0);
        alignment.MeasurementPreviewEnabled = false;
        Assert.That(Origin.gameObject.activeSelf, Is.False);
        Assert.That(alignment.HasMeasurementPose, Is.True);
        alignment.MeasurementPreviewEnabled = true;
        Assert.That(Origin.gameObject.activeSelf, Is.True);
        AssertPose(new Pose(Origin.position, Origin.rotation), expected);
        AssertCubeColor(Color.cyan);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void ConfirmationFixesTheYellowOriginRegardlessOfPreviewToggle(bool enabled)
    {
        alignment.MeasurementPreviewEnabled = enabled;
        var expected = new Pose(new Vector3(1, 2, 3), Quaternion.Euler(10, 20, 30));
        for (int i = 0; i < 8; i++) Observe(expected, i * 0.2);

        Assert.That(alignment.IsConfirmed, Is.True);
        Assert.That(Origin.gameObject.activeSelf, Is.True);
        AssertPose(new Pose(Origin.position, Origin.rotation), expected);
        AssertCubeColor(Color.yellow);
        Observe(new Pose(Vector3.one * 100, Quaternion.identity), 2);
        alignment.Observe(null, 2.1);
        alignment.MeasurementPreviewEnabled = !enabled;
        Assert.That(Origin.gameObject.activeSelf, Is.True);
        AssertPose(new Pose(Origin.position, Origin.rotation), expected);
        AssertPose(alignment.OriginPose, expected);
        AssertCubeColor(Color.yellow);
    }

    [Test]
    public void ResetClearsMeasurementDataAndDoesNotRestoreAStalePreview()
    {
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0);
        alignment.ResetAlignment("Test reset");
        alignment.MeasurementPreviewEnabled = false;
        alignment.MeasurementPreviewEnabled = true;

        Assert.That(Origin.gameObject.activeSelf, Is.False);
        Assert.That(alignment.HasMeasurementPose, Is.False);
        Assert.That(alignment.HasAverageMeasurementPose, Is.False);
        StringAssert.Contains("unavailable", alignment.MeasurementSummary.ToLowerInvariant());
    }

    [Test]
    public void RepeatedFramesDoNotKeepAStaleMeasurementVisible()
    {
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0);
        timestamp--;
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0.4);
        typeof(ArucoOriginAlignment).GetMethod("ExpireMeasurementPreview", BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(alignment, new object[] { 0.51 });
        Assert.That(alignment.HasMeasurementPose, Is.False);
        Assert.That(Origin.gameObject.activeSelf, Is.False);
        alignment.MeasurementPreviewEnabled = false;
        alignment.MeasurementPreviewEnabled = true;
        Assert.That(Origin.gameObject.activeSelf, Is.False);
    }

    [Test]
    public void NonFiniteMeasurementIsNotRenderedEvenWhenEstimateClaimsValidity()
    {
        Observe(new Pose(Vector3.forward, Quaternion.identity), 0);
        Observe(new Pose(new Vector3(float.NaN, 0, 1), Quaternion.identity), 0.2);
        Assert.That(alignment.HasMeasurementPose, Is.False);
        Assert.That(Origin.gameObject.activeSelf, Is.False);
    }

    private Transform Origin => (Transform)typeof(ArucoOriginVisualizer)
        .GetField("origin", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(visualizer);

    private void Observe(Pose pose, double now, Pose? camera = null, bool valid = true,
        bool hasCandidate = true, string rejection = "ambiguous pose")
    {
        var frame = new ArucoMarkerDetectionFrame(++timestamp, new Vector2Int(1280, 960),
            new[] { 0 }, new float[8], 1);
        var estimate = new ArucoMarkerPoseEstimate(valid, valid ? null : rejection, pose,
            hasCandidate ? 0.1 : double.NaN, 1, hasCandidate ? 2 : 0);
        alignment.Observe(new ArucoPoseObservation(frame, estimate, Geometry(camera ?? Pose.identity)), now);
    }

    private static ArucoCameraGeometry Geometry(Pose camera) => new ArucoCameraGeometry(960, 960, 640, 480, camera);

    private void AssertCubeColor(Color expected)
    {
        var material = Origin.Find("Origin Cube").GetComponent<MeshRenderer>().sharedMaterial;
        Color actual = material.HasProperty("_BaseColor") ? material.GetColor("_BaseColor") : material.GetColor("_Color");
        Assert.That(actual.r, Is.EqualTo(expected.r).Within(0.001f));
        Assert.That(actual.g, Is.EqualTo(expected.g).Within(0.001f));
        Assert.That(actual.b, Is.EqualTo(expected.b).Within(0.001f));
    }

    private static void AssertPose(Pose actual, Pose expected)
    {
        Assert.That(Vector3.Distance(actual.position, expected.position), Is.LessThan(0.0001f));
        Assert.That(Quaternion.Angle(actual.rotation, expected.rotation), Is.LessThan(0.01f));
    }

    private static void Invoke(MonoBehaviour component, string method) => component.GetType()
        .GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(component, null);
}

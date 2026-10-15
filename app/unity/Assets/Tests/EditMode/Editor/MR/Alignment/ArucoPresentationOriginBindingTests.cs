using System.Reflection;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class ArucoPresentationOriginBindingTests
{
    private GameObject host;
    private GameObject space;
    private Transform stage;
    private ArucoOriginAlignment alignment;
    private ArucoPresentationCalibration calibration;
    private LocalPresentationFixtureRunner runner;
    private ArucoPresentationOriginBinding binding;

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Marker Presentation Test");
        space = new GameObject("Presentation Space");
        stage = new GameObject("Stage").transform;
        stage.SetParent(space.transform, false);
        alignment = host.AddComponent<ArucoOriginAlignment>();
        Invoke(alignment, "Awake");
        calibration = host.AddComponent<ArucoPresentationCalibration>();
        calibration.Configure(alignment, host.transform);
        runner = host.AddComponent<LocalPresentationFixtureRunner>();
        runner.SetHierarchyRoot(stage);
        binding = host.AddComponent<ArucoPresentationOriginBinding>();
        binding.Configure(calibration, runner, space.transform, stage);
    }

    [TearDown]
    public void TearDown()
    {
        Invoke(runner, "OnDestroy");
        Invoke(host.GetComponent<ArucoOriginVisualizer>(), "OnDestroy");
        Object.DestroyImmediate(host);
        Object.DestroyImmediate(space);
    }

    [Test]
    public void LoadingAndAdvancingBeforeAlignmentNeverShowsPresentation()
    {
        binding.Refresh();
        Assert.That(space.activeSelf, Is.False);
        Assert.That(runner.TryLoad(out string error), Is.True, error);
        Assert.That(runner.TryAdvance(out error), Is.True, error);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.False);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(1));
        Assert.That(runner.HasLoadedFixture, Is.True);
    }

    [Test]
    public void CalibrationAndRuntimeOriginComposeWithoutChangingNodeLocalState()
    {
        var marker = new Pose(new Vector3(1, 2, 3), Quaternion.Euler(0, 30, 0));
        Confirm(marker);
        Assert.That(runner.TryLoad(out string error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(
            Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text,
            out ControlServerItem item, out error), Is.True, error);
        item.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin
        {
            Version = 2,
            Pose = new Unframe.Presentation.Pose
            {
                Position = new Unframe.Presentation.Vector3 { X = 0.4, Y = 0.5, Z = -0.6 },
                Rotation = new Unframe.Presentation.Quaternion { Y = 0.6, W = 0.8 }
            }
        };
        item.ConnectionSnapshot.Fence.PresentationOriginVersion = 2;
        Assert.That(runner.Store.TryReceiveControl(item, out error), Is.True, error);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.True);
        Assert.That(Vector3.Distance(space.transform.position, marker.position), Is.LessThan(0.00001));
        Assert.That(Quaternion.Angle(space.transform.rotation, marker.rotation), Is.LessThan(0.01));
        var originPosition = new Vector3(0.4f, 0.5f, 0.6f);
        var originRotation = new Quaternion(0, -0.6f, 0, 0.8f);
        Assert.That(stage.localPosition, Is.EqualTo(Vector3.zero));
        Assert.That(stage.localRotation, Is.EqualTo(Quaternion.identity));
        Assert.That(runner.Hierarchy.Registry.TryGet("node:local-stage", out GameObject node), Is.True);
        Transform generatedRoot = node.transform.parent;
        Assert.That(generatedRoot.parent, Is.EqualTo(stage));
        Assert.That(Vector3.Distance(generatedRoot.localPosition, originPosition), Is.LessThan(0.00001));
        Assert.That(Quaternion.Angle(generatedRoot.localRotation, originRotation), Is.LessThan(0.01));
        Assert.That(Vector3.Distance(node.transform.position,
            marker.position + marker.rotation * (originPosition + originRotation * node.transform.localPosition)), Is.LessThan(0.00001));
        Assert.That(runner.Store.PresentationOrigin.Version, Is.EqualTo(2));
        Assert.That(stage.localScale, Is.EqualTo(Vector3.one));
    }

    [Test]
    public void NonIdentitySnapshotLoadedBeforeAlignmentAppliesRuntimeOriginExactlyOnce()
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(
            Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text,
            out ControlServerItem item, out string error), Is.True, error);
        var runtimePosition = new Vector3(0.4f, 0.5f, 0.6f);
        var runtimeRotation = new Quaternion(0, -0.6f, 0, 0.8f);
        item.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin
        {
            Version = 2,
            Pose = new Unframe.Presentation.Pose
            {
                Position = new Unframe.Presentation.Vector3 { X = 0.4, Y = 0.5, Z = -0.6 },
                Rotation = new Unframe.Presentation.Quaternion { Y = 0.6, W = 0.8 }
            }
        };
        item.ConnectionSnapshot.Fence.PresentationOriginVersion = 2;
        var nodePosition = new Vector3(0.7f, 0.8f, 0.9f);
        var nodeRotation = new Quaternion(0.6f, 0, 0, 0.8f);
        var nodeState = item.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates[0];
        Assert.That(nodeState.NodeId, Is.EqualTo("node:local-stage"));
        nodeState.Transform.Position = new Unframe.Presentation.Vector3 { X = 0.7, Y = 0.8, Z = -0.9 };
        nodeState.Transform.Rotation = new Unframe.Presentation.Quaternion
        {
            X = -0.6,
            W = 0.8
        };
        var snapshot = new TextAsset(JsonFormatter.Default.Format(item));
        try
        {
            runner.SetSnapshotFixture(snapshot);
            Assert.That(runner.TryLoad(out error), Is.True, error);
            binding.Refresh();
            Assert.That(space.activeSelf, Is.False);
            var marker = new Pose(new Vector3(1, 2, 3), Quaternion.Euler(0, 30, 0));
            Confirm(marker);
            binding.Refresh();
            binding.Refresh();
            Assert.That(space.activeSelf, Is.True);
            Assert.That(runner.Hierarchy.Registry.TryGet("node:local-stage", out GameObject node), Is.True);
            var expectedPosition = marker.position + marker.rotation * (runtimePosition + runtimeRotation * nodePosition);
            var expectedRotation = marker.rotation * runtimeRotation * nodeRotation;
            Assert.That(Vector3.Distance(node.transform.position, expectedPosition), Is.LessThan(0.00001));
            Assert.That(Quaternion.Angle(node.transform.rotation, expectedRotation), Is.LessThan(0.01));
            Assert.That(Vector3.Distance(node.transform.localPosition, nodePosition), Is.LessThan(0.00001));
            Assert.That(Quaternion.Angle(node.transform.localRotation, nodeRotation), Is.LessThan(0.01));
        }
        finally
        {
            Object.DestroyImmediate(snapshot);
        }
    }

    [Test]
    public void ResetAndDisabledAlignmentHideContentThenReconfirmationUsesNewPose()
    {
        Assert.That(runner.TryLoad(out string error), Is.True, error);
        Confirm(Pose.identity);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.True);
        alignment.ResetAlignment("Recalibrate", false);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.False);
        var next = new Pose(new Vector3(4, 5, 6), Quaternion.identity);
        Confirm(next);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.True);
        Assert.That(space.transform.position, Is.EqualTo(next.position));
        alignment.enabled = false;
        binding.Refresh();
        Assert.That(space.activeSelf, Is.False);
        Assert.That(runner.HasLoadedFixture, Is.True);
    }

    [Test]
    public void BindingDisableAndMissingRuntimeOriginHideContent()
    {
        Confirm(Pose.identity);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.False, "An aligned device still needs a runtime snapshot.");
        Assert.That(runner.TryLoad(out string error), Is.True, error);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.True);
        binding.enabled = false;
        Invoke(binding, "OnDisable");
        Assert.That(space.activeSelf, Is.False);
    }

    [Test]
    public void DestroyedAlignmentAndTrackingLossHideWithoutChangingRuntimeState()
    {
        Assert.That(runner.TryLoad(out string error), Is.True, error);
        Confirm(Pose.identity);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.True);
        Invoke(alignment, "OnTrackingLost");
        binding.Refresh();
        Assert.That(space.activeSelf, Is.False);
        Invoke(alignment, "OnTrackingAcquired");
        Confirm(Pose.identity);
        binding.Refresh();
        Assert.That(space.activeSelf, Is.True);
        // The serialized source can belong to another host, which may be destroyed first.
        var other = new GameObject("Destroyed Alignment Source");
        var source = other.AddComponent<ArucoOriginAlignment>();
        var otherCalibration = other.AddComponent<ArucoPresentationCalibration>();
        otherCalibration.Configure(source, host.transform);
        binding.Configure(otherCalibration, runner, space.transform, stage);
        Object.DestroyImmediate(other);
        Assert.DoesNotThrow(() => binding.Refresh());
        Assert.That(space.activeSelf, Is.False);
        Assert.That(runner.HasLoadedFixture, Is.True);
    }

    [Test]
    public void ConfigurationRejectsAControllerUnderTheHiddenPresentationRoot()
    {
        host.transform.SetParent(space.transform, false);
        Assert.Throws<System.ArgumentException>(() => binding.Configure(calibration, runner, space.transform, stage));
        host.transform.SetParent(null);
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

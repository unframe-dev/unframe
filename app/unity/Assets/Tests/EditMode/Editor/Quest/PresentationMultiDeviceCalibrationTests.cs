using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using Object = UnityEngine.Object;

public sealed class PresentationMultiDeviceCalibrationTests
{
    [Test]
    public void IndependentTrackingFramesPlaceTheSamePresentationPointRelativeToEachMarker()
    {
        var firstHost = new GameObject("Presenter device");
        var secondHost = new GameObject("Viewer device");
        var firstTracking = new GameObject("Presenter tracking");
        var secondTracking = new GameObject("Viewer tracking");
        try
        {
            firstTracking.transform.SetPositionAndRotation(new Vector3(2, .5f, 1), Quaternion.Euler(0, 25, 0));
            secondTracking.transform.SetPositionAndRotation(new Vector3(-3, 1, 2), Quaternion.Euler(0, -60, 0));
            var firstMarker = new Pose(new Vector3(1, .25f, 3), Quaternion.Euler(0, 10, 0));
            var secondMarker = new Pose(new Vector3(-2, .75f, 4), Quaternion.Euler(0, 75, 0));
            var firstCalibration = Calibrate(firstMarker, firstTracking.transform);
            var secondCalibration = Calibrate(secondMarker, secondTracking.transform);
            Assert.That(firstCalibration.PresentationFromQuestLocal, Is.Not.EqualTo(secondCalibration.PresentationFromQuestLocal));
            var first = firstHost.AddComponent<PresentationBakedRuntime>();
            var second = secondHost.AddComponent<PresentationBakedRuntime>();
            first.ConfigureCalibration(firstCalibration, firstTracking.transform);
            second.ConfigureCalibration(secondCalibration, secondTracking.transform);
            first.RefreshCalibration();
            second.RefreshCalibration();
            var sharedPoint = new Unframe.Presentation.Vector3 { X = .25, Y = .4, Z = -.5 };
            Assert.That(PresentationCoordinateAdapter.TryToUnityPosition(sharedPoint, out Vector3 localPoint), Is.True);
            Vector3 firstWorld = first.PresentationSpace.TransformPoint(localPoint);
            Vector3 secondWorld = second.PresentationSpace.TransformPoint(localPoint);
            Assert.That(Vector3.Distance(firstWorld, firstMarker.position + firstMarker.rotation * localPoint), Is.LessThan(.00001f));
            Assert.That(Vector3.Distance(secondWorld, secondMarker.position + secondMarker.rotation * localPoint), Is.LessThan(.00001f));
            Assert.That(first.CanSendInput || first.CanSendTracking || second.CanSendInput || second.CanSendTracking, Is.False,
                "Calibration alone must not make either disconnected device an active participant.");
        }
        finally
        {
            Object.DestroyImmediate(firstHost);
            Object.DestroyImmediate(secondHost);
            Object.DestroyImmediate(firstTracking);
            Object.DestroyImmediate(secondTracking);
        }
    }

    [Test]
    public void OneDeviceLosingCalibrationDoesNotInvalidateTheOtherDevice()
    {
        var firstHost = new GameObject("First device");
        var secondHost = new GameObject("Second device");
        try
        {
            var firstCalibration = Calibrate(Pose.identity, firstHost.transform);
            var secondCalibration = Calibrate(new Pose(Vector3.forward, Quaternion.Euler(0, 35, 0)), secondHost.transform);
            var first = firstHost.AddComponent<PresentationBakedRuntime>();
            var second = secondHost.AddComponent<PresentationBakedRuntime>();
            first.ConfigureCalibration(firstCalibration, firstHost.transform);
            second.ConfigureCalibration(secondCalibration, secondHost.transform);
            first.RefreshCalibration();
            second.RefreshCalibration();
            ulong retainedRevision = secondCalibration.Revision;
            Vector3 retainedPosition = second.PresentationSpace.position;
            Quaternion retainedRotation = second.PresentationSpace.rotation;
            firstCalibration.Invalidate("first-device-tracking-lost");
            Assert.That(first.CalibrationReady, Is.False);
            Assert.That(first.PresentationSpace.gameObject.activeSelf, Is.False);
            Assert.That(second.CalibrationReady, Is.True);
            Assert.That(secondCalibration.IsValid, Is.True);
            Assert.That(secondCalibration.Revision, Is.EqualTo(retainedRevision));
            Assert.That(second.PresentationSpace.position, Is.EqualTo(retainedPosition));
            Assert.That(second.PresentationSpace.rotation, Is.EqualTo(retainedRotation));
        }
        finally
        {
            Object.DestroyImmediate(firstHost);
            Object.DestroyImmediate(secondHost);
        }
    }

    [TestCase(0f)]
    [TestCase(1.8f)]
    [TestCase(2.5f)]
    public void SharedPresenterOriginPlacesAllDevicesInTheSamePhysicalSpace(float markerHeight)
    {
        var physicalMarker = new Pose(new Vector3(1, markerHeight, 3), Quaternion.Euler(32, 47, 18));
        var frames = new[]
        {
            Pose.identity,
            new Pose(new Vector3(-3, .7f, 2), Quaternion.Euler(0, 75, 0)),
            new Pose(new Vector3(4, -1.2f, -2), Quaternion.Euler(0, -110, 0)),
        };
        var hosts = new GameObject[frames.Length];
        var trackings = new GameObject[frames.Length];
        var runtimes = new PresentationBakedRuntime[frames.Length];
        var hierarchies = new PresentationNodeHierarchy[frames.Length];
        var stores = new PresentationRuntimeDataStore[frames.Length];
        var markers = new Pose[frames.Length];
        try
        {
            Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
                out DeliveryManifest delivery, out string error), Is.True, error);
            Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
                out ControlServerItem snapshot, out error), Is.True, error);
            var initial = QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity);
            delivery.ProjectionProfile.RuntimeCatalog.PlacementReferencePoint = new Unframe.Presentation.Vector3 { X = .25, Y = 2.15, Z = .5 };
            var head = new Pose(Vector3.up * 1.8f, Quaternion.Euler(20, 45, 0));
            Assert.That(PresentationCalibrationMath.TryPresenterOrigin(physicalMarker, head, initial,
                delivery.ProjectionProfile.RuntimeCatalog.PlacementReferencePoint, out var origin), Is.True);
            snapshot.ConnectionSnapshot.Fence.PresentationOriginVersion = 1;
            snapshot.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin { Version = 1, Pose = origin.Clone() };
            for (int index = 0; index < frames.Length; index++)
            {
                Pose frame = frames[index];
                markers[index] = new Pose(frame.position + frame.rotation * physicalMarker.position, frame.rotation * physicalMarker.rotation);
                hosts[index] = new GameObject("Device " + index);
                trackings[index] = new GameObject("Tracking " + index);
                trackings[index].transform.SetPositionAndRotation(new Vector3(index + 2, .5f - index, index - 3), Quaternion.Euler(0, 25 + 35 * index, 0));
                var calibration = Calibrate(markers[index], trackings[index].transform);
                runtimes[index] = hosts[index].AddComponent<PresentationBakedRuntime>();
                runtimes[index].ConfigureCalibration(calibration, trackings[index].transform);
                runtimes[index].RefreshCalibration();
                stores[index] = runtimes[index].DataStore;
                Assert.That(stores[index].TryReceiveDelivery(delivery.Clone(), out error), Is.True, error);
                hierarchies[index] = new PresentationNodeHierarchy();
                Assert.That(hierarchies[index].TryReplace(stores[index], runtimes[index].PresentationSpace, out error), Is.True, error);
            }

            var applier = new PresentationNodeStateApplier();
            for (int index = 0; index < 2; index++)
            {
                Assert.That(stores[index].TryReceiveControl(snapshot.Clone(), out error), Is.True, error);
                applier.Apply(stores[index], hierarchies[index]);
            }
            AssertPhysicalOrigin(runtimes[0], frames[0], 1.5f, physicalMarker);
            AssertPhysicalOrigin(runtimes[1], frames[1], 1.5f, physicalMarker);

            var newHead = new Pose(Vector3.up * 2.3f, Quaternion.Euler(30, 75, 0));
            Assert.That(PresentationCalibrationMath.TryPresenterOrigin(markers[0], newHead, origin,
                stores[0].Catalog.PlacementReferencePoint, out var replacement), Is.True);
            var changed = new ControlServerItem
            {
                ReliableEvent = new ProjectedReliableEvent
                {
                    Sequence = 1,
                    Fence = snapshot.ConnectionSnapshot.Fence.Clone(),
                    PresentationOriginChanged = new PresentationOriginChanged
                    { Origin = new PresentationOrigin { Version = 2, Pose = replacement.Clone() } }
                }
            };
            for (int index = 0; index < 2; index++)
            {
                Assert.That(stores[index].TryReceiveControl(changed.Clone(), out error), Is.True, error);
                applier.Apply(stores[index], hierarchies[index]);
            }
            trackings[1].transform.SetPositionAndRotation(new Vector3(-6, 2, 4), Quaternion.Euler(0, -10, 0));
            var recalibration = Calibrate(markers[1], trackings[1].transform);
            runtimes[1].ConfigureCalibration(recalibration, trackings[1].transform);
            runtimes[1].RefreshCalibration();
            var lateSnapshot = snapshot.Clone();
            lateSnapshot.ConnectionSnapshot.Fence.PresentationOriginVersion = 2;
            lateSnapshot.ConnectionSnapshot.ReliableSequence = 1;
            lateSnapshot.ConnectionSnapshot.Snapshot.ReliableSequence = 1;
            lateSnapshot.ConnectionSnapshot.Snapshot.RuntimeView.BaseReliableSequence = 1;
            lateSnapshot.ConnectionSnapshot.Snapshot.RuntimeView.PresentationOrigin = new PresentationOrigin { Version = 2, Pose = replacement.Clone() };
            Assert.That(stores[2].TryReceiveControl(lateSnapshot, out error), Is.True, error);
            applier.Apply(stores[2], hierarchies[2]);
            for (int index = 0; index < frames.Length; index++)
            {
                Assert.That(stores[index].PresentationOrigin.Version, Is.EqualTo(2));
                Assert.That(stores[index].PresentationOrigin.Pose, Is.EqualTo(replacement));
                AssertPhysicalOrigin(runtimes[index], frames[index], 2f, physicalMarker);
            }
        }
        finally
        {
            foreach (var hierarchy in hierarchies) hierarchy?.Clear();
            foreach (var host in hosts) if (host != null) Object.DestroyImmediate(host);
            foreach (var tracking in trackings) if (tracking != null) Object.DestroyImmediate(tracking);
        }
    }

    private static void AssertPhysicalOrigin(PresentationBakedRuntime runtime, Pose deviceFromPhysical, float expectedReferenceHeight, Pose physicalMarker)
    {
        Transform stage = runtime.PresentationSpace.GetChild(0);
        Quaternion physicalFromDevice = Quaternion.Inverse(deviceFromPhysical.rotation);
        Vector3 actualPosition = physicalFromDevice * (stage.position - deviceFromPhysical.position);
        Quaternion actualRotation = physicalFromDevice * stage.rotation;
        Assert.That(actualPosition.x, Is.EqualTo(physicalMarker.position.x).Within(.00001f));
        Assert.That(actualPosition.z, Is.EqualTo(physicalMarker.position.z).Within(.00001f));
        Assert.That(Quaternion.Angle(actualRotation, physicalMarker.rotation), Is.LessThan(.01f));
        var localPoint = new Vector3(.25f, 2.15f, -.5f);
        Vector3 actualPoint = physicalFromDevice * (stage.TransformPoint(localPoint) - deviceFromPhysical.position);
        Assert.That(actualPoint.y, Is.EqualTo(expectedReferenceHeight).Within(.00001f));
    }

    private static PresentationCalibrationState Calibrate(Pose marker, Transform tracking)
    {
        Assert.That(PresentationCalibrationMath.TryFromWorldOrigin(marker, tracking, out var pose, out string error), Is.True, error);
        var calibration = new PresentationCalibrationState();
        Assert.That(calibration.TrySet(pose, out error), Is.True, error);
        return calibration;
    }
}

using System.Collections;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class ArucoOriginAlignmentLifecycleTests
{
    private GameObject host;
    private ArucoOriginAlignment alignment;
    private int resetEvents;
    private static readonly Pose Expected = new Pose(new Vector3(1, 2, 3), Quaternion.Euler(10, 20, 30));

    [UnitySetUp]
    public IEnumerator SetUp()
    {
        resetEvents = 0;
        host = new GameObject("Alignment Lifecycle Test");
        alignment = host.AddComponent<ArucoOriginAlignment>();
        alignment.ResetRequested += () => resetEvents++;
        Invoke("Awake");
        Invoke("OnEnable");
        yield return null;
    }

    [UnityTearDown]
    public IEnumerator TearDown()
    {
        DestroyHost();
        yield return null;
    }

    [UnityTest]
    public IEnumerator TrackingLossHidesOriginAndAcquisitionRequiresFreshObservations()
    {
        Confirm();
        Invoke("OnTrackingLost");
        Assert.That(alignment.TrackingAvailable, Is.False);
        AssertResetAndHidden(1);
        Confirm(false);
        Invoke("OnTrackingAcquired");
        Assert.That(alignment.TrackingAvailable, Is.True);
        AssertResetAndHidden(2);
        Confirm();
        yield return null;
    }

    [UnityTest]
    public IEnumerator RecenterAndTrackingSpaceChangesInvalidateTheConfirmedOrigin()
    {
        Confirm();
        Invoke("OnRecenter");
        AssertResetAndHidden(1);
        Confirm();
        Invoke("OnTrackingSpaceChanged", host.transform);
        AssertResetAndHidden(2);
        Confirm();
        yield return null;
    }

    [UnityTest]
    public IEnumerator DisabledAlignmentCannotConfirmFromExternalObservationsAndReenableStartsFresh()
    {
        Confirm();
        alignment.enabled = false;
        Invoke("OnDisable");
        AssertResetAndHidden(0);
        Confirm(false);
        AssertResetAndHidden(0);
        alignment.enabled = true;
        Invoke("OnEnable");
        AssertResetAndHidden(0);
        Confirm();
        yield return null;
    }

    [UnityTest]
    public IEnumerator LifecycleTeardownReleasesOriginAndItsMaterials()
    {
        Confirm();
        var origin = GameObject.Find("ArUco ID 0 Origin (20 cm)");
        var renderers = origin.GetComponentsInChildren<MeshRenderer>();
        var materials = new Material[renderers.Length];
        for (int i = 0; i < renderers.Length; i++) materials[i] = renderers[i].sharedMaterial;
        DestroyHost();
        yield return null;
        Assert.That(origin == null, Is.True);
        foreach (var material in materials) Assert.That(material == null, Is.True);
    }

    private void Confirm(bool expected = true)
    {
        for (int i = 0; i < 8; i++)
        {
            var frame = new ArucoMarkerDetectionFrame(i + 1, new Vector2Int(1280, 960), new[] { 0 }, new float[8], 1);
            var estimate = new ArucoMarkerPoseEstimate(true, null, Expected, 0.1, 1, 2);
            var geometry = new ArucoCameraGeometry(960, 960, 640, 480, Pose.identity);
            alignment.Observe(new ArucoPoseObservation(frame, estimate, geometry), i * 0.2);
        }
        Assert.That(alignment.IsConfirmed, Is.EqualTo(expected));
        var origin = GameObject.Find("ArUco ID 0 Origin (20 cm)");
        if (!expected)
        {
            Assert.That(origin, Is.Null);
            return;
        }
        Assert.That(origin, Is.Not.Null);
        Assert.That(Vector3.Distance(alignment.OriginPose.position, Expected.position), Is.LessThan(0.001));
        Assert.That(Vector3.Distance(origin.transform.position, Expected.position), Is.LessThan(0.001));
        Assert.That(Quaternion.Angle(origin.transform.rotation, Expected.rotation), Is.LessThan(0.01));
    }

    private void AssertResetAndHidden(int events)
    {
        Assert.That(alignment.IsConfirmed, Is.False);
        Assert.That(GameObject.Find("ArUco ID 0 Origin (20 cm)"), Is.Null);
        Assert.That(resetEvents, Is.EqualTo(events));
    }

    private void Invoke(string method, params object[] arguments)
    {
        typeof(ArucoOriginAlignment).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(alignment, arguments);
    }

    private void DestroyHost()
    {
        if (host == null) return;
        // EditMode does not dispatch lifecycle callbacks for ordinary MonoBehaviours.
        foreach (string method in new[] { "OnDisable", "OnDestroy" })
            foreach (var component in host.GetComponents<MonoBehaviour>())
                component.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)
                    ?.Invoke(component, null);
        Object.DestroyImmediate(host);
    }
}

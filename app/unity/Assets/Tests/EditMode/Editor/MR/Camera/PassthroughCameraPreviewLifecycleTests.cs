using System.Reflection;
using Meta.XR;
using NUnit.Framework;
using UnityEngine;

public sealed class PassthroughCameraPreviewLifecycleTests
{
    [TestCase(false)]
    [TestCase(true)]
    public void PreviewRemeasurementInputRespectsItsConfiguredOwner(bool handleInput)
    {
        var host = new GameObject("Preview Input Ownership Test");
        var preview = host.AddComponent<PassthroughCameraDevicePreview>();
        try
        {
            var alignment = host.GetComponent<AprilTagOriginAlignment>();
            typeof(AprilTagOriginAlignment).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(alignment, null);
            for (int i = 0; i < 8; i++)
            {
                var frame = new AprilTagMarkerDetectionFrame(i + 1, new Vector2Int(640, 480), new[] { 0 }, new float[8], 1);
                var estimate = new AprilTagMarkerPoseEstimate(true, null, Pose.identity, 0.1, 1, 2);
                alignment.Observe(new AprilTagPoseObservation(frame, estimate,
                    new AprilTagCameraGeometry(450, 450, 320, 240, Pose.identity)), i * 0.2);
            }
            Assert.That(alignment.IsConfirmed, Is.True);
            SetField(preview, "alignment", alignment);
            SetField(preview, "handleRemeasurementInput", handleInput);
            var session = (AprilTagCameraSessionState)typeof(PassthroughCameraDevicePreview)
                .GetField("sessionState", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(preview);
            session.Supported = true;
            session.PermissionGranted = true;
            typeof(PassthroughCameraDevicePreview).GetMethod("HandleRemeasurementInput", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(preview, new object[] { true });
            Assert.That(alignment.IsConfirmed, Is.EqualTo(!handleInput));
        }
        finally { Object.DestroyImmediate(host); }
    }

    [Test]
    public void StandaloneCameraPreviewOwnsRemeasurementInputByDefault()
    {
        var host = new GameObject("Standalone Preview Input Test");
        try
        {
            var preview = host.AddComponent<PassthroughCameraDevicePreview>();
            var settings = new UnityEditor.SerializedObject(preview);
            Assert.That(settings.FindProperty("handleRemeasurementInput").boolValue, Is.True);
        }
        finally { Object.DestroyImmediate(host); }
    }

    [TestCase(false, false)]
    [TestCase(true, false)]
    [TestCase(true, true)]
    public void DisableAndDestroyAreSafeWhenCameraWasDestroyedFirst(bool destroyAlignment, bool destroyDetection)
    {
        var host = new GameObject("Preview Teardown Test");
        var cameraHost = new GameObject("Camera Teardown Test");
        var camera = cameraHost.AddComponent<PassthroughCameraAccess>();
        var preview = host.AddComponent<PassthroughCameraDevicePreview>();
        var dependencyHost = new GameObject("Preview Dependencies Teardown Test");
        try
        {
            SetField(preview, "cameraAccess", camera);
            var alignment = dependencyHost.AddComponent<AprilTagOriginAlignment>();
            var detection = dependencyHost.AddComponent<AprilTagCameraMarkerDetection>();
            SetField(preview, "alignment", destroyAlignment ? alignment : host.GetComponent<AprilTagOriginAlignment>());
            SetField(preview, "markerDetection", destroyDetection ? detection : host.GetComponent<AprilTagCameraMarkerDetection>());
            SetField(preview, "started", true);
            Object.DestroyImmediate(cameraHost);
            Object.DestroyImmediate(dependencyHost);
            Assert.That(camera == null, Is.True);
            Assert.DoesNotThrow(() => Invoke(preview, "OnDisable"));
            Assert.DoesNotThrow(() => Invoke(preview, "OnDestroy"));
        }
        finally
        {
            Object.DestroyImmediate(host);
            if (dependencyHost != null) Object.DestroyImmediate(dependencyHost);
            if (cameraHost != null) Object.DestroyImmediate(cameraHost);
        }
    }

    [Test]
    public void StoppingWithADestroyedCameraStillClearsPendingDetection()
    {
        var host = new GameObject("Preview Stop Test");
        var cameraHost = new GameObject("Camera Stop Test");
        var camera = cameraHost.AddComponent<PassthroughCameraAccess>();
        var preview = host.AddComponent<PassthroughCameraDevicePreview>();
        try
        {
            var detection = host.GetComponent<AprilTagCameraMarkerDetection>();
            SetField(preview, "cameraAccess", camera);
            SetField(preview, "markerDetection", detection);
            Object.DestroyImmediate(cameraHost);
            Assert.DoesNotThrow(() => Invoke(preview, "StopCamera"));
        }
        finally
        {
            Object.DestroyImmediate(host);
            if (cameraHost != null) Object.DestroyImmediate(cameraHost);
        }
    }

    [Test]
    public void PreviewViewCanBeStoppedAndDisposedAfterItsParentWasDestroyed()
    {
        var head = new GameObject("Preview Parent Teardown Test");
        var view = new AprilTagCameraPreviewView(head.transform);
        Object.DestroyImmediate(head);
        Assert.DoesNotThrow(() => view.ClearFeed());
        Assert.DoesNotThrow(() => view.SetVisible(false));
        Assert.DoesNotThrow(() => view.Dispose());
    }

    private static void SetField(PassthroughCameraDevicePreview preview, string name, object value) =>
        typeof(PassthroughCameraDevicePreview).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(preview, value);

    private static void Invoke(PassthroughCameraDevicePreview preview, string method) =>
        typeof(PassthroughCameraDevicePreview).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(preview, null);
}

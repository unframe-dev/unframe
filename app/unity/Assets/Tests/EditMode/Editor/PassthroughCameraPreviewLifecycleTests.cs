using System.Reflection;
using Meta.XR;
using NUnit.Framework;
using UnityEngine;

public sealed class PassthroughCameraPreviewLifecycleTests
{
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
            var alignment = dependencyHost.AddComponent<ArucoOriginAlignment>();
            var detection = dependencyHost.AddComponent<ArucoCameraMarkerDetection>();
            SetField(preview, "alignment", destroyAlignment ? alignment : host.GetComponent<ArucoOriginAlignment>());
            SetField(preview, "markerDetection", destroyDetection ? detection : host.GetComponent<ArucoCameraMarkerDetection>());
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
            var detection = host.GetComponent<ArucoCameraMarkerDetection>();
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
        var view = new ArucoCameraPreviewView(head.transform);
        Object.DestroyImmediate(head);
        Assert.DoesNotThrow(() => view.ClearFeed());
        Assert.DoesNotThrow(() => view.SetVisible(false));
        Assert.DoesNotThrow(() => view.Dispose());
    }

    private static void SetField(PassthroughCameraDevicePreview preview, string name, object value) =>
        typeof(PassthroughCameraDevicePreview).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(preview, value);

    [Test]
    public void MeasurementDetailsFitBelowTheFeedAndDisappearFromTheConfirmedPanel()
    {
        var head = new GameObject("Measurement Panel Test");
        var view = new ArucoCameraPreviewView(head.transform);
        try
        {
            const string measurement = "Unity world | m / deg\nLatest: P (1, 2, 3)\nAverage: P (1, 2, 3)";
            view.ShowStatus(new ArucoCameraPreviewStatus { MeasurementSummary = measurement, MeasurementPreviewEnabled = true });
            var panel = head.transform.Find("PCA Preview Panel");
            var details = panel.Find("Diagnostics").GetComponent<UnityEngine.UI.Text>();
            StringAssert.Contains(measurement, details.text);
            var panelRect = panel.GetComponent<RectTransform>();
            Assert.That(panel.localPosition.x + panelRect.rect.xMax * panel.localScale.x, Is.LessThan(0),
                "The diagnostic panel must leave the forward direction unobstructed.");
            var feedRect = panel.Find("Camera Feed Region").GetComponent<RectTransform>();
            float feedBottom = feedRect.anchoredPosition.y + feedRect.rect.yMin;
            float detailsTop = details.rectTransform.anchoredPosition.y + details.rectTransform.rect.yMax;
            Assert.That(detailsTop, Is.LessThan(feedBottom));
            Assert.That(details.rectTransform.anchoredPosition.y + details.rectTransform.rect.yMin,
                Is.GreaterThanOrEqualTo(panel.GetComponent<RectTransform>().rect.yMin));
            view.ShowStatus(new ArucoCameraPreviewStatus
            {
                AlignmentConfirmed = true, AlignmentSummary = "ALIGNED", MeasurementSummary = measurement
            });
            StringAssert.DoesNotContain("Latest", details.text);
            Assert.That(panel.GetComponent<RectTransform>().sizeDelta.y, Is.EqualTo(160));
            Assert.That(panel.localPosition.x, Is.Zero);
        }
        finally
        {
            view.Dispose();
            Object.DestroyImmediate(head);
        }
    }

    private static void Invoke(PassthroughCameraDevicePreview preview, string method) =>
        typeof(PassthroughCameraDevicePreview).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(preview, null);
}

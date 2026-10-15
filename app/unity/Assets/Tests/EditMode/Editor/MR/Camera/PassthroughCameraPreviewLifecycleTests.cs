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
            var alignment = host.GetComponent<ArucoOriginAlignment>();
            typeof(ArucoOriginAlignment).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(alignment, null);
            for (int i = 0; i < 8; i++)
            {
                var frame = new ArucoMarkerDetectionFrame(i + 1, new Vector2Int(640, 480), new[] { 0 }, new float[8], 1);
                var estimate = new ArucoMarkerPoseEstimate(true, null, Pose.identity, 0.1, 1, 2);
                alignment.Observe(new ArucoPoseObservation(frame, estimate,
                    new ArucoCameraGeometry(450, 450, 320, 240, Pose.identity)), i * 0.2);
            }
            Assert.That(alignment.IsConfirmed, Is.True);
            SetField(preview, "alignment", alignment);
            SetField(preview, "handleRemeasurementInput", handleInput);
            var session = (ArucoCameraSessionState)typeof(PassthroughCameraDevicePreview)
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
            Assert.That(panel.localPosition.x, Is.Zero);
            float horizontalEdge = panelRect.rect.xMax * panel.localScale.x;
            Assert.That(Mathf.Atan2(horizontalEdge, panel.localPosition.z) * Mathf.Rad2Deg, Is.LessThan(25),
                "The diagnostics must remain inside the central viewing area.");
            var feedRect = panel.Find("Camera Feed Region").GetComponent<RectTransform>();
            float feedBottom = feedRect.anchoredPosition.y + feedRect.rect.yMin;
            float detailsTop = details.rectTransform.anchoredPosition.y + details.rectTransform.rect.yMax;
            Assert.That(detailsTop, Is.LessThan(feedBottom));
            Assert.That(details.rectTransform.anchoredPosition.y + details.rectTransform.rect.yMin,
                Is.GreaterThanOrEqualTo(panel.GetComponent<RectTransform>().rect.yMin));
            view.ShowStatus(new ArucoCameraPreviewStatus
            {
                AlignmentConfirmed = true,
                AlignmentSummary = "ALIGNED",
                MeasurementSummary = measurement
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

    [TestCase(false)]
    [TestCase(true)]
    public void PresentationStatusIsCentralAndDoesNotOverlapMeasurementDiagnostics(bool networkSession)
    {
        var head = new GameObject("Central Status Test", typeof(Camera));
        var host = new GameObject("Presentation Status Test");
        var preview = new ArucoCameraPreviewView(head.transform);
        try
        {
            if (networkSession)
            {
                var status = host.AddComponent<Unframe.Unity.PresentationRuntime.QuestPresentationStatusView>();
                status.Configure(null, null, head.transform);
            }
            else
            {
                var status = host.AddComponent<Unframe.Unity.PresentationRuntime.QuestLocalPresentationStatusView>();
                status.Configure(null, head.transform);
                typeof(Unframe.Unity.PresentationRuntime.QuestLocalPresentationStatusView)
                    .GetMethod("CreatePanel", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(status, null);
            }

            preview.ShowStatus(new ArucoCameraPreviewStatus { MeasurementPreviewEnabled = true });
            var statusPanel = head.transform.Find(networkSession ? "Session Status" : "Local Presentation Status");
            var previewPanel = head.transform.Find("PCA Preview Panel");
            float statusTop = statusPanel.localPosition.y + statusPanel.GetComponent<RectTransform>().rect.yMax * statusPanel.localScale.y;
            float previewBottom = previewPanel.localPosition.y + previewPanel.GetComponent<RectTransform>().rect.yMin * previewPanel.localScale.y;
            Assert.That(statusTop, Is.LessThan(previewBottom));
            Assert.That(statusPanel.localPosition.x, Is.Zero);
            float statusBottom = statusPanel.localPosition.y + statusPanel.GetComponent<RectTransform>().rect.yMin * statusPanel.localScale.y;
            Assert.That(Mathf.Atan2(Mathf.Abs(statusBottom), statusPanel.localPosition.z) * Mathf.Rad2Deg, Is.LessThan(25));
        }
        finally
        {
            preview.Dispose();
            Object.DestroyImmediate(host);
            Object.DestroyImmediate(head);
        }
    }

    private static void Invoke(PassthroughCameraDevicePreview preview, string method) =>
        typeof(PassthroughCameraDevicePreview).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(preview, null);
}

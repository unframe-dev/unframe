using System;
using UnityEngine;
using UnityEngine.UI;

public struct ArucoCameraPreviewStatus
{
    public string State;
    public string PermissionStatus;
    public string CameraPosition;
    public Vector2Int Resolution;
    public float FramesPerSecond;
    public int FrameCount;
    public string CaptureTimestamp;
    public string LogFileName;
    public string DetectionSummary;
    public string AlignmentSummary;
    public string MeasurementSummary;
    public bool MeasurementPreviewEnabled;
    public bool AlignmentConfirmed;
}

public sealed class ArucoCameraPreviewView : IDisposable
{
    private readonly Transform head;
    private RectTransform panelRoot;
    private RawImage preview;
    private AspectRatioFitter previewAspect;
    private Text statusText;
    private Text detailsText;
    private ArucoMarkerOverlay markerOverlay;

    public ArucoCameraPreviewView(Transform head)
    {
        this.head = head != null ? head : throw new ArgumentNullException(nameof(head));
        CreatePanel();
    }

    public void SetVisible(bool visible)
    {
        if (panelRoot != null) panelRoot.gameObject.SetActive(visible);
    }

    public void SetFeed(Texture texture, ArucoMarkerDetectionFrame frame, Vector2Int resolution)
    {
        if (panelRoot == null) return;
        preview.texture = texture;
        preview.enabled = texture != null;
        markerOverlay.SetFrame(texture != null ? frame : null);
        if (resolution.y > 0) previewAspect.aspectRatio = (float)resolution.x / resolution.y;
    }

    public void ClearFeed() => SetFeed(null, null, Vector2Int.zero);

    public void ShowStatus(ArucoCameraPreviewStatus status)
    {
        if (panelRoot == null) return;
        statusText.text = $"PCA CAMERA TEST | {status.State}\nPermission: {status.PermissionStatus}";
        statusText.color = status.State == "LIVE" || status.State == "ALIGNED" ? new Color(0.4f, 1f, 0.5f) : Color.white;
        UpdatePanelLayout(status.AlignmentConfirmed);
        detailsText.text = status.AlignmentConfirmed
            ? status.AlignmentSummary + "\nB/Y: align again | Move your head to check the cube stays in place"
            : $"{status.CameraPosition} camera | {status.Resolution.x} x {status.Resolution.y}"
            + $" | {status.FramesPerSecond:F1} camera FPS | {status.FrameCount} frames\nCapture: {status.CaptureTimestamp}"
            + $"\n{status.DetectionSummary}\n{status.AlignmentSummary}"
            + (string.IsNullOrEmpty(status.MeasurementSummary) ? string.Empty : $"\n{status.MeasurementSummary}")
            + $"\nA/X: permission check | B/Y: align again\nLog: {status.LogFileName}";
    }

    public void Dispose()
    {
        if (panelRoot == null) return;
        if (Application.isPlaying) UnityEngine.Object.Destroy(panelRoot.gameObject);
        else UnityEngine.Object.DestroyImmediate(panelRoot.gameObject);
        panelRoot = null;
    }

    private void CreatePanel()
    {
        var panel = new GameObject("PCA Preview Panel", typeof(RectTransform), typeof(Canvas));
        panelRoot = panel.GetComponent<RectTransform>();
        panel.transform.SetParent(head, false);
        panel.transform.localPosition = new Vector3(0, 0.08f, 1.25f);
        panel.transform.localScale = Vector3.one * 0.00075f;
        panel.GetComponent<RectTransform>().sizeDelta = new Vector2(1000, 1120);
        panel.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
        panel.GetComponent<Canvas>().worldCamera = head.GetComponent<Camera>();
        var background = panel.AddComponent<Image>();
        background.color = new Color(0.015f, 0.025f, 0.04f, 0.95f);
        background.raycastTarget = false;
        var region = new GameObject("Camera Feed Region", typeof(RectTransform));
        region.transform.SetParent(panel.transform, false);
        region.GetComponent<RectTransform>().sizeDelta = new Vector2(800, 600);
        var image = new GameObject("Camera Feed", typeof(RectTransform), typeof(RawImage));
        image.transform.SetParent(region.transform, false);
        preview = image.GetComponent<RawImage>();
        preview.raycastTarget = false;
        preview.enabled = false;
        previewAspect = image.AddComponent<AspectRatioFitter>();
        previewAspect.aspectMode = AspectRatioFitter.AspectMode.FitInParent;
        previewAspect.aspectRatio = 4f / 3f;
        var overlay = new GameObject("ArUco Marker Outlines", typeof(RectTransform));
        overlay.transform.SetParent(image.transform, false);
        var overlayRect = overlay.GetComponent<RectTransform>();
        overlayRect.anchorMin = Vector2.zero;
        overlayRect.anchorMax = Vector2.one;
        overlayRect.sizeDelta = Vector2.zero;
        markerOverlay = overlay.AddComponent<ArucoMarkerOverlay>();
        markerOverlay.color = new Color(0.2f, 1f, 0.3f, 1f);
        markerOverlay.raycastTarget = false;
        statusText = CreateText(panel.transform, "Status", new Vector2(0, 510), new Vector2(940, 90), 26);
        detailsText = CreateText(panel.transform, "Diagnostics", new Vector2(0, -425), new Vector2(940, 240), 20);
    }

    private void UpdatePanelLayout(bool compact)
    {
        panelRoot.sizeDelta = compact ? new Vector2(1000, 160) : new Vector2(1000, 1120);
        panelRoot.localPosition = new Vector3(0, compact ? 0.28f : 0.08f, 1.25f);
        statusText.rectTransform.anchoredPosition = new Vector2(0, compact ? 45 : 510);
        statusText.rectTransform.sizeDelta = new Vector2(940, compact ? 60 : 90);
        detailsText.rectTransform.anchoredPosition = new Vector2(0, compact ? -30 : -425);
        detailsText.rectTransform.sizeDelta = new Vector2(940, compact ? 80 : 240);
    }

    private static Text CreateText(Transform parent, string name, Vector2 position, Vector2 size, int fontSize)
    {
        var textObject = new GameObject(name, typeof(RectTransform), typeof(Text));
        textObject.transform.SetParent(parent, false);
        var rect = textObject.GetComponent<RectTransform>();
        rect.anchoredPosition = position;
        rect.sizeDelta = size;
        var text = textObject.GetComponent<Text>();
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = fontSize;
        text.alignment = TextAnchor.MiddleLeft;
        text.color = Color.white;
        text.raycastTarget = false;
        return text;
    }

}

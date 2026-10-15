using System.Text;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.XR;

public sealed class QuestArmMotionDebugView : MonoBehaviour
{
    [SerializeField] private Transform head;
    [SerializeField] private QuestPresentationUiController flow;
    [SerializeField] private QuestLocalArmMotionControls motion;
    [SerializeField] private bool diagnosticVisible = true;
    private GameObject panel;
    private Text body;
    private double nextRefresh;
    private readonly StringBuilder text = new StringBuilder(1800);

    public GameObject Panel => panel;
    public string DisplayText => body != null ? body.text : "";

    public void Configure(Transform eye, QuestPresentationUiController controller, QuestLocalArmMotionControls source)
    {
        DestroyPanel();
        head = eye;
        flow = controller;
        motion = source;
        nextRefresh = 0;
    }

    public void Refresh(bool visible)
    {
        if (head == null) return;
        if (panel == null) CreatePanel();
        panel.SetActive(diagnosticVisible && visible);
        if (!panel.activeSelf) return;
        if (motion == null)
        {
            body.text = "Motion source missing";
            return;
        }
        var d = motion.RecognitionDiagnostics;
        var frame = motion.LastFrame;
        text.Clear();
        text.AppendLine($"Gate: {motion.BlockReason ?? "OPEN"} | motion: {(motion.isActiveAndEnabled ? "ON" : "OFF")}");
        double age = motion.SampleCount == 0 ? -1 : Time.realtimeSinceStartupAsDouble - motion.LastSampleTime;
        text.AppendLine($"Frames: {motion.SampleCount} | age: {age:F2}s | next event: {motion.UpcomingEvent}");
        text.AppendLine(motion.ProgressionHint);
        text.AppendLine($"Cue: {motion.UpcomingCueId ?? "none"}");
        text.AppendLine($"Usable pose H:{Bit(frame.HeadAvailable)} L:{Bit(frame.LeftAvailable)} R:{Bit(frame.RightAvailable)}");
        AppendDevice("H", XRNode.Head);
        AppendDevice("L", XRNode.LeftHand);
        AppendDevice("R", XRNode.RightHand);
        text.AppendLine($"State: {d.Phase} / {d.Reason}");
        text.AppendLine($"Trigger: {motion.ActiveTriggers} | waiting release: {(motion.WaitingForRelease ? "yes" : "no")}");
        if (!motion.UpcomingCueNeedsBothHands)
        {
            text.AppendLine($"L move: {d.LeftDistanceMeters:F2}/{d.MinimumDistanceMeters:F2}m | off:{d.LeftOffAxisMeters:F2} | v:{d.LeftSpeedMetersPerSecond:F2}");
            text.AppendLine($"R move: {d.RightDistanceMeters:F2}/{d.MinimumDistanceMeters:F2}m | off:{d.RightOffAxisMeters:F2} | v:{d.RightSpeedMetersPerSecond:F2}");
        }
        text.AppendLine($"Delta L:{Vector(d.LeftDisplacement)} R:{Vector(d.RightDisplacement)}");
        text.AppendLine($"Window: {d.WindowElapsedSeconds:F2}/{d.WindowSeconds:F2}s | min v:{d.MinimumSpeedMetersPerSecond:F2}");
        if (motion.UpcomingCueNeedsBothHands)
        {
            text.AppendLine($"Span: {d.InitialSpanMeters:F2}->{d.CurrentSpanMeters:F2}m | delta:{d.SpanDistanceMeters:F2}/{d.MinimumDistanceMeters:F2}");
            text.AppendLine($"Both hands: L:{d.LeftRadialDistanceMeters:F2} R:{d.RightRadialDistanceMeters:F2} >= {d.MinimumEachHandDistanceMeters:F2}m");
        }
        else text.AppendLine($"Off-axis limit: {d.MaximumOffAxisRatio:F2} x axis displacement");
        text.AppendLine($"Held buttons: {motion.HeldButtons}");
        text.AppendLine($"Last match #{motion.MatchCount}: {motion.LastResult}");
        if (motion.MatchCount > 0)
        {
            var last = motion.LastMatchDiagnostics;
            text.AppendLine($"Matched L:{last.LeftDistanceMeters:F2} R:{last.RightDistanceMeters:F2} span:{last.SpanDistanceMeters:F2}m");
        }
        text.Append($"Error: {motion.LastAdvanceError ?? "none"}");
        body.text = text.ToString();
    }

    private void AppendDevice(string label, XRNode node)
    {
        var device = InputDevices.GetDeviceAtXRNode(node);
        bool trackedRead = device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked);
        bool flagsRead = device.TryGetFeatureValue(CommonUsages.trackingState, out InputTrackingState flags);
        bool positionRead = device.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 position);
        bool rotationRead = device.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion rotation);
        string flagsLabel = !flagsRead ? "?" : flags == InputTrackingState.None ? "none"
            : ((flags & InputTrackingState.Position) != 0 ? "P" : "-")
                + ((flags & InputTrackingState.Rotation) != 0 ? "R" : "-");
        text.AppendLine($"{label}: valid{Bit(device.isValid)} tracked{(trackedRead ? Bit(tracked) : "?")} flags:{flagsLabel} pos{Bit(positionRead)} rot{Bit(rotationRead)} q:{Quaternion.Dot(rotation, rotation):F3}");
        string name = device.name ?? "no device";
        if (name.Length > 24) name = name.Substring(0, 24);
        text.AppendLine($"{label}: {Vector(position)} [{name}]");
    }

    private static string Bit(bool value) => value ? "1" : "0";
    private static string Vector(Vector3 value) => $"({value.x:F2},{value.y:F2},{value.z:F2})";

    private void CreatePanel()
    {
        panel = new GameObject("Arm Motion Diagnostics", typeof(RectTransform), typeof(Canvas), typeof(Image));
        panel.hideFlags = HideFlags.DontSave;
        panel.transform.SetParent(head, false);
        panel.transform.localPosition = new Vector3(0.22f, 0.08f, 1.05f);
        panel.transform.localScale = Vector3.one * 0.0009f;
        panel.GetComponent<RectTransform>().sizeDelta = new Vector2(730, 580);
        var canvas = panel.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.WorldSpace;
        canvas.worldCamera = head.GetComponent<Camera>();
        canvas.overrideSorting = true;
        canvas.sortingOrder = 1500;
        var background = panel.GetComponent<Image>();
        background.color = new Color(0.02f, 0.035f, 0.06f, 0.94f);
        background.raycastTarget = false;
        Font font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        var title = CreateText("Title", font, 20);
        title.rectTransform.anchoredPosition = new Vector2(0, 264);
        title.rectTransform.sizeDelta = new Vector2(690, 30);
        title.color = new Color(0.35f, 0.92f, 0.76f);
        title.text = "ARM MOTION DEBUG  |  H=head  L/R=hands  units=m,s";
        body = CreateText("Metrics", font, 17);
        body.rectTransform.anchoredPosition = new Vector2(0, -5);
        body.rectTransform.sizeDelta = new Vector2(690, 500);
        body.horizontalOverflow = HorizontalWrapMode.Wrap;
        body.verticalOverflow = VerticalWrapMode.Truncate;
        body.supportRichText = false;
    }

    private Text CreateText(string name, Font font, int fontSize)
    {
        var obj = new GameObject(name, typeof(RectTransform), typeof(Text));
        obj.transform.SetParent(panel.transform, false);
        var value = obj.GetComponent<Text>();
        value.font = font;
        value.fontSize = fontSize;
        value.alignment = TextAnchor.UpperLeft;
        value.color = Color.white;
        value.raycastTarget = false;
        return value;
    }

    private void LateUpdate()
    {
        double now = Time.realtimeSinceStartupAsDouble;
        if (now < nextRefresh) return;
        nextRefresh = now + 0.10;
        bool visible = flow != null && flow.Flow.State.Page == PresentationUiPage.Presenting;
        Refresh(visible);
    }

    private void OnDisable() { if (panel != null) panel.SetActive(false); }
    private void OnDestroy() => DestroyPanel();
    private void DestroyPanel()
    {
        if (panel != null)
        {
            if (Application.isPlaying) Destroy(panel);
            else DestroyImmediate(panel);
        }
        panel = null;
        body = null;
    }
}

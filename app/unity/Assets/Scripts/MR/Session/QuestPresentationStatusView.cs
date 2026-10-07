using UnityEngine;
using UnityEngine.UI;
using UnityEngine.XR;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestPresentationStatusView : MonoBehaviour
    {
        [SerializeField] private QuestPresentationEntry entry;
        [SerializeField] private ArucoPresentationCalibration calibrationSource;
        [SerializeField] private Transform head;
        private GameObject panel;
        private Text status;
        private bool resetWasPressed;
        public string StatusText { get; private set; }

        public void Configure(QuestPresentationEntry sessionEntry, ArucoPresentationCalibration source, Transform headTransform)
        {
            DestroyPanel();
            entry = sessionEntry;
            calibrationSource = source;
            head = headTransform;
            Refresh();
        }

        public void Refresh()
        {
            PresentationCalibrationState calibration = calibrationSource != null ? calibrationSource.Calibration : entry?.Calibration;
            string calibrationStatus = calibration == null ? "Calibration source unavailable"
                : calibration.IsValid ? "Marker calibration confirmed"
                : "Calibration required: " + calibration.Reason;
            StatusText = (entry != null ? entry.Summary : "Session not configured")
                + "\n" + calibrationStatus + "\nB/Y: align again";
            if (panel == null && head != null) CreatePanel();
            if (status != null) status.text = StatusText;
        }

        public void ResetCalibration()
        {
            PresentationCalibrationState sourceState = calibrationSource != null ? calibrationSource.Calibration : null;
            sourceState?.Invalidate("user-requested-remeasurement");
            if (entry != null && !ReferenceEquals(entry.Calibration, sourceState))
                entry.InvalidateCalibration("user-requested-remeasurement");
            Refresh();
        }

        private void OnEnable()
        {
            resetWasPressed = IsResetPressed();
            if (panel != null) panel.SetActive(true);
            Refresh();
        }

        private void Update()
        {
            bool pressed = IsResetPressed();
            if (pressed && !resetWasPressed) ResetCalibration();
            resetWasPressed = pressed;
            Refresh();
        }

        private static bool IsResetPressed() => IsSecondaryPressed(XRNode.LeftHand) || IsSecondaryPressed(XRNode.RightHand);

        private static bool IsSecondaryPressed(XRNode hand)
        {
            InputDevice device = InputDevices.GetDeviceAtXRNode(hand);
            return device.isValid && device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked) && tracked
                && device.TryGetFeatureValue(CommonUsages.secondaryButton, out bool pressed) && pressed;
        }

        private void CreatePanel()
        {
            panel = new GameObject("Session Status", typeof(RectTransform), typeof(Canvas), typeof(Image));
            panel.transform.SetParent(head, false);
            panel.transform.localPosition = new Vector3(0.65f, 0.65f, 1.25f);
            panel.transform.localScale = Vector3.one * 0.00075f;
            panel.GetComponent<RectTransform>().sizeDelta = new Vector2(600, 150);
            var canvas = panel.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = head.GetComponent<Camera>();
            var background = panel.GetComponent<Image>();
            background.color = new Color(0.015f, 0.025f, 0.04f, 0.9f);
            background.raycastTarget = false;
            var text = new GameObject("Status", typeof(RectTransform), typeof(Text));
            text.transform.SetParent(panel.transform, false);
            status = text.GetComponent<Text>();
            status.rectTransform.sizeDelta = new Vector2(570, 130);
            status.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            status.fontSize = 24;
            status.alignment = TextAnchor.MiddleLeft;
            status.color = Color.white;
            status.raycastTarget = false;
            panel.SetActive(isActiveAndEnabled);
        }

        private void OnDisable()
        {
            if (panel != null) panel.SetActive(false);
        }

        private void OnDestroy() => DestroyPanel();

        private void DestroyPanel()
        {
            if (panel != null)
            {
                if (Application.isPlaying) Destroy(panel);
                else DestroyImmediate(panel);
            }
            panel = null;
            status = null;
        }
    }
}

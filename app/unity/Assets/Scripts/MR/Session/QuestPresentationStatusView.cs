using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Unframe.Realtime;
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
        private readonly List<Button> controls = new List<Button>();
        private readonly List<Button> stepButtons = new List<Button>();
        private int stepPage;
        private string controlError;
        public string StatusText { get; private set; }

        public void Configure(QuestPresentationEntry sessionEntry, ArucoPresentationCalibration source, Transform headTransform)
        {
            DestroyPanel();
            if (entry != null) entry.ControlRayHandler = null;
            entry = sessionEntry;
            if (entry != null) entry.ControlRayHandler = TryHandleRay;
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
            if (status != null) status.text = StatusText + (controlError == null ? "" : "\n" + controlError);
            foreach (Button button in controls) button.interactable = entry?.CanControl == true;
            var steps = entry?.ReachedSteps;
            for (int i = 0; i < stepButtons.Count; i++)
            {
                int index = stepPage * stepButtons.Count + i;
                bool exists = steps != null && index < steps.Count;
                stepButtons[i].gameObject.SetActive(exists);
                if (exists) stepButtons[i].GetComponentInChildren<Text>().text = steps[index].GroupId + " / " + steps[index].StepId;
            }
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
            panel.transform.localPosition = new Vector3(0, -0.48f, 1.25f);
            panel.transform.localScale = Vector3.one * 0.00075f;
            panel.GetComponent<RectTransform>().sizeDelta = new Vector2(600, 470);
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
            status.rectTransform.anchoredPosition = new Vector2(0, 155);
            status.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            status.fontSize = 24;
            status.alignment = TextAnchor.MiddleLeft;
            status.color = Color.white;
            status.raycastTarget = false;
            AddButton("Pause", -200, 55, 180, () => SendControl(RuntimeControlKind.Pause));
            AddButton("Resume", 0, 55, 180, () => SendControl(RuntimeControlKind.Resume));
            AddButton("End", 200, 55, 180, () => SendControl(RuntimeControlKind.End));
            AddButton("Align again", -150, 5, 280, ResetCalibration);
            AddButton("Previous steps", 110, 5, 220, () => { stepPage = Math.Max(0, stepPage - 1); Refresh(); });
            AddButton("More steps", 110, -45, 220, () => { if ((stepPage + 1) * 3 < (entry?.ReachedSteps.Count ?? 0)) stepPage++; Refresh(); });
            for (int i = 0; i < 3; i++)
            {
                int slot = i;
                stepButtons.Add(AddButton("Step", 0, -100 - i * 45, 570, () =>
                {
                    var steps = entry?.ReachedSteps;
                    int index = stepPage * 3 + slot;
                    if (steps != null && index < steps.Count) _ = ExecuteControl(RuntimeControlKind.SelectStep, steps[index].GroupId, steps[index].StepId);
                }));
            }
            panel.SetActive(isActiveAndEnabled);
        }

        private Button AddButton(string label, float x, float y, float width, Action action)
        {
            var buttonObject = new GameObject(label, typeof(RectTransform), typeof(Image), typeof(Button));
            buttonObject.transform.SetParent(panel.transform, false);
            var rect = buttonObject.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(width, 40); rect.anchoredPosition = new Vector2(x, y);
            var button = buttonObject.GetComponent<Button>();
            button.targetGraphic = buttonObject.GetComponent<Image>();
            button.targetGraphic.color = new Color(0.12f, 0.2f, 0.28f);
            button.onClick.AddListener(() => action());
            var labelObject = new GameObject("Label", typeof(RectTransform), typeof(Text));
            labelObject.transform.SetParent(buttonObject.transform, false);
            var text = labelObject.GetComponent<Text>(); text.rectTransform.sizeDelta = rect.sizeDelta;
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); text.fontSize = 20;
            text.alignment = TextAnchor.MiddleCenter; text.color = Color.white; text.text = label; text.raycastTarget = false;
            controls.Add(button); return button;
        }

        public bool TryHandleRay(Ray ray)
        {
            if (panel == null || !panel.activeInHierarchy) return false;
            var plane = new Plane(panel.transform.forward, panel.transform.position);
            if (!plane.Raycast(ray, out float distance) || distance < 0) return false;
            Vector3 hit = ray.GetPoint(distance);
            foreach (Button button in controls)
            {
                if (!button.gameObject.activeInHierarchy || !button.interactable) continue;
                var rect = button.GetComponent<RectTransform>();
                Vector3 local = rect.InverseTransformPoint(hit);
                if (rect.rect.Contains(new Vector2(local.x, local.y))) { button.onClick.Invoke(); return true; }
            }
            return false;
        }

        public void SendControl(RuntimeControlKind kind) => _ = ExecuteControl(kind);
        private async Task ExecuteControl(RuntimeControlKind kind, string groupId = null, string stepId = null)
        {
            try { await entry.ControlAsync(kind, groupId, stepId); controlError = null; }
            catch (Exception exception) { controlError = "Control unavailable: " + exception.GetType().Name; }
        }

        private void OnDisable()
        {
            if (panel != null) panel.SetActive(false);
        }

        private void OnDestroy() { if (entry != null) entry.ControlRayHandler = null; DestroyPanel(); }

        private void DestroyPanel()
        {
            if (panel != null)
            {
                if (Application.isPlaying) Destroy(panel);
                else DestroyImmediate(panel);
            }
            controls.Clear(); stepButtons.Clear(); stepPage = 0;
            panel = null;
            status = null;
        }
    }
}

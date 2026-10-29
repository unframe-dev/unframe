using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
#if UNITY_EDITOR
using Mouse = UnityEngine.InputSystem.Mouse;
#endif
using UnityEngine.UI;
using UnityEngine.XR;
using InputDevice = UnityEngine.XR.InputDevice;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestPresentationStatusView : MonoBehaviour
    {
        [SerializeField] private QuestPresentationEntry entry;
        [SerializeField] private QuestPresentationSession session;
        [SerializeField] private AprilTagPresentationCalibration calibrationSource;
        [SerializeField] private Transform head;
        [SerializeField] private PassthroughCameraDevicePreview cameraPreview;
        private GameObject panel;
        private Text status;
        private Image leftAim;
        private Image rightAim;
        private bool resetWasPressed;
        private bool menuWasPressed;
        private bool menuOpen = true;
        private bool wasAudience;
        private bool detailsOpen;
        private bool stepsOpen;
        private int stepPage;
        private QuestOnboardingView onboarding;
        private bool OnboardingActive => onboarding != null && !onboarding.IsComplete;
        private bool confirmEnd;
        private Text details;
        private Text heading;
        private GameObject notice;
        private Text noticeText;
        public Transform Head => head;
        public bool MenuOpen => OnboardingActive || menuOpen;
        public bool GuidanceVisible => !OnboardingActive && !menuOpen && !AudienceMode;
        public bool AudienceMode => entry != null && entry.ControlReady && !entry.IsPresenter;
        private readonly List<Button> buttons = new List<Button>();
        private Task operation;
        private int operationRevision;
        private string operationError = String.Empty;
        private Func<Ray, bool> rayHandler;
        public GameObject Panel => panel;
        public Button FindButton(string name) => buttons.Find(button => button != null && button.name == name);
        public string StatusText { get; private set; }

        public void Configure(QuestPresentationEntry sessionEntry, AprilTagPresentationCalibration source, Transform headTransform)
        {
            Configure(sessionEntry, source, headTransform, sessionEntry != null ? sessionEntry.GetComponent<QuestPresentationSession>() : null);
        }

        public void Configure(QuestPresentationEntry sessionEntry, AprilTagPresentationCalibration source, Transform headTransform, QuestPresentationSession controller)
        {
            UnregisterRayHandler();
            DestroyPanel();
            session = controller;
            entry = sessionEntry;
            calibrationSource = source;
            head = headTransform;
            RegisterRayHandler();
            Refresh();
        }

        public void AttachOnboarding(QuestOnboardingView view)
        {
            onboarding = view;
            Refresh();
        }

        public void Refresh()
        {
            if (entry != null) entry.PresentationInputEnabled = !OnboardingActive && !menuOpen;
            if (cameraPreview == null && calibrationSource != null) cameraPreview = calibrationSource.CameraPreview;
            if (cameraPreview == null && entry != null) cameraPreview = entry.GetComponentInChildren<PassthroughCameraDevicePreview>(true);
            if (cameraPreview != null)
            {
                cameraPreview.DiagnosticUiVisible = false;
                cameraPreview.DiagnosticInputEnabled = false;
            }
            if (AudienceMode && !wasAudience) menuOpen = false;
            wasAudience = AudienceMode;
            PresentationCalibrationState calibration = calibrationSource != null ? calibrationSource.Calibration : entry?.Calibration;
            bool busy = (operation != null && !operation.IsCompleted) || (session != null && session.IsBusy);
            string error = !String.IsNullOrEmpty(operationError) ? operationError
                : !String.IsNullOrEmpty(session?.LastErrorCode) ? session.LastErrorCode : entry?.LastErrorCode;
            StatusText = !String.IsNullOrEmpty(error) ? "接続を確認してください。詳細と再接続から復帰できます。"
                : entry == null || entry.ConnectionStage == PresentationConnectionStage.NotConfigured ? "プレゼンへの接続情報が必要です。"
                : entry.ConnectionStage == PresentationConnectionStage.Connecting ? "プレゼンに接続しています…"
                : entry.ConnectionStage == PresentationConnectionStage.LoadingAssets ? "プレゼンを読み込んでいます…"
                : cameraPreview != null && cameraPreview.NeedsCameraPermission ? "位置合わせにはカメラの許可が必要です。\n「カメラを許可」を選んでください。"
                : calibration == null || !calibration.IsValid ? "マーカーを見て位置を合わせてください。"
                : !entry.SessionReady ? "プレゼンの準備をしています…"
                : entry.PlaybackStatus == "Running" ? "再生中"
                : entry.PlaybackStatus == "Paused" ? "再生準備完了・一時停止中"
                : entry.PlaybackStatus == "Terminating" ? "プレゼンを終了しています…" : "準備完了";
            if (panel == null && head != null) CreatePanel();
            if (status != null) status.text = confirmEnd ? "プレゼンを終了しますか？\n続ける場合は「戻る」を選んでください。"
                : StatusText + (!AudienceMode && !String.IsNullOrEmpty(onboarding?.SharedRoomCode) ? "\nルームコード：" + onboarding.SharedRoomCode : "");
            if (heading != null) heading.text = confirmEnd ? "発表を終了" : detailsOpen ? "設定と接続" : AudienceMode ? "鑑賞メニュー" : "プレゼン操作";
            if (panel != null)
            {
                panel.GetComponent<RectTransform>().sizeDelta = new Vector2(1000, 740);
                heading.rectTransform.anchoredPosition = new Vector2(0, 305);
                status.rectTransform.anchoredPosition = new Vector2(0, 220);
                panel.transform.Find("Hint").GetComponent<RectTransform>().anchoredPosition = new Vector2(0, -320);
                FindButton("Align").GetComponent<RectTransform>().anchoredPosition = AudienceMode ? new Vector2(-236, -20) : new Vector2(-118, 9);
                FindButton("Close").GetComponent<RectTransform>().anchoredPosition = AudienceMode ? new Vector2(0, -20) : new Vector2(118, 9);
                FindButton("Retry").GetComponent<RectTransform>().anchoredPosition = AudienceMode ? new Vector2(236, -20) : new Vector2(-354, -87);
                FindButton("CameraPermission").GetComponent<RectTransform>().anchoredPosition = AudienceMode ? new Vector2(0, -110) : new Vector2(118, -87);
                FindButton("Exit").GetComponent<RectTransform>().anchoredPosition = AudienceMode ? new Vector2(236, -110) : new Vector2(-118, -87);
            }
            if (details != null)
            {
                details.gameObject.SetActive(detailsOpen && !AudienceMode);
                details.text = "接続: " + entry?.ConnectionStage + "　再生: " + entry?.PlaybackStatus
                    + "\n素材: " + (entry?.AssetsReady == true ? "準備済み" : "未準備")
                    + "　位置合わせ: " + (calibration?.IsValid == true ? "完了" : "未完了")
                    + "\nコード: " + (error ?? calibration?.Reason ?? entry?.LastCommandOutcomeCode ?? "なし");
            }
            if (panel != null) panel.SetActive(isActiveAndEnabled && menuOpen && !OnboardingActive);
            if (notice != null)
            {
                bool ready = entry != null && entry.SessionReady && calibration?.IsValid == true && String.IsNullOrEmpty(error);
                notice.SetActive(isActiveAndEnabled && !menuOpen && !ready && !OnboardingActive);
                noticeText.text = StatusText + "\nX ボタン：メニュー";
            }
            var state = new QuestPresentationUiState(AudienceMode, entry?.IsPresenter == true,
                !busy && entry?.CanControlPresentation == true, entry?.PlaybackStatus);
            SetVisible("CameraPermission", !confirmEnd && cameraPreview != null && cameraPreview.NeedsCameraPermission);
            SetVisible("Connect", !AudienceMode && !confirmEnd && detailsOpen && entry?.IsRunning != true);
            SetEnabled("Connect", !busy && session != null && session.HasConnectionSettings && entry != null && !entry.IsRunning);
            SetVisible("Resume", !AudienceMode && !confirmEnd && !detailsOpen && entry?.PlaybackStatus != "Running");
            SetEnabled("Resume", state.CanResume);
            SetVisible("Pause", !AudienceMode && !confirmEnd && !detailsOpen && entry?.PlaybackStatus == "Running");
            SetEnabled("Pause", state.CanPause);
            SetVisible("Next", !AudienceMode && !confirmEnd && !detailsOpen);
            SetEnabled("Next", !busy && entry?.CanAdvance == true);
            SetVisible("End", !AudienceMode && !confirmEnd && detailsOpen);
            SetEnabled("End", state.CanEnd);
            SetVisible("ConfirmEnd", confirmEnd && !AudienceMode);
            SetEnabled("ConfirmEnd", state.CanEnd);
            SetVisible("CancelEnd", confirmEnd);
            SetVisible("Align", !confirmEnd && (AudienceMode || detailsOpen));
            SetEnabled("Align", !busy);
            SetVisible("Close", !confirmEnd);
            SetVisible("Details", !confirmEnd);
            if (FindButton("Details") != null) FindButton("Details").GetComponentInChildren<Text>().text = detailsOpen ? "戻る" : "設定";
            SetVisible("Retry", !confirmEnd && ((detailsOpen && entry?.IsRunning == true) || !String.IsNullOrEmpty(error)));
            SetEnabled("Retry", !busy && session != null && session.HasConnectionSettings);
            SetVisible("Exit", detailsOpen && !confirmEnd);
            SetVisible("Steps", !AudienceMode && !confirmEnd && detailsOpen);
            SetEnabled("Steps", !busy && entry?.CanControl == true && entry.ReachedSteps.Count > 0);
            SetVisible("PreviousSteps", stepsOpen && !AudienceMode && !confirmEnd);
            SetEnabled("PreviousSteps", stepPage > 0);
            SetVisible("MoreSteps", stepsOpen && !AudienceMode && !confirmEnd);
            SetEnabled("MoreSteps", (stepPage + 1) * 3 < (entry?.ReachedSteps.Count ?? 0));
            for (int i = 0; i < 3; i++)
            {
                int index = stepPage * 3 + i;
                bool exists = stepsOpen && !AudienceMode && !confirmEnd && entry != null && index < entry.ReachedSteps.Count;
                SetVisible("Step" + i, exists);
                SetEnabled("Step" + i, !busy && entry?.CanControl == true);
                if (exists) FindButton("Step" + i).GetComponentInChildren<Text>().text = entry.ReachedSteps[index].GroupId + " / " + entry.ReachedSteps[index].StepId;
            }
            SetEnabled("Exit", session != null && (session.HasConnectionSettings || entry?.IsRunning == true));
            LayoutActions();
        }

        private static readonly string[] ConfirmActions = { "ConfirmEnd", "CancelEnd" };
        private static readonly string[] SettingsActions = { "Align", "CameraPermission", "Retry", "Connect", "End", "Exit", "Steps", "Details" };
        private static readonly string[] StepActions = { "Step0", "Step1", "Step2", "PreviousSteps", "MoreSteps", "Details" };
        private static readonly string[] MainActions = { "Resume", "Pause", "Next", "Close", "Align", "CameraPermission", "Retry", "Details" };

        private void LayoutActions()
        {
            string[] order = confirmEnd ? ConfirmActions : stepsOpen ? StepActions : detailsOpen ? SettingsActions : MainActions;
            int count = 0;
            foreach (string name in order)
            {
                Button button = FindButton(name);
                if (button == null || !button.gameObject.activeSelf) continue;
                var rect = button.GetComponent<RectTransform>();
                rect.sizeDelta = new Vector2(280, 82);
                rect.anchoredPosition = new Vector2((count % 3 - 1) * 302, 100 - count / 3 * 104);
                button.GetComponentInChildren<Text>().rectTransform.sizeDelta = rect.sizeDelta;
                count++;
            }
            SetVisible("Close", !confirmEnd && !detailsOpen && !stepsOpen);
            if (stepsOpen)
            {
                foreach (Button button in buttons)
                    if (Array.IndexOf(StepActions, button.name) < 0) button.gameObject.SetActive(false);
            }
        }

        public void SetMenuOpen(bool open)
        {
            menuOpen = open;
            confirmEnd = false;
            if (open) PositionPanel();
            Refresh();
        }

        private void PositionPanel()
        {
            if (panel == null || head == null) return;
            Vector3 forward = Vector3.ProjectOnPlane(head.forward, Vector3.up);
            if (forward.sqrMagnitude < 0.001f) forward = Vector3.forward;
            Quaternion yaw = Quaternion.LookRotation(forward.normalized, Vector3.up);
            panel.transform.SetPositionAndRotation(head.position + yaw * new Vector3(0, -0.12f, 1.35f), yaw);
            if (notice != null) notice.transform.SetPositionAndRotation(panel.transform.position, yaw);
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
            if (entry == null) entry = GetComponent<QuestPresentationEntry>();
            if (session == null && entry != null) session = entry.GetComponent<QuestPresentationSession>();
            RegisterRayHandler();
            resetWasPressed = IsResetPressed();
            menuWasPressed = IsMenuPressed();
            if (panel != null) panel.SetActive(true);
            Refresh();
        }

        private void Update()
        {
            bool menuPressed = IsMenuPressed();
            if (!OnboardingActive && menuPressed && !menuWasPressed) SetMenuOpen(!menuOpen);
            menuWasPressed = menuPressed;
            bool pressed = IsResetPressed();
            if (!OnboardingActive && pressed && !resetWasPressed) ResetCalibration();
            resetWasPressed = pressed;
            UpdateControllerAim(XRNode.LeftHand, leftAim);
            UpdateControllerAim(XRNode.RightHand, rightAim);
#if UNITY_EDITOR
            var mouse = Mouse.current;
            Camera camera = head != null ? head.GetComponent<Camera>() : null;
            if (camera != null && mouse != null)
            {
                Ray mouseRay = camera.ScreenPointToRay(mouse.position.ReadValue());
                ShowAim(mouseRay, true);
                if (mouse.leftButton.wasPressedThisFrame) TryPress(mouseRay);
            }
#endif
            Refresh();
            if (notice != null && notice.activeSelf && head != null)
            {
                Vector3 forward = Vector3.ProjectOnPlane(head.forward, Vector3.up);
                if (forward.sqrMagnitude > 0.001f)
                {
                    Quaternion yaw = Quaternion.LookRotation(forward.normalized, Vector3.up);
                    notice.transform.SetPositionAndRotation(head.position + yaw * new Vector3(0, -0.22f, 1.6f), yaw);
                }
            }
        }

        public bool TryPress(Ray ray)
        {
            if (!isActiveAndEnabled) return false;
            if (OnboardingActive) return onboarding.HandleRay(ray);
            if (!isActiveAndEnabled || panel == null || !panel.activeInHierarchy) return false;
            var panelRect = panel.GetComponent<RectTransform>();
            var plane = new Plane(panelRect.forward, panelRect.position);
            if (!plane.Raycast(ray, out float distance) || distance < 0) return false;
            Vector3 worldPoint = ray.GetPoint(distance);
            Vector3 panelPoint = panelRect.InverseTransformPoint(worldPoint);
            if (!panelRect.rect.Contains(new Vector2(panelPoint.x, panelPoint.y))) return false;
            foreach (Button button in buttons)
            {
                if (!button.gameObject.activeInHierarchy || !button.IsInteractable()) continue;
                RectTransform rect = button.GetComponent<RectTransform>();
                Vector3 point = rect.InverseTransformPoint(worldPoint);
                if (!rect.rect.Contains(new Vector2(point.x, point.y))) continue;
                button.onClick.Invoke();
                break;
            }
            return true;
        }

        public bool ShowAim(Ray ray, bool rightHand)
        {
            if (OnboardingActive) return onboarding.ShowAim(ray, rightHand);
            Image aim = rightHand ? rightAim : leftAim;
            if (aim == null || panel == null) return false;
            if (!panel.activeInHierarchy) { aim.enabled = false; return false; }
            var rect = panel.GetComponent<RectTransform>();
            var plane = new Plane(rect.forward, rect.position);
            bool hit = plane.Raycast(ray, out float distance) && distance >= 0;
            Vector3 point = hit ? rect.InverseTransformPoint(ray.GetPoint(distance)) : Vector3.zero;
            hit &= rect.rect.Contains(new Vector2(point.x, point.y));
            aim.enabled = hit;
            if (hit) aim.rectTransform.anchoredPosition = new Vector2(point.x, point.y);
            return hit;
        }

        private void UpdateControllerAim(XRNode node, Image aim)
        {
            if (aim == null) return;
            InputDevice device = InputDevices.GetDeviceAtXRNode(node);
            Transform origin = entry != null ? entry.QuestTrackingOrigin : null;
            if (origin == null || !device.isValid
                || !device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked) || !tracked
                || !device.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 position)
                || !device.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion rotation))
            {
                aim.enabled = false;
                return;
            }
            ShowAim(new Ray(origin.TransformPoint(position), origin.TransformDirection(rotation * Vector3.forward)), node == XRNode.RightHand);
        }

        private void RegisterRayHandler()
        {
            if (entry == null || !isActiveAndEnabled) return;
            if (rayHandler == null) rayHandler = TryPress;
            entry.UiRayHandler = rayHandler;
        }

        private void UnregisterRayHandler()
        {
            if (entry != null && entry.UiRayHandler == rayHandler) entry.UiRayHandler = null;
        }

        private void SetVisible(string name, bool visible)
        {
            Button button = FindButton(name);
            if (button != null) button.gameObject.SetActive(visible);
        }

        private void SetEnabled(string name, bool enabled)
        {
            Button button = FindButton(name);
            if (button != null)
            {
                button.interactable = enabled;
                Text label = button.GetComponentInChildren<Text>();
                if (label != null) label.color = enabled ? (name == "Resume" || name == "Next" ? Color.white : QuestUiTheme.Text) : QuestUiTheme.Muted;
            }
        }

        private void RunOperation(Func<Task> action)
        {
            if (operation != null && !operation.IsCompleted) return;
            operation = ExecuteOperation(action);
        }

        private async Task ExecuteOperation(Func<Task> action)
        {
            int revision = operationRevision;
            operationError = String.Empty;
            try { await action(); }
            catch (Exception)
            {
                if (revision == operationRevision && isActiveAndEnabled) operationError = "operation-failed";
            }
        }

        private static bool IsMenuPressed()
        {
            InputDevice device = InputDevices.GetDeviceAtXRNode(XRNode.LeftHand);
            return device.isValid && device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked) && tracked
                && device.TryGetFeatureValue(CommonUsages.primaryButton, out bool pressed) && pressed;
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
            panel = new GameObject("Presentation Menu", typeof(RectTransform), typeof(Canvas), typeof(Image));
            panel.transform.SetParent(transform, false);
            panel.transform.localScale = Vector3.one * 0.001f;
            panel.GetComponent<RectTransform>().sizeDelta = new Vector2(1000, 740);
            panel.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
            panel.GetComponent<Canvas>().worldCamera = head.GetComponent<Camera>();
            QuestUiTheme.ApplySurface(panel.GetComponent<Image>());
            panel.GetComponent<Image>().raycastTarget = false;
            heading = AddText(panel.transform, "Heading", new Vector2(0, 305), new Vector2(920, 90), 40);
            status = AddText(panel.transform, "Status", new Vector2(0, 220), new Vector2(920, 100), 30);
            AddText(panel.transform, "Hint", new Vector2(0, -320), new Vector2(920, 52), 24).text =
                "照準を合わせてトリガーで選択　X：メニュー　B / Y：位置合わせ";
            details = AddText(panel.transform, "Details text", new Vector2(0, -210), new Vector2(920, 100), 23);
            AddButton("Connect", "準備・接続", 0, () => RunOperation(() => session.ConnectAsync()));
            AddButton("Resume", "再生 / 再開", 1, () => RunOperation(() => entry.ResumeAsync()));
            AddButton("Next", "次へ", 2, () => RunOperation(() => entry.AdvanceAsync()));
            AddButton("Pause", "一時停止", 3, () => RunOperation(() => entry.PauseAsync()));
            AddButton("End", "発表を終了", 4, () => { confirmEnd = true; Refresh(); });
            AddButton("Align", "位置合わせ", 5, ResetCalibration);
            AddButton("Close", "資料を見る", 6, () => SetMenuOpen(false));
            AddButton("Details", "詳細と再接続", 7, () => { if (stepsOpen) stepsOpen = false; else detailsOpen = !detailsOpen; Refresh(); });
            AddButton("Retry", "再接続", 8, () => RunOperation(() => onboarding != null ? onboarding.RetryConnectionAsync() : session.RetryAsync()));
            AddButton("Exit", "接続を解除", 9, () =>
            {
                operationRevision++;
                operation = ExecuteOperation(async () => { await session.ExitAsync(); onboarding?.ResetFlow(); });
            });
            AddButton("CameraPermission", "カメラを許可", 10, () => cameraPreview.RetryCameraPermission());
            AddButton("ConfirmEnd", "終了する", 0, () => { confirmEnd = false; RunOperation(() => entry.EndAsync()); });
            AddButton("CancelEnd", "戻る", 1, () => { confirmEnd = false; Refresh(); });
            AddButton("Steps", "到達済みの Step", 0, () => { stepsOpen = true; stepPage = 0; Refresh(); });
            AddButton("PreviousSteps", "前の一覧", 0, () => { stepPage = Math.Max(0, stepPage - 1); Refresh(); });
            AddButton("MoreSteps", "次の一覧", 0, () => { if ((stepPage + 1) * 3 < (entry?.ReachedSteps.Count ?? 0)) stepPage++; Refresh(); });
            for (int i = 0; i < 3; i++)
            {
                int slot = i;
                AddButton("Step" + i, "Step", i, () =>
                {
                    int index = stepPage * 3 + slot;
                    if (entry != null && index < entry.ReachedSteps.Count)
                    {
                        var step = entry.ReachedSteps[index];
                        RunOperation(() => entry.ControlAsync(Unframe.Realtime.RuntimeControlKind.SelectStep, step.GroupId, step.StepId));
                    }
                });
            }
            leftAim = CreateAim("Left controller aim", new Color(0.3f, 0.85f, 1));
            rightAim = CreateAim("Right controller aim", new Color(0.45f, 1, 0.65f));
            notice = new GameObject("Audience Notice", typeof(RectTransform), typeof(Canvas), typeof(Image));
            notice.transform.SetParent(transform, false);
            notice.transform.localScale = Vector3.one * 0.001f;
            notice.GetComponent<RectTransform>().sizeDelta = new Vector2(850, 160);
            notice.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
            notice.GetComponent<Canvas>().worldCamera = head.GetComponent<Camera>();
            QuestUiTheme.ApplySurface(notice.GetComponent<Image>());
            notice.GetComponent<Image>().raycastTarget = false;
            noticeText = AddText(notice.transform, "Notice", Vector2.zero, new Vector2(800, 140), 30);
            PositionPanel();
        }

        private static Text AddText(Transform parent, string name, Vector2 position, Vector2 size, int fontSize)
        {
            var obj = new GameObject(name, typeof(RectTransform), typeof(Text));
            obj.transform.SetParent(parent, false);
            Text text = obj.GetComponent<Text>();
            text.rectTransform.sizeDelta = size;
            text.rectTransform.anchoredPosition = position;
            text.font = QuestPresentationUiFont.Load();
            text.fontSize = fontSize;
            text.alignment = TextAnchor.MiddleLeft;
            text.color = QuestUiTheme.Text;
            text.raycastTarget = false;
            text.supportRichText = false;
            return text;
        }

        private Image CreateAim(string name, Color color)
        {
            var obj = new GameObject(name, typeof(RectTransform), typeof(Image));
            obj.transform.SetParent(panel.transform, false);
            var aim = obj.GetComponent<Image>();
            aim.rectTransform.sizeDelta = new Vector2(10, 10);
            aim.color = color;
            aim.raycastTarget = false;
            aim.enabled = false;
            return aim;
        }

        private void AddButton(string name, string title, int index, UnityEngine.Events.UnityAction action)
        {
            var obj = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            obj.transform.SetParent(panel.transform, false);
            var rect = obj.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(220, 76);
            rect.anchoredPosition = new Vector2((index % 4 - 1.5f) * 236, 105 - index / 4 * 96);
            var image = obj.GetComponent<Image>();
            QuestUiTheme.ApplyButton(image, name == "Resume" || name == "Next");
            image.raycastTarget = false;
            Button button = obj.GetComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(action);
            buttons.Add(button);
            var label = new GameObject("Label", typeof(RectTransform), typeof(Text));
            label.transform.SetParent(obj.transform, false);
            Text text = label.GetComponent<Text>();
            text.rectTransform.sizeDelta = rect.sizeDelta;
            text.font = QuestPresentationUiFont.Load();
            text.fontSize = 29;
            text.alignment = TextAnchor.MiddleCenter;
            text.color = QuestUiTheme.Text;
            text.raycastTarget = false;
            text.text = title;
            if (name == "Resume" || name == "Next") text.color = Color.white;
        }

        private void OnDisable()
        {
            operationRevision++;
            UnregisterRayHandler();
            if (panel != null) panel.SetActive(false);
            if (notice != null) notice.SetActive(false);
        }

        private void OnDestroy() { UnregisterRayHandler(); DestroyPanel(); }

        private void DestroyPanel()
        {
            if (panel != null)
            {
                if (Application.isPlaying) Destroy(panel);
                else DestroyImmediate(panel);
            }
            if (notice != null)
            {
                if (Application.isPlaying) Destroy(notice);
                else DestroyImmediate(notice);
            }
            notice = null;
            noticeText = null;
            details = null;
            heading = null;
            buttons.Clear();
            stepsOpen = false;
            stepPage = 0;
            panel = null;
            status = null;
            leftAim = null;
            rightAim = null;
        }
    }
}

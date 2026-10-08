using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
#if UNITY_EDITOR
using UnityEngine.InputSystem;
#endif

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestPresentationFlowView : MonoBehaviour
    {
        public event Action<PresentationUiRole> RoleSelected;
        public event Action<string> RoomJoinRequested;
        public event Action<string> PresentationSelected;
        public event Action AuthenticationPreviewContinued;
        public event Action CreateRoomRequested;
        public event Action NextRequested;
        public event Action StartRequested;
        public event Action RetryCameraRequested;
        public event Action RemeasureRequested;
        public event Action ExitRequested;
        public event Action ExitConfirmed;
        public event Action ExitCancelled;
        public event Action BackRequested;

        private readonly List<Button> buttons = new List<Button>();
        private Transform head;
        private GameObject panel;
        private PresentationUiState renderedState;
        private Text markerText;
        private Text eventText;
        private Text progressionHint;
        private Text roomText;
        private Image progressFill;
        private string roomDraft = "";
        private Font font;
#if UNITY_EDITOR
        private Keyboard keyboard;
#endif
        private static readonly Color Mint = new Color(0.35f, 0.92f, 0.76f);
        private static readonly Color Muted = new Color(0.66f, 0.74f, 0.83f);
        public GameObject Panel => panel;
        public string RoomCodeDraft => roomDraft;

        public void Configure(Transform headTransform)
        {
            DestroyPanel();
            head = headTransform;
            renderedState = null;
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        }

        public void Render(PresentationUiState state, string markerStatus = "Find the marker", float progress = 0, int eventNumber = 0)
        {
            if (state == null || head == null) return;
            if (panel == null || renderedState == null || state.Page != renderedState.Page || state.Role != renderedState.Role || state.PresentationId != renderedState.PresentationId || state.CalibrationComplete != renderedState.CalibrationComplete)
            {
                if (state.Page == PresentationUiPage.RoomCode && (renderedState == null || renderedState.Page != state.Page)) roomDraft = state.RoomCode ?? "";
                Build(state);
            }
            renderedState = state;
            if (markerText != null) markerText.text = state.CalibrationComplete ? "Alignment complete" : markerStatus;
            if (progressFill != null) progressFill.rectTransform.sizeDelta = new Vector2(580 * (state.CalibrationComplete ? 1 : Mathf.Clamp01(progress)), 16);
            if (eventText != null) eventText.text = "Step " + eventNumber;
        }

        public void SetProgressionHint(string hint)
        {
            if (progressionHint != null) progressionHint.text = hint;
        }

        public Button FindButton(string name) => buttons.Find(button => button != null && button.name == name);

        public bool TryPress(Ray ray)
        {
            if (!isActiveAndEnabled || panel == null || !panel.activeInHierarchy) return false;
            foreach (var button in buttons)
            {
                if (!button.gameObject.activeInHierarchy || !button.IsInteractable()) continue;
                var rect = button.GetComponent<RectTransform>();
                var plane = new Plane(rect.forward, rect.position);
                if (!plane.Raycast(ray, out var distance) || distance < 0) continue;
                var point = rect.InverseTransformPoint(ray.GetPoint(distance));
                if (!rect.rect.Contains(new Vector2(point.x, point.y))) continue;
                button.onClick.Invoke();
                return true;
            }
            return false;
        }

        public void AppendRoomCode(char digit)
        {
            if (digit < '0' || digit > '9' || roomDraft.Length >= 6) return;
            roomDraft += digit;
            RefreshRoomCode();
        }

        public void BackspaceRoomCode()
        {
            if (roomDraft.Length > 0) roomDraft = roomDraft.Substring(0, roomDraft.Length - 1);
            RefreshRoomCode();
        }

#if UNITY_EDITOR
        private void Update()
        {
            if (keyboard == Keyboard.current) return;
            if (keyboard != null) keyboard.onTextInput -= OnKeyboardText;
            keyboard = Keyboard.current;
            if (keyboard != null) keyboard.onTextInput += OnKeyboardText;
        }

        private void OnKeyboardText(char character)
        {
            if (renderedState == null || renderedState.Page != PresentationUiPage.RoomCode) return;
            if (character == '\b') BackspaceRoomCode();
            else if (character == '\n' || character == '\r')
            {
                var join = FindButton("Join");
                if (join != null && join.interactable) join.onClick.Invoke();
            }
            else AppendRoomCode(character);
        }
#endif

        private void Build(PresentationUiState state)
        {
            DestroyPanel();
            var compact = state.Page == PresentationUiPage.Presenting;
            panel = new GameObject("Presentation Flow", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster), typeof(Image));
            panel.hideFlags = HideFlags.DontSave;
            panel.transform.SetParent(head, false);
            panel.transform.localPosition = new Vector3(0, compact ? -0.43f : 0, 1.4f);
            panel.transform.localScale = Vector3.one * 0.0009f;
            panel.GetComponent<RectTransform>().sizeDelta = new Vector2(780, compact ? 220 : 680);
            var canvas = panel.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = head.GetComponent<Camera>();
            var background = panel.GetComponent<Image>();
            background.color = new Color(0.025f, 0.045f, 0.08f, 0.96f);
            background.raycastTarget = false;
            Text("Brand", "UNFRAME", -310, compact ? 77 : 290, 140, 32, 24, Mint, TextAnchor.MiddleLeft);
            if (!compact) Text("Preview", "INTERFACE PREVIEW", 210, 290, 240, 32, 17, Muted, TextAnchor.MiddleRight);
            switch (state.Page)
            {
                case PresentationUiPage.RoleSelection:
                    Title("Choose your role", "Join a presentation or lead the room.");
                    AddButton("Audience", "Audience", 0, 30, 620, 100, () => RoleSelected?.Invoke(PresentationUiRole.Audience));
                    Text("AudienceDescription", "Enter a room code to watch.", 0, -44, 620, 36, 22, Muted);
                    AddButton("Presenter", "Presenter", 0, -130, 620, 100, () => RoleSelected?.Invoke(PresentationUiRole.Presenter));
                    Text("PresenterDescription", "Choose a presentation and control the flow.", 0, -205, 620, 36, 22, Muted);
                    break;
                case PresentationUiPage.RoomCode:
                    Title("Enter room code", "Preview only. No room connection is made.");
                    roomText = Text("RoomCode", "", 0, 92, 540, 62, 42, Color.white);
                    for (var index = 0; index < 9; index++)
                    {
                        var digit = (char)('1' + index);
                        AddButton("Digit" + digit, digit.ToString(), (index % 3 - 1) * 120 - 80, 8 - index / 3 * 70, 104, 58, () => AppendRoomCode(digit));
                    }
                    AddButton("Backspace", "Delete", -200, -202, 104, 58, BackspaceRoomCode);
                    AddButton("Digit0", "0", -80, -202, 104, 58, () => AppendRoomCode('0'));
                    AddButton("Join", "Join preview", 235, -82, 180, 86, () => RoomJoinRequested?.Invoke(roomDraft), true);
                    AddBack();
                    RefreshRoomCode();
                    break;
                case PresentationUiPage.AuthenticationPreview:
                    Title("Presenter sign in", "Account authentication is not connected yet.");
                    Text("AuthNotice", "Your account will securely connect here.\nNo credentials are collected in this preview.", 0, 20, 640, 110, 26, Muted);
                    AddButton("ContinuePreview", "Continue in preview", 0, -145, 620, 86, () => AuthenticationPreviewContinued?.Invoke(), true);
                    AddBack();
                    break;
                case PresentationUiPage.RoomSetup:
                    Title("Set up your room", "Preview only. No online room is created.");
                    AddButton("SamplePresentation", "Sample presentation", 0, 38, 620, 105, () => PresentationSelected?.Invoke("sample"));
                    Text("Selection", string.IsNullOrEmpty(state.PresentationId) ? "Select a presentation to continue." : "Selected: Sample presentation", 0, -42, 620, 40, 23, Muted);
                    var create = AddButton("CreateRoom", "Create preview room", 0, -145, 620, 86, () => CreateRoomRequested?.Invoke(), true);
                    create.interactable = !string.IsNullOrEmpty(state.PresentationId);
                    AddBack();
                    break;
                case PresentationUiPage.Calibration:
                    Title(state.CalibrationComplete ? "Ready to present" : "Align your space",
                        state.CalibrationComplete ? "Your space is aligned with the marker." : "Look at the full marker and hold still.");
                    Text("MarkerSymbol", state.CalibrationComplete ? "OK" : "+", 0, 15, 180, 120, state.CalibrationComplete ? 64 : 90, Mint);
                    markerText = Text("MarkerStatus", "", 0, -80, 640, 50, 28, Color.white);
                    CreateProgress();
                    Text("MarkerHelp", state.CalibrationComplete ? "Your presentation is ready." : "Keep the black border and white margin visible.", 0, -198, 650, 45, 22, Muted);
                    if (state.CalibrationComplete)
                    {
                        AddButton("Start", "Start presentation", 0, -252, 380, 60, () => StartRequested?.Invoke(), true);
                        AddButton("Exit", "Leave", 0, -313, 180, 32, () => ExitRequested?.Invoke());
                    }
                    else
                    {
                        AddButton("RetryCamera", "Retry camera", -145, -273, 260, 48, () => RetryCameraRequested?.Invoke());
                        AddButton("Exit", "Leave", 145, -273, 260, 48, () => ExitRequested?.Invoke());
                    }
                    break;
                case PresentationUiPage.Presenting:
                    eventText = Text("Event", "", 240, 77, 220, 32, 24, Muted, TextAnchor.MiddleRight);
                    var next = AddButton("Next", "Next", -220, -13, 220, 74, () => NextRequested?.Invoke(), true);
                    next.interactable = state.CanControlPresentation;
                    if (!state.CanControlPresentation) next.GetComponentInChildren<Text>().text = "Audience";
                    AddButton("Remeasure", "Realign", 30, -13, 220, 74, () => RemeasureRequested?.Invoke());
                    AddButton("Exit", "Leave", 250, -13, 170, 74, () => ExitRequested?.Invoke());
                    progressionHint = Text("Aligned", "Aligned to the marker", 0, -79, 650, 32, 18, Mint);
                    break;
                case PresentationUiPage.ExitConfirmation:
                    Title("Leave presentation?", "You can join again from the start screen.");
                    AddButton("CancelExit", "Stay", 0, 10, 620, 90, () => ExitCancelled?.Invoke(), true);
                    AddButton("ConfirmExit", "Leave presentation", 0, -110, 620, 90, () => ExitConfirmed?.Invoke());
                    break;
            }
            panel.SetActive(isActiveAndEnabled);
        }

        private void Title(string title, string subtitle)
        {
            Text("Title", title, 0, 205, 690, 70, 40, Color.white);
            Text("Subtitle", subtitle, 0, 142, 690, 50, 22, Muted);
        }

        private void AddBack() => AddButton("Back", "Back", 0, -283, 180, 45, () => BackRequested?.Invoke());

        private void RefreshRoomCode()
        {
            if (roomText != null) roomText.text = roomDraft.PadRight(6, '_');
            var join = FindButton("Join");
            if (join != null) join.interactable = roomDraft.Length == 6;
        }

        private void CreateProgress()
        {
            var track = new GameObject("Progress", typeof(RectTransform), typeof(Image));
            track.transform.SetParent(panel.transform, false);
            var rect = track.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(580, 16);
            rect.anchoredPosition = new Vector2(0, -139);
            track.GetComponent<Image>().color = new Color(0.13f, 0.19f, 0.25f);
            var fill = new GameObject("Progress Fill", typeof(RectTransform), typeof(Image));
            fill.transform.SetParent(track.transform, false);
            var fillRect = fill.GetComponent<RectTransform>();
            fillRect.anchorMin = new Vector2(0, 0.5f);
            fillRect.anchorMax = new Vector2(0, 0.5f);
            fillRect.pivot = new Vector2(0, 0.5f);
            fillRect.sizeDelta = new Vector2(0, 16);
            progressFill = fill.GetComponent<Image>();
            progressFill.color = Mint;
            progressFill.type = Image.Type.Filled;
            progressFill.fillMethod = Image.FillMethod.Horizontal;
            progressFill.fillOrigin = 0;
            progressFill.raycastTarget = false;
        }

        private Text Text(string name, string content, float x, float y, float width, float height, int size, Color color, TextAnchor alignment = TextAnchor.MiddleCenter)
        {
            var child = new GameObject(name, typeof(RectTransform), typeof(Text));
            child.transform.SetParent(panel.transform, false);
            var text = child.GetComponent<Text>();
            text.rectTransform.anchoredPosition = new Vector2(x, y);
            text.rectTransform.sizeDelta = new Vector2(width, height);
            text.text = content;
            text.font = font;
            text.fontSize = size;
            text.alignment = alignment;
            text.color = color;
            text.raycastTarget = false;
            return text;
        }

        private Button AddButton(string name, string label, float x, float y, float width, float height, Action action, bool primary = false)
        {
            var child = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            child.transform.SetParent(panel.transform, false);
            var rect = child.GetComponent<RectTransform>();
            rect.anchoredPosition = new Vector2(x, y);
            rect.sizeDelta = new Vector2(width, height);
            var image = child.GetComponent<Image>();
            image.color = primary ? Mint : new Color(0.1f, 0.16f, 0.23f);
            var button = child.GetComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(() => action());
            var colors = button.colors;
            colors.highlightedColor = new Color(0.75f, 0.9f, 1f);
            colors.pressedColor = new Color(0.5f, 0.7f, 0.85f);
            colors.disabledColor = new Color(0.4f, 0.4f, 0.4f, 0.6f);
            button.colors = colors;
            var text = Text(name + " Label", label, 0, 0, width - 20, height - 10, 27, primary ? new Color(0.02f, 0.08f, 0.09f) : Color.white);
            text.transform.SetParent(child.transform, false);
            buttons.Add(button);
            return button;
        }

        private void OnEnable() { if (panel != null) panel.SetActive(true); }
        private void OnDisable()
        {
            if (panel != null) panel.SetActive(false);
#if UNITY_EDITOR
            if (keyboard != null) keyboard.onTextInput -= OnKeyboardText;
            keyboard = null;
#endif
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
            markerText = null;
            eventText = null;
            progressionHint = null;
            roomText = null;
            progressFill = null;
            buttons.Clear();
        }
    }
}

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

        private const float ProgressWidth = 640;
        private readonly List<Button> buttons = new List<Button>();
        private Transform head;
        private GameObject panel;
        private PresentationUiState renderedState;
        private Text markerText;
        private Text eventText;
        private Text statusLabel;
        private Text guidanceTitle;
        private Text guidanceInstruction;
        private RectTransform guidanceIcon;
        private ArmMotionPreset? shownPreset;
        private string shownTitle;
        private Text roomText;
        private Image progressFill;
        private Texture2D roundedTexture;
        private Sprite roundedSprite;
        private string roomDraft = "";
        private Font font;
#if UNITY_EDITOR
        private Keyboard keyboard;
#endif
        private static readonly Color Mint = new Color(0.35f, 0.92f, 0.76f);
        private static readonly Color Muted = new Color(0.72f, 0.79f, 0.86f);
        private static readonly Color Surface = new Color(0.075f, 0.115f, 0.16f);
        public GameObject Panel => panel;
        public string RoomCodeDraft => roomDraft;

        public void Configure(Transform headTransform)
        {
            DestroyPanel();
            head = headTransform;
            renderedState = null;
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        }

        public void Render(PresentationUiState state, string markerStatus = "Find the marker", float progress = 0, int eventNumber = 0, int totalEvents = 0)
        {
            if (state == null || head == null) return;
            if (panel == null || renderedState == null || state.Page != renderedState.Page || state.Role != renderedState.Role || state.PresentationId != renderedState.PresentationId || state.CalibrationComplete != renderedState.CalibrationComplete)
            {
                if (state.Page == PresentationUiPage.RoomCode && (renderedState == null || renderedState.Page != state.Page)) roomDraft = state.RoomCode ?? "";
                Build(state);
            }
            renderedState = state;
            if (markerText != null) markerText.text = state.CalibrationComplete ? "Aligned" : markerStatus;
            if (progressFill != null)
            {
                float amount = state.CalibrationComplete ? 1 : Mathf.Clamp01(progress);
                progressFill.rectTransform.sizeDelta = new Vector2(ProgressWidth * amount, 16);
                progressFill.enabled = amount > 0;
            }
            if (eventText != null) eventText.text = eventNumber == 0 ? "READY"
                : totalEvents > 0 ? "STEP " + eventNumber + " / " + totalEvents : "STEP " + eventNumber;
        }

        public void SetGuidance(PresentationProgressGuidance guidance)
        {
            if (guidanceTitle == null) return;
            guidanceTitle.text = guidance.Title;
            guidanceInstruction.text = guidance.Instruction;
            statusLabel.text = guidance.MotionPreset.HasValue || guidance.Title == "Next slide" ? "UP NEXT" : "STATUS";
            if (shownTitle != guidance.Title || shownPreset != guidance.MotionPreset)
            {
                DrawGuidanceIcon(guidance);
                shownTitle = guidance.Title;
                shownPreset = guidance.MotionPreset;
            }
            var next = FindButton("Next");
            if (next != null && renderedState.CanControlPresentation)
                next.GetComponentInChildren<Text>().text = guidance.Title == "Complete" ? "Done" : "Next / A";
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
            EnsureRoundedSprite();
            bool compact = state.Page == PresentationUiPage.Presenting;
            panel = new GameObject("Presentation Flow", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster), typeof(Image));
            panel.hideFlags = HideFlags.DontSave;
            panel.transform.SetParent(head, false);
            panel.transform.localPosition = new Vector3(0, compact ? -0.46f : 0, 1.4f);
            panel.transform.localScale = Vector3.one * 0.0009f;
            panel.GetComponent<RectTransform>().sizeDelta = new Vector2(820, compact ? 330 : 720);
            var canvas = panel.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = head.GetComponent<Camera>();
            SetRounded(panel.GetComponent<Image>(), new Color(0.025f, 0.045f, 0.07f, 0.97f));
            var brand = Text("Brand", compact ? "UP NEXT" : "UNFRAME", -265, compact ? 132 : 308, 210, 32, 24, Mint, TextAnchor.MiddleLeft);
            if (compact) statusLabel = brand;
            if (!compact) Text("Preview", "LOCAL PREVIEW", 245, 308, 250, 32, 22, Muted, TextAnchor.MiddleRight);
            switch (state.Page)
            {
                case PresentationUiPage.RoleSelection:
                    Title("How will you join?", "Choose your role.");
                    AddRoleCard("Audience", "Watch", "Join with a code", 28, () => RoleSelected?.Invoke(PresentationUiRole.Audience));
                    AddRoleCard("Presenter", "Present", "Lead a rehearsal", -122, () => RoleSelected?.Invoke(PresentationUiRole.Presenter), true);
                    break;
                case PresentationUiPage.RoomCode:
                    Title("Room code", "Enter six digits.");
                    var code = RoundedBox("Code field", panel.transform, 0, 96, 660, 74, Surface);
                    roomText = Text("RoomCode", "", 0, 0, 620, 64, 44, Color.white, parent: code.transform);
                    for (int index = 0; index < 9; index++)
                    {
                        char digit = (char)('1' + index);
                        AddButton("Digit" + digit, digit.ToString(), (index % 3 - 1) * 126 - 86, 6 - index / 3 * 80, 110, 66, () => AppendRoomCode(digit), fontSize: 40);
                    }
                    AddButton("Backspace", "Del", -212, -234, 110, 66, BackspaceRoomCode);
                    AddButton("Digit0", "0", -86, -234, 110, 66, () => AppendRoomCode('0'), fontSize: 40);
                    AddButton("Join", "Join", 242, -94, 190, 100, () => RoomJoinRequested?.Invoke(roomDraft), true);
                    AddBack();
                    RefreshRoomCode();
                    break;
                case PresentationUiPage.AuthenticationPreview:
                    Title("Get ready", "Try a local rehearsal.");
                    DrawPreviewMark();
                    Text("AuthNotice", "No sign-in needed.", 0, -76, 660, 54, 34, Muted);
                    AddButton("ContinuePreview", "Continue", 0, -204, 660, 98, () => AuthenticationPreviewContinued?.Invoke(), true);
                    AddBack();
                    break;
                case PresentationUiPage.RoomSetup:
                    Title("Your presentation", "Choose what to rehearse.");
                    AddRoleCard("SamplePresentation", "Unframe rehearsal", "24 scenes", 16, () => PresentationSelected?.Invoke("sample"), !string.IsNullOrEmpty(state.PresentationId));
                    var create = AddButton("CreateRoom", "Get started", 0, -172, 660, 98, () => CreateRoomRequested?.Invoke(), true);
                    create.interactable = !string.IsNullOrEmpty(state.PresentationId);
                    AddBack();
                    break;
                case PresentationUiPage.Calibration:
                    Title(state.CalibrationComplete ? "You're ready" : "Find the marker",
                        state.CalibrationComplete ? "Start when you're ready." : "Keep the full marker in view.");
                    Text("MarkerSymbol", state.CalibrationComplete ? "OK" : "+", 0, 38, 180, 110, 72, Mint);
                    markerText = Text("MarkerStatus", "", 0, -68, 680, 76, 30, Color.white);
                    CreateProgress();
                    if (state.CalibrationComplete)
                    {
                        AddButton("Start", "Start presentation", 0, -226, 660, 98, () => StartRequested?.Invoke(), true);
                        AddButton("Exit", "Exit", 272, -313, 190, 54, () => ExitRequested?.Invoke(), fontSize: 32);
                    }
                    else
                    {
                        AddButton("RetryCamera", "Retry camera", -164, -246, 312, 86, () => RetryCameraRequested?.Invoke());
                        AddButton("Exit", "Exit", 164, -246, 312, 86, () => ExitRequested?.Invoke());
                    }
                    break;
                case PresentationUiPage.Presenting:
                    eventText = Text("Event", "", 260, 132, 220, 32, 24, Muted, TextAnchor.MiddleRight);
                    var card = RoundedBox("Next action", panel.transform, 0, 34, 744, 144, Surface);
                    guidanceIcon = RoundedBox("Motion icon", card.transform, -304, 0, 86, 86, new Color(0.10f, 0.25f, 0.23f)).rectTransform;
                    guidanceTitle = Text("Guidance Title", "Next slide", 28, 34, 524, 50, 38, Color.white, TextAnchor.MiddleLeft, card.transform);
                    guidanceInstruction = Text("Guidance Instruction", "Press A or Next", 28, -23, 524, 62, 26, Muted, TextAnchor.MiddleLeft, card.transform);
                    var next = AddButton("Next", "Next / A", -208, -106, 280, 72, () => NextRequested?.Invoke(), true);
                    next.interactable = state.CanControlPresentation;
                    next.gameObject.SetActive(state.CanControlPresentation);
                    AddButton("Remeasure", "Align", state.CanControlPresentation ? 54 : -146, -106, state.CanControlPresentation ? 208 : 360, 72, () => RemeasureRequested?.Invoke());
                    AddButton("Exit", "Exit", state.CanControlPresentation ? 262 : 216, -106, state.CanControlPresentation ? 172 : 280, 72, () => ExitRequested?.Invoke());
                    break;
                case PresentationUiPage.ExitConfirmation:
                    Title("Leave presentation?", "Your progress will reset.");
                    AddButton("CancelExit", "Stay", 0, 18, 660, 104, () => ExitCancelled?.Invoke(), true);
                    AddButton("ConfirmExit", "Leave", 0, -126, 660, 104, () => ExitConfirmed?.Invoke());
                    break;
            }
            panel.SetActive(isActiveAndEnabled);
        }

        private void Title(string title, string subtitle)
        {
            Text("Title", title, 0, 226, 720, 64, 48, Color.white).fontStyle = FontStyle.Bold;
            Text("Subtitle", subtitle, 0, 158, 700, 52, 30, Muted);
        }

        private void AddBack() => AddButton("Back", "Back", -274, -313, 190, 54, () => BackRequested?.Invoke(), fontSize: 32);

        private void RefreshRoomCode()
        {
            if (roomText != null) roomText.text = roomDraft.PadRight(6, '_');
            var join = FindButton("Join");
            if (join != null) join.interactable = roomDraft.Length == 6;
        }

        private void CreateProgress()
        {
            var track = RoundedBox("Progress", panel.transform, 0, -145, ProgressWidth, 16, new Color(0.12f, 0.18f, 0.23f));
            progressFill = RoundedBox("Progress Fill", track.transform, 0, 0, 0, 16, Mint);
            var rect = progressFill.rectTransform;
            rect.anchorMin = new Vector2(0, 0.5f);
            rect.anchorMax = new Vector2(0, 0.5f);
            rect.pivot = new Vector2(0, 0.5f);
        }

        private void AddRoleCard(string name, string title, string caption, float y, Action action, bool primary = false)
        {
            var button = AddButton(name, title, 0, y, 660, 124, action, primary, 40);
            var label = button.GetComponentInChildren<Text>();
            label.rectTransform.anchoredPosition = new Vector2(-24, 22);
            label.rectTransform.sizeDelta = new Vector2(552, 54);
            label.alignment = TextAnchor.MiddleLeft;
            Text(name + " Caption", caption, -24, -27, 552, 38, 26, primary ? new Color(0.05f, 0.25f, 0.22f) : Muted, TextAnchor.MiddleLeft, button.transform);
            Text(name + " Chevron", ">", 288, 0, 38, 54, 40, primary ? new Color(0.025f, 0.12f, 0.1f) : Mint, parent: button.transform);
        }

        private Text Text(string name, string content, float x, float y, float width, float height, int size, Color color, TextAnchor alignment = TextAnchor.MiddleCenter, Transform parent = null)
        {
            var child = new GameObject(name, typeof(RectTransform), typeof(Text));
            child.transform.SetParent(parent != null ? parent : panel.transform, false);
            var text = child.GetComponent<Text>();
            text.rectTransform.anchoredPosition = new Vector2(x, y);
            text.rectTransform.sizeDelta = new Vector2(width, height);
            text.text = content;
            text.font = font;
            text.fontSize = size;
            text.alignment = alignment;
            text.color = color;
            text.supportRichText = false;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false;
            return text;
        }

        private Button AddButton(string name, string label, float x, float y, float width, float height, Action action, bool primary = false, int fontSize = 36)
        {
            var image = RoundedBox(name, panel.transform, x, y, width, height, primary ? Mint : Surface);
            var button = image.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            image.raycastTarget = true;
            button.onClick.AddListener(() => action());
            var colors = button.colors;
            colors.highlightedColor = new Color(0.85f, 1f, 0.96f);
            colors.pressedColor = new Color(0.57f, 0.77f, 0.72f);
            colors.disabledColor = new Color(0.47f, 0.51f, 0.53f, 0.7f);
            button.colors = colors;
            Text(name + " Label", label, 0, 0, width - 30, height - 12, fontSize, primary ? new Color(0.025f, 0.12f, 0.1f) : Color.white, parent: image.transform).fontStyle = FontStyle.Bold;
            buttons.Add(button);
            return button;
        }

        private Image RoundedBox(string name, Transform parent, float x, float y, float width, float height, Color color)
        {
            var child = new GameObject(name, typeof(RectTransform), typeof(Image));
            child.transform.SetParent(parent, false);
            var image = child.GetComponent<Image>();
            image.rectTransform.anchoredPosition = new Vector2(x, y);
            image.rectTransform.sizeDelta = new Vector2(width, height);
            SetRounded(image, color);
            return image;
        }

        private void SetRounded(Image image, Color color)
        {
            image.sprite = roundedSprite;
            image.type = Image.Type.Sliced;
            image.color = color;
            image.raycastTarget = false;
        }

        private void EnsureRoundedSprite()
        {
            if (roundedSprite != null) return;
            const int size = 64;
            const float radius = 24;
            roundedTexture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            { name = "Presentation UI corners", hideFlags = HideFlags.DontSave, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float dx = Mathf.Max(Mathf.Abs(x - 31.5f) - (size * 0.5f - radius), 0);
                    float dy = Mathf.Max(Mathf.Abs(y - 31.5f) - (size * 0.5f - radius), 0);
                    pixels[y * size + x] = new Color(1, 1, 1, Mathf.Clamp01(radius + 0.5f - Mathf.Sqrt(dx * dx + dy * dy)));
                }
            roundedTexture.SetPixels(pixels);
            roundedTexture.Apply();
            roundedSprite = Sprite.Create(roundedTexture, new Rect(0, 0, size, size), Vector2.one * 0.5f, 100, 0, SpriteMeshType.FullRect, Vector4.one * radius);
            roundedSprite.name = "Presentation UI rounded shape";
            roundedSprite.hideFlags = HideFlags.DontSave;
        }

        private void DrawPreviewMark()
        {
            var back = RoundedBox("Preview stack", panel.transform, -10, 35, 142, 100, new Color(0.08f, 0.27f, 0.24f));
            back.rectTransform.localRotation = Quaternion.Euler(0, 0, -10);
            var front = RoundedBox("Preview front", panel.transform, 14, 50, 142, 100, Mint);
            DrawArrow(front.transform, new Vector2(-26, 0), new Vector2(26, 0), new Color(0.025f, 0.12f, 0.1f));
        }

        private void DrawGuidanceIcon(PresentationProgressGuidance guidance)
        {
            for (int index = guidanceIcon.childCount - 1; index >= 0; index--)
            {
                var child = guidanceIcon.GetChild(index).gameObject;
                child.SetActive(false);
                Release(child);
            }
            Vector2 left = new Vector2(-27, 0), right = new Vector2(27, 0);
            Vector2 down = new Vector2(0, -27), up = new Vector2(0, 27);
            switch (guidance.MotionPreset)
            {
                case ArmMotionPreset.SwipeLeft: DrawArrow(guidanceIcon, right, left, Mint); break;
                case ArmMotionPreset.SwipeRight: DrawArrow(guidanceIcon, left, right, Mint); break;
                case ArmMotionPreset.SwipeDown: DrawArrow(guidanceIcon, up, down, Mint); break;
                case ArmMotionPreset.SwipeUp: DrawArrow(guidanceIcon, down, up, Mint); break;
                case ArmMotionPreset.PushForward: DrawArrow(guidanceIcon, new Vector2(-22, -22), new Vector2(22, 22), Mint); break;
                case ArmMotionPreset.PullBackward: DrawArrow(guidanceIcon, new Vector2(22, 22), new Vector2(-22, -22), Mint); break;
                case ArmMotionPreset.SpreadHands:
                    DrawArrow(guidanceIcon, new Vector2(-4, 0), new Vector2(-30, 0), Mint);
                    DrawArrow(guidanceIcon, new Vector2(4, 0), new Vector2(30, 0), Mint);
                    break;
                case ArmMotionPreset.CloseHands:
                    DrawArrow(guidanceIcon, new Vector2(-31, 0), new Vector2(-5, 0), Mint);
                    DrawArrow(guidanceIcon, new Vector2(31, 0), new Vector2(5, 0), Mint);
                    break;
                default:
                    if (guidance.Title == "Complete")
                    {
                        DrawLine(guidanceIcon, new Vector2(-25, 0), new Vector2(-7, -17), Mint);
                        DrawLine(guidanceIcon, new Vector2(-7, -17), new Vector2(25, 21), Mint);
                    }
                    else if (guidance.Title == "Playing" || guidance.Title == "Waiting" || guidance.Title == "Watching")
                    {
                        DrawLine(guidanceIcon, new Vector2(-11, -22), new Vector2(-11, 22), Mint);
                        DrawLine(guidanceIcon, new Vector2(11, -22), new Vector2(11, 22), Mint);
                    }
                    else if (guidance.Title == "Release trigger")
                    {
                        DrawArrow(guidanceIcon, new Vector2(0, -18), new Vector2(0, 24), Mint);
                    }
                    else DrawArrow(guidanceIcon, left, right, Mint);
                    break;
            }
        }

        private void DrawArrow(Transform parent, Vector2 from, Vector2 to, Color color)
        {
            DrawLine(parent, from, to, color);
            Vector2 direction = (to - from).normalized;
            Vector2 normal = new Vector2(-direction.y, direction.x);
            DrawLine(parent, to, to - direction * 14 + normal * 11, color);
            DrawLine(parent, to, to - direction * 14 - normal * 11, color);
        }

        private void DrawLine(Transform parent, Vector2 from, Vector2 to, Color color)
        {
            Vector2 midpoint = (from + to) * 0.5f;
            var line = RoundedBox("Icon stroke", parent, midpoint.x, midpoint.y, Vector2.Distance(from, to), 7, color);
            line.rectTransform.localRotation = Quaternion.Euler(0, 0, Mathf.Atan2(to.y - from.y, to.x - from.x) * Mathf.Rad2Deg);
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
        private void OnDestroy()
        {
            DestroyPanel();
            Release(roundedSprite);
            Release(roundedTexture);
            roundedSprite = null;
            roundedTexture = null;
        }

        private static void Release(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }

        private void DestroyPanel()
        {
            if (panel != null) panel.SetActive(false);
            Release(panel);
            panel = null;
            markerText = null;
            eventText = null;
            statusLabel = null;
            guidanceTitle = null;
            guidanceInstruction = null;
            guidanceIcon = null;
            shownTitle = null;
            shownPreset = null;
            roomText = null;
            progressFill = null;
            buttons.Clear();
        }
    }
}

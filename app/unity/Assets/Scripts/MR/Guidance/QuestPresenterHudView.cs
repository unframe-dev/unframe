using Unframe.Realtime;
using UnityEngine;
using UnityEngine.UI;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestPresenterHudView : MonoBehaviour
    {
        private readonly QuestPresenterHudState state = new QuestPresenterHudState();
        private PresentationBakedRuntime runtime;
        private Transform head;
        private Camera headCamera;
        private QuestPresentationStatusView ui;
        private GameObject visuals;
        private Text label;
        private Text elapsedLabel;

        public void Configure(PresentationBakedRuntime source, Transform headTransform, QuestPresentationStatusView statusView)
        {
            Hide();
            runtime = source;
            head = headTransform;
            headCamera = head != null ? head.GetComponent<Camera>() : null;
            ui = statusView;
        }

        public static Vector3 GetPosition(Vector3 headPosition, Quaternion headRotation, float verticalFieldOfView, float aspect) =>
            QuestMotionGuideGeometry.GetHudPosition(headPosition, headRotation, verticalFieldOfView, aspect);

        private void Update()
        {
            if (runtime == null) { Hide(); return; }
            double? page = QuestPresenterHudState.ReadPageNumber(runtime.DataStore);
            state.Refresh(runtime.DataStore.Delivery?.SessionId, page,
                runtime.DataStore.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running,
                Time.realtimeSinceStartupAsDouble);
            if (head == null || headCamera == null || !runtime.IsPresenter || !runtime.SessionReady || !runtime.CalibrationReady
                || ui == null || !ui.GuidanceVisible)
            {
                Hide();
                return;
            }
            EnsureVisuals();
            visuals.SetActive(true);
            Vector3 position = GetPosition(head.position, head.rotation, headCamera.fieldOfView, headCamera.aspect);
            visuals.transform.SetPositionAndRotation(position,
                QuestMotionGuideGeometry.GetFacingRotation(position, head.position, head.rotation));
            visuals.transform.localScale = Vector3.one * (.00025f
                * QuestMotionGuideGeometry.GetViewportScale(headCamera.fieldOfView, headCamera.aspect));
            if (label.text != state.PageText) label.text = state.PageText;
            if (elapsedLabel.text != state.ElapsedText) elapsedLabel.text = state.ElapsedText;
        }

        private void EnsureVisuals()
        {
            if (visuals != null) return;
            visuals = new GameObject("Presenter status", typeof(RectTransform), typeof(Canvas));
            visuals.transform.SetParent(transform, false);
            var canvas = visuals.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.overrideSorting = true;
            canvas.sortingOrder = 10;
            QuestPresentationUiFont.ConfigureCanvas(canvas);
            var rect = visuals.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(680, 190);
            rect.localScale = Vector3.one * .00025f;
            var background = visuals.AddComponent<Image>();
            QuestPresenterUiStyle.ApplySurface(background);
            label = CreateLabel("Current page", 24, 64, 40, false);
            elapsedLabel = CreateLabel("Elapsed time", 100, 48, 32, true);
        }

        private Text CreateLabel(string name, float top, float height, int fontSize, bool secondary)
        {
            var textHost = new GameObject(name, typeof(RectTransform));
            textHost.transform.SetParent(visuals.transform, false);
            var textRect = textHost.GetComponent<RectTransform>();
            textRect.anchorMin = Vector2.up;
            textRect.anchorMax = Vector2.one;
            textRect.pivot = new Vector2(.5f, 1);
            textRect.anchoredPosition = new Vector2(0, -top);
            textRect.sizeDelta = new Vector2(-56, height);
            var text = textHost.AddComponent<Text>();
            QuestPresenterUiStyle.ConfigureText(text, fontSize, secondary);
            text.alignment = TextAnchor.MiddleLeft;
            return text;
        }

        private void Hide() { if (visuals != null) visuals.SetActive(false); }
        private void OnDisable() => Hide();
        private void OnDestroy()
        {
            if (visuals == null) return;
            visuals.SetActive(false);
            if (Application.isPlaying) Destroy(visuals); else DestroyImmediate(visuals);
        }
    }
}

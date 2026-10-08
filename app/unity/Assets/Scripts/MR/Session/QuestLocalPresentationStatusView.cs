using UnityEngine;
using UnityEngine.UI;
using Transform = UnityEngine.Transform;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestLocalPresentationStatusView : MonoBehaviour
    {
        [SerializeField] private QuestLocalPresentationControls controls;
        [SerializeField] private Transform head;
        private GameObject panel;
        private Text status;
        public string StatusText { get; private set; }

        public void Configure(QuestLocalPresentationControls localControls, Transform headTransform)
        {
            DestroyPanel();
            controls = localControls;
            head = headTransform;
            Refresh();
        }

        public void Refresh()
        {
            StatusText = controls != null ? controls.Summary : "Local presentation not configured";
            if (panel == null && head != null && Application.isPlaying) CreatePanel();
            if (status != null) status.text = StatusText;
        }

        private void OnEnable()
        {
            if (panel != null) panel.SetActive(true);
            Refresh();
        }

        private void Update() => Refresh();

        private void CreatePanel()
        {
            panel = new GameObject("Local Presentation Status", typeof(RectTransform), typeof(Canvas), typeof(Image));
            panel.transform.SetParent(head, false);
            panel.transform.localPosition = new Vector3(0, -0.48f, 1.25f);
            panel.transform.localScale = Vector3.one * 0.00075f;
            panel.GetComponent<RectTransform>().sizeDelta = new Vector2(600, 240);
            var canvas = panel.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = head.GetComponent<Camera>();
            var background = panel.GetComponent<Image>();
            background.color = new Color(0.015f, 0.025f, 0.04f, 0.9f);
            background.raycastTarget = false;
            var text = new GameObject("Status", typeof(RectTransform), typeof(Text));
            text.transform.SetParent(panel.transform, false);
            status = text.GetComponent<Text>();
            status.rectTransform.sizeDelta = new Vector2(570, 220);
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

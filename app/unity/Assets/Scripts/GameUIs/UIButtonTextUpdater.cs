using TMPro;
using UnityEngine;
using UnityEngine.UI;

public sealed class UIButtonTextUpdater : MonoBehaviour
{
    private const string DefaultClickedText = "Clicked Button";

    [SerializeField] private Button button;
    [SerializeField] private TMP_Text targetText;
    [SerializeField] private string clickedText = DefaultClickedText;

    public TMP_Text TargetText
    {
        get => targetText;
        set => targetText = value;
    }

    public string ClickedText
    {
        get => clickedText;
        set => clickedText = value;
    }

    private void Awake()
    {
        button ??= GetComponent<Button>();
    }

    private void OnEnable()
    {
        button ??= GetComponent<Button>();
        if (button != null)
        {
            button.onClick.AddListener(ApplyClickedText);
        }
    }

    private void OnDisable()
    {
        if (button != null)
        {
            button.onClick.RemoveListener(ApplyClickedText);
        }
    }

    public void ApplyClickedText()
    {
        if (targetText == null)
        {
            return;
        }

        targetText.text = string.IsNullOrWhiteSpace(clickedText) ? DefaultClickedText : clickedText;
    }
}

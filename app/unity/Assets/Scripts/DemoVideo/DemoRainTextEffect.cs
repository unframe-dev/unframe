using TMPro;
using UnityEngine;

public sealed class DemoRainTextEffect : MonoBehaviour
{
    private static readonly string[] Texts =
    {
        "空\n間\nを\n拡\n張\nす\nる",
        "身\n体\nと\n空\n間\nを\nつ\nな\nぐ",
        "新\nし\nい\n発\n表\n体\n験"
    };

    private Vector3 startPosition;
    private Vector3 endPosition;
    private float elapsed;
    private float duration;
    private TMP_Text text;
    private Color textColor;

    public static void Spawn(Transform effectRoot, Camera headCamera)
    {
        Vector3 center = headCamera != null
            ? headCamera.transform.position + headCamera.transform.forward * 2f
            : effectRoot.position + effectRoot.forward * 2f;
        center.y = headCamera != null ? headCamera.transform.position.y : effectRoot.position.y;

        for (int i = 0; i < 7; i++)
        {
            GameObject instance = new GameObject($"Demo Rain Text {i}");
            instance.transform.SetParent(effectRoot, true);
            DemoRainTextEffect effect = instance.AddComponent<DemoRainTextEffect>();
            effect.Initialize(
                Texts[i % Texts.Length],
                center + new Vector3(Random.Range(-1.4f, 1.4f), Random.Range(1.4f, 2.0f), Random.Range(-0.8f, 0.8f)),
                center + new Vector3(Random.Range(-1.4f, 1.4f), Random.Range(0.0f, 0.4f), Random.Range(-0.8f, 0.8f))
            );
        }
    }

    private void Initialize(string value, Vector3 start, Vector3 end)
    {
        text = gameObject.AddComponent<TextMeshPro>();
        text.text = value;
        text.alignment = TextAlignmentOptions.Center;
        text.fontSize = 0.18f;
        textColor = new Color(0.45f, 0.85f, 1f, 0f);
        text.color = textColor;
        startPosition = start;
        endPosition = end;
        duration = Random.Range(1.4f, 2.1f);
        transform.position = startPosition;
        transform.localScale = Vector3.one * 0.85f;
    }

    private void Update()
    {
        elapsed += Time.deltaTime;
        float t = Mathf.Clamp01(elapsed / duration);
        float eased = 1f - Mathf.Pow(1f - t, 3f);
        transform.position = Vector3.LerpUnclamped(startPosition, endPosition, eased);
        transform.localScale = Vector3.one * Mathf.Lerp(0.85f, 1f, Mathf.SmoothStep(0f, 1f, t));
        textColor.a = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(elapsed / 0.25f));
        text.color = textColor;

        if (t >= 1f)
        {
            Destroy(gameObject, 0.8f);
        }
    }
}

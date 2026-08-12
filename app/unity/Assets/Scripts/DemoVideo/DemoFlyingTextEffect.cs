using TMPro;
using UnityEngine;

public sealed class DemoFlyingTextEffect : MonoBehaviour
{
    private TMP_Text text;
    private Vector3 startPosition;
    private Vector3 direction;
    private float elapsed;
    private const float Duration = 1.1f;
    private Color textColor;

    public static void Spawn(Vector3 position, Vector3 moveDirection)
    {
        GameObject instance = new GameObject("Demo Flying Text");
        DemoFlyingTextEffect effect = instance.AddComponent<DemoFlyingTextEffect>();
        effect.Initialize(position, moveDirection);
    }

    private void Initialize(Vector3 position, Vector3 moveDirection)
    {
        text = gameObject.AddComponent<TextMeshPro>();
        text.text = "空間へ\nひらく";
        text.alignment = TextAlignmentOptions.Center;
        text.fontSize = 0.18f;
        textColor = new Color(1f, 0.7f, 0.3f, 0f);
        text.color = textColor;
        startPosition = position;
        direction = moveDirection.sqrMagnitude > 0.0001f ? moveDirection.normalized : Vector3.right;
        transform.position = position;
        transform.localScale = Vector3.zero;
    }

    private void Update()
    {
        elapsed += Time.deltaTime;
        float t = Mathf.Clamp01(elapsed / Duration);
        float eased = t * t * (3f - 2f * t);
        transform.position = startPosition + direction * (1.6f * eased);
        transform.localScale = Vector3.one * Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t * 4f));
        textColor.a = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t * 5f));
        text.color = textColor;

        if (t >= 1f)
        {
            Destroy(gameObject, 0.4f);
        }
    }
}

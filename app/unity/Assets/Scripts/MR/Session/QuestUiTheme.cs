using UnityEngine;
using UnityEngine.UI;

namespace Unframe.Unity.PresentationRuntime
{
    public static class QuestUiTheme
    {
        public static readonly Color Surface = new Color32(19, 29, 41, 255);
        public static readonly Color Text = new Color32(245, 248, 252, 255);
        public static readonly Color Muted = new Color32(184, 201, 219, 255);
        public static readonly Color Primary = new Color32(89, 235, 194, 255);
        public static readonly Color Container = new Color32(39, 55, 72, 255);
        public static readonly Color OnPrimary = Surface;
        private static Sprite rounded;
        public static void ApplySurface(Image image) => Apply(image, Surface);
        public static void ApplyButton(Image image, bool primary = true) => Apply(image, primary ? Primary : Container);
        private static void Apply(Image image, Color color)
        {
            if (rounded == null)
            {
                const int size = 64;
                var texture = new Texture2D(size, size, TextureFormat.RGBA32, false) { name = "Unframe rounded surface", hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear };
                var pixels = new Color[size * size];
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        float dx = Mathf.Max(18 - x, x - 45);
                        float dy = Mathf.Max(18 - y, y - 45);
                        float distance = Mathf.Sqrt(Mathf.Max(dx, 0) * Mathf.Max(dx, 0) + Mathf.Max(dy, 0) * Mathf.Max(dy, 0));
                        pixels[y * size + x] = new Color(1, 1, 1, Mathf.Clamp01(18 - distance));
                    }
                texture.SetPixels(pixels); texture.Apply();
                rounded = Sprite.Create(texture, new Rect(0, 0, size, size), Vector2.one * 0.5f, 100, 0, SpriteMeshType.FullRect, Vector4.one * 20);
                rounded.hideFlags = HideFlags.HideAndDontSave;
            }
            image.sprite = rounded; image.type = Image.Type.Sliced; image.color = color; image.raycastTarget = false;
        }
    }
}

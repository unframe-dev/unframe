using UnityEngine;
using UnityEngine.UI;

namespace Unframe.Unity.PresentationRuntime
{
    public static class QuestPresenterUiStyle
    {
        private static readonly Color Surface = new Color32(27, 33, 43, 200);
        private static readonly Color PrimaryText = new Color32(247, 249, 255, 255);
        private static readonly Color SecondaryText = new Color32(209, 221, 240, 255);

        public static void ApplySurface(Image image)
        {
            QuestUiTheme.ApplySurface(image);
            image.color = Surface;
            image.pixelsPerUnitMultiplier = .6f;
        }

        public static void ConfigureText(Text text, int fontSize, bool secondary = false)
        {
            text.font = QuestPresentationUiFont.Load();
            text.fontSize = fontSize;
            text.color = secondary ? SecondaryText : PrimaryText;
            text.raycastTarget = false;
            ApplyTextShadow(text);
        }

        public static void ApplyTextShadow(Text text)
        {
            var shadow = text.GetComponent<Shadow>();
            if (shadow == null) shadow = text.gameObject.AddComponent<Shadow>();
            shadow.effectColor = new Color(0, 0, 0, .8f);
            shadow.effectDistance = new Vector2(0, -1.5f);
            shadow.useGraphicAlpha = true;
        }
    }
}

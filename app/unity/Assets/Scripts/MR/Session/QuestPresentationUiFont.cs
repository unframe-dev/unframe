using System;
using UnityEngine;
using UnityEngine.UI;

namespace Unframe.Unity.PresentationRuntime
{
    public static class QuestPresentationUiFont
    {
        public static void ConfigureCanvas(Canvas canvas)
        {
            const float textPixelDensity = 2;
            var scaler = canvas.GetComponent<CanvasScaler>();
            if (scaler == null) scaler = canvas.gameObject.AddComponent<CanvasScaler>();
            // Increase glyph rasterization density without changing the world-space layout.
            scaler.dynamicPixelsPerUnit = textPixelDensity;
            canvas.scaleFactor = textPixelDensity;
        }

        public static Font Load()
        {
            Font font = Resources.Load<Font>("PresentationUi/NotoSansCJKjp-Regular");
            if (font == null) throw new InvalidOperationException("presentation-ui-font-missing");
            return font;
        }
    }
}

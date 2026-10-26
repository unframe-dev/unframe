using System;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public static class QuestPresentationUiFont
    {
        public static Font Load()
        {
            Font font = Resources.Load<Font>("PresentationUi/NotoSansCJKjp-Regular");
            if (font == null) throw new InvalidOperationException("presentation-ui-font-missing");
            return font;
        }
    }
}

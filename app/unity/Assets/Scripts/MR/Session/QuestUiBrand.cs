using System;
using UnityEngine;
using UnityEngine.UI;

namespace Unframe.Unity.PresentationRuntime
{
    public static class QuestUiBrand
    {
        public static RectTransform Create(Transform parent, Vector2 position, int fontSize = 28)
        {
            var logoTexture = Resources.Load<Texture2D>("Brand/UnframeLogo");
            if (logoTexture == null) throw new InvalidOperationException("unframe-brand-logo-missing");

            var brand = new GameObject("Brand", typeof(RectTransform)).GetComponent<RectTransform>();
            brand.SetParent(parent, false);
            brand.anchoredPosition = position;
            float logoSize = fontSize;
            float gap = fontSize * .2f;
            float wordmarkWidth = fontSize * 4.6f;
            float width = logoSize + gap + wordmarkWidth;
            brand.sizeDelta = new Vector2(width, fontSize * 1.6f);

            var logo = new GameObject("Logo", typeof(RectTransform), typeof(RawImage)).GetComponent<RawImage>();
            logo.transform.SetParent(brand, false);
            logo.rectTransform.sizeDelta = Vector2.one * logoSize;
            logo.rectTransform.anchoredPosition = new Vector2((logoSize - width) * .5f, 0);
            logo.texture = logoTexture;
            logo.raycastTarget = false;

            var wordmark = new GameObject("Wordmark", typeof(RectTransform), typeof(Text)).GetComponent<Text>();
            wordmark.transform.SetParent(brand, false);
            wordmark.rectTransform.sizeDelta = new Vector2(wordmarkWidth, fontSize * 1.6f);
            wordmark.rectTransform.anchoredPosition = new Vector2((logoSize + gap) * .5f, 0);
            wordmark.font = QuestPresentationUiFont.Load();
            wordmark.fontSize = fontSize;
            wordmark.text = "Unframe";
            wordmark.color = QuestUiTheme.Text;
            wordmark.alignment = TextAnchor.MiddleLeft;
            wordmark.supportRichText = false;
            wordmark.raycastTarget = false;
            return brand;
        }
    }
}

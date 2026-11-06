using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;

public sealed class QuestUiBrandTests
{
    [Test]
    public void MenusUseTheUnframePalette()
    {
        Assert.That(QuestUiTheme.Primary, Is.EqualTo((Color)new Color32(152, 68, 75, 255)));
        Assert.That(QuestUiTheme.Surface, Is.EqualTo((Color)new Color32(247, 247, 245, 255)));
        Assert.That(QuestUiTheme.Text, Is.EqualTo((Color)new Color32(23, 24, 28, 255)));
    }

    [Test]
    public void BrandPairsTheExistingLogoWithUnframeWithoutInterceptingInput()
    {
        var host = new GameObject("Brand host", typeof(RectTransform));
        try
        {
            RectTransform brand = QuestUiBrand.Create(host.transform, new Vector2(0, 365));
            Assert.That(brand.anchoredPosition, Is.EqualTo(new Vector2(0, 365)));
            var logo = brand.Find("Logo").GetComponent<RawImage>();
            var wordmark = brand.Find("Wordmark").GetComponent<Text>();
            Assert.That(logo.texture, Is.SameAs(Resources.Load<Texture2D>("Brand/UnframeLogo")));
            Assert.That(logo.texture, Is.Not.Null);
            Assert.That(wordmark.text, Is.EqualTo("Unframe"));
            Assert.That(wordmark.font, Is.Not.Null);
            Assert.That(wordmark.color, Is.EqualTo(QuestUiTheme.Text));
            Assert.That(logo.rectTransform.anchoredPosition.x, Is.LessThan(wordmark.rectTransform.anchoredPosition.x));
            Assert.That(logo.raycastTarget, Is.False);
            Assert.That(wordmark.raycastTarget, Is.False);
        }
        finally { Object.DestroyImmediate(host); }
    }
}

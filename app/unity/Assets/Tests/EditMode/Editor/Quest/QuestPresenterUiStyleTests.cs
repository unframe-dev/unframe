using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;

public sealed class QuestPresenterUiStyleTests
{
    [Test]
    public void PresenterSurfaceReusesRoundedThemeWithoutChangingOpaqueMenuSurfaces()
    {
        var menuHost = new GameObject("Menu surface", typeof(RectTransform), typeof(Image));
        var presenterHost = new GameObject("Presenter surface", typeof(RectTransform), typeof(Image));
        try
        {
            Image menu = menuHost.GetComponent<Image>();
            QuestUiTheme.ApplySurface(menu);
            Image presenter = presenterHost.GetComponent<Image>();
            QuestPresenterUiStyle.ApplySurface(presenter);
            Assert.That(presenter.sprite, Is.SameAs(menu.sprite));
            Assert.That(presenter.type, Is.EqualTo(Image.Type.Sliced));
            Assert.That(presenter.sprite.border.x, Is.GreaterThan(0));
            Assert.That(presenter.color.a, Is.InRange(.7f, .95f));
            Assert.That(presenter.raycastTarget, Is.False);
            Assert.That(menu.color.a, Is.EqualTo(1));
        }
        finally
        {
            Object.DestroyImmediate(menuHost);
            Object.DestroyImmediate(presenterHost);
        }
    }

    [Test]
    public void TextOnlyLabelsRemainReadableAndNonInteractiveWithoutAddingASurface()
    {
        var host = new GameObject("Floating label", typeof(RectTransform), typeof(Text));
        try
        {
            Text text = host.GetComponent<Text>();
            text.alignment = TextAnchor.MiddleLeft;
            QuestPresenterUiStyle.ConfigureText(text, 36);
            Assert.That(text.font, Is.SameAs(QuestPresentationUiFont.Load()));
            Assert.That(text.fontSize, Is.EqualTo(36));
            Assert.That(text.alignment, Is.EqualTo(TextAnchor.MiddleLeft));
            Assert.That(text.color.a, Is.EqualTo(1));
            Assert.That(text.raycastTarget, Is.False);
            Assert.That(host.GetComponent<Image>(), Is.Null);
            Shadow shadow = host.GetComponent<Shadow>();
            Assert.That(shadow, Is.Not.Null);
            Assert.That(shadow.effectColor.a, Is.GreaterThan(.5f));
            Assert.That(shadow.effectDistance.sqrMagnitude, Is.GreaterThan(0));
            QuestPresenterUiStyle.ConfigureText(text, 28, true);
            Assert.That(text.fontSize, Is.EqualTo(28));
            Assert.That(text.color.a, Is.GreaterThanOrEqualTo(.9f));
            Assert.That(host.GetComponents<Shadow>().Length, Is.EqualTo(1));
        }
        finally { Object.DestroyImmediate(host); }
    }
}

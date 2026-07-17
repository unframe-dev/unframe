using NUnit.Framework;
using TMPro;
using UnityEngine;

public class TextElementFactoryEditModeTests
{
    private GameObject factoryObject;
    private GameObject createdText;

    [TearDown]
    public void TearDown()
    {
        if (createdText != null)
        {
            Object.DestroyImmediate(createdText);
        }

        if (factoryObject != null)
        {
            Object.DestroyImmediate(factoryObject);
        }
    }

    [Test]
    public void Create_UsesJapaneseDefaultFont()
    {
        factoryObject = new GameObject("TextElementFactoryTest");
        TextElementFactory factory = factoryObject.AddComponent<TextElementFactory>();

        createdText = factory.Create(
            new ManifestElement { type = "text", id = "text-1", text = "日本語の資料" },
            null
        );

        TextMeshPro textMesh = createdText.GetComponent<TextMeshPro>();

        Assert.That(textMesh.font, Is.Not.Null);
        Assert.That(textMesh.font.name, Is.EqualTo("SawarabiGothic-Regular SDF"));
    }

    [Test]
    public void Create_UsesLargeFallbackFontSize()
    {
        factoryObject = new GameObject("TextElementFactoryTest");
        TextElementFactory factory = factoryObject.AddComponent<TextElementFactory>();

        createdText = factory.Create(
            new ManifestElement
            {
                type = "text",
                id = "text-1",
                text = "サイズ確認",
                transform = new ManifestTransform
                {
                    position = new ManifestVector3(),
                    rotation = new ManifestVector3(),
                    scale = new ManifestVector3 { x = 100f, y = 100f, z = 1f }
                }
            },
            null
        );

        TextMeshPro textMesh = createdText.GetComponent<TextMeshPro>();

        Assert.That(createdText.transform.localScale.x, Is.EqualTo(2.8f).Within(0.0001f));
        Assert.That(createdText.transform.localScale.y, Is.EqualTo(2.8f).Within(0.0001f));
        Assert.That(textMesh.enableAutoSizing, Is.True);
        Assert.That(textMesh.fontSizeMin, Is.EqualTo(0.03f).Within(0.0001f));
    }
}

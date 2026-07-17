using NUnit.Framework;
using UnityEngine;

public class ElementFadeInEditModeTests
{
    private GameObject target;
    private GameObject builderObject;
    private GameObject builtRoot;

    [TearDown]
    public void TearDown()
    {
        if (target != null)
        {
            Object.DestroyImmediate(target);
        }

        if (builtRoot != null)
        {
            Object.DestroyImmediate(builtRoot);
        }

        if (builderObject != null)
        {
            Object.DestroyImmediate(builderObject);
        }
    }

    [Test]
    public void Play_FadesChildRenderersWithoutChangingSharedMaterial()
    {
        target = new GameObject("FadeTarget");
        GameObject child = GameObject.CreatePrimitive(PrimitiveType.Quad);
        child.transform.SetParent(target.transform, false);

        Renderer renderer = child.GetComponent<Renderer>();
        Material original = PresentationPlaneMaterialFactory.CreateSolid(new Color(0.2f, 0.4f, 0.6f, 0.8f));
        renderer.sharedMaterial = original;

        ElementFadeIn fade = target.AddComponent<ElementFadeIn>();
        fade.Configure(2f, 0.25f);
        fade.Play();

        Assert.That(fade.Duration, Is.EqualTo(2f));
        Assert.That(fade.Delay, Is.EqualTo(0.25f));
        Assert.That(fade.IsPlaying, Is.True);
        Assert.That(renderer.sharedMaterial, Is.Not.SameAs(original));
        Assert.That(ReadAlpha(renderer.sharedMaterial), Is.EqualTo(0f).Within(0.001f));

        fade.Complete();

        Assert.That(fade.IsPlaying, Is.False);
        Assert.That(renderer.sharedMaterial, Is.SameAs(original));
        Assert.That(ReadAlpha(original), Is.EqualTo(0.8f).Within(0.001f));

        Object.DestroyImmediate(original);
    }

    [Test]
    public void Attach_AddsConfiguredFadeOnlyForSupportedAnimation()
    {
        target = new GameObject("AnimationTarget");

        ElementFadeIn fade = PresentationElementAnimationFactory.Attach(
            target,
            new ManifestElementAnimation { type = "fade", duration = 0.6f, delay = 0.1f }
        );

        Assert.That(fade, Is.Not.Null);
        Assert.That(target.GetComponent<ElementFadeIn>(), Is.SameAs(fade));
        Assert.That(fade.Duration, Is.EqualTo(0.6f));
        Assert.That(fade.Delay, Is.EqualTo(0.1f));

        GameObject unsupportedTarget = new GameObject("UnsupportedAnimationTarget");
        try
        {
            ElementFadeIn unsupported = PresentationElementAnimationFactory.Attach(
                unsupportedTarget,
                new ManifestElementAnimation { type = "slide-in", duration = 0.6f }
            );

            Assert.That(unsupported, Is.Null);
            Assert.That(unsupportedTarget.GetComponent<ElementFadeIn>(), Is.Null);
        }
        finally
        {
            Object.DestroyImmediate(unsupportedTarget);
        }
    }

    [Test]
    public void JsonUtility_ParsesElementAnimationContract()
    {
        const string json =
            "{\"type\":\"model\",\"id\":\"model-1\"," +
            "\"animation\":{\"type\":\"fade\",\"duration\":1.25,\"delay\":0.2}}";

        ManifestElement element = JsonUtility.FromJson<ManifestElement>(json);

        Assert.That(element.animation, Is.Not.Null);
        Assert.That(element.animation.type, Is.EqualTo("fade"));
        Assert.That(element.animation.duration, Is.EqualTo(1.25f));
        Assert.That(element.animation.delay, Is.EqualTo(0.2f));
    }

    [Test]
    public void BuildFromJson_AttachesAnimationOnlyToConfiguredElement()
    {
        const string json =
            "{\"presentationId\":\"animated-presentation\",\"title\":\"Animated\"," +
            "\"slides\":[{\"id\":\"slide-1\",\"orderIndex\":0,\"elements\":[" +
            "{\"type\":\"shape\",\"id\":\"animated\",\"shape\":\"rectangle\"," +
            "\"animation\":{\"type\":\"fade\",\"duration\":0.8}} ," +
            "{\"type\":\"shape\",\"id\":\"static\",\"shape\":\"rectangle\"}" +
            "]}]}";

        builderObject = new GameObject("PresentationBuilderTest");
        PresentationBuilder builder = builderObject.AddComponent<PresentationBuilder>();
        builderObject.AddComponent<TextElementFactory>();
        builderObject.AddComponent<ImageElementFactory>();
        builderObject.AddComponent<ModelElementFactory>();

        BuiltPresentation built = builder.BuildFromJson(json);
        builtRoot = built.presentationRoot;

        ElementFadeIn fade = built.slides[0].objectsByElementId["animated"].GetComponent<ElementFadeIn>();
        Assert.That(fade, Is.Not.Null);
        Assert.That(fade.Duration, Is.EqualTo(0.8f));
        Assert.That(
            built.slides[0].objectsByElementId["static"].GetComponent<ElementFadeIn>(),
            Is.Null
        );
    }

    private static float ReadAlpha(Material material)
    {
        if (material.HasProperty("_BaseColor"))
        {
            return material.GetColor("_BaseColor").a;
        }

        return material.GetColor("_Color").a;
    }
}

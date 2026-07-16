using NUnit.Framework;
using System.Reflection;
using TMPro;
using UnityEngine;
using UnityEngine.Rendering;

public class PresentationBuilderEditModeTests
{
    private const string JsonWithRenderableElements =
        "{"
        + "\"presentationId\":\"presentation-1\","
        + "\"title\":\"Renderable Elements\","
        + "\"slides\":[{"
        + "\"id\":\"slide-1\","
        + "\"orderIndex\":0,"
        + "\"elements\":["
        + "{"
        + "\"type\":\"text\","
        + "\"id\":\"text-1\","
        + "\"transform\":{\"position\":{\"x\":0,\"y\":1,\"z\":2},\"rotation\":{\"x\":0,\"y\":180,\"z\":0},\"scale\":{\"x\":1,\"y\":1,\"z\":1}},"
        + "\"text\":\"Hello\""
        + "},"
        + "{"
        + "\"type\":\"image\","
        + "\"id\":\"image-1\","
        + "\"transform\":{\"position\":{\"x\":-1,\"y\":1,\"z\":2},\"rotation\":{\"x\":0,\"y\":180,\"z\":0},\"scale\":{\"x\":1,\"y\":1,\"z\":1}},"
        + "\"asset\":{\"assetId\":\"asset-image-1\",\"url\":\"\",\"filename\":\"sample.png\",\"mimeType\":\"image/png\",\"sizeBytes\":128}"
        + "},"
        + "{"
        + "\"type\":\"model\","
        + "\"id\":\"model-1\","
        + "\"transform\":{\"position\":{\"x\":1,\"y\":1,\"z\":2},\"rotation\":{\"x\":0,\"y\":45,\"z\":0},\"scale\":{\"x\":0.5,\"y\":0.5,\"z\":0.5}},"
        + "\"asset\":{\"assetId\":\"asset-model-1\",\"url\":\"\",\"filename\":\"sample.fbx\",\"mimeType\":\"application/octet-stream\",\"sizeBytes\":256}"
        + "}"
        + "]"
        + "}],"
        + "\"updatedAt\":\"2026-05-29T00:00:00.000Z\""
        + "}";

    private const string JsonWithTextOnlySlide =
        "{"
        + "\"presentationId\":\"presentation-2\","
        + "\"title\":\"Text Only\","
        + "\"slides\":[{"
        + "\"id\":\"slide-1\","
        + "\"orderIndex\":0,"
        + "\"elements\":["
        + "{"
        + "\"type\":\"text\","
        + "\"id\":\"text-1\","
        + "\"transform\":{\"position\":{\"x\":0,\"y\":1,\"z\":2},\"rotation\":{\"x\":0,\"y\":0,\"z\":0},\"scale\":{\"x\":1,\"y\":1,\"z\":1}},"
        + "\"text\":\"Hello\""
        + "}"
        + "]"
        + "}],"
        + "\"updatedAt\":\"2026-05-29T00:00:00.000Z\""
        + "}";

    private GameObject builderObject;
    private GameObject builtRoot;
    private GameObject localTestModelPrefab;

    [TearDown]
    public void TearDown()
    {
        if (builtRoot != null)
        {
            Object.DestroyImmediate(builtRoot);
        }

        if (builderObject != null)
        {
            Object.DestroyImmediate(builderObject);
        }

        if (localTestModelPrefab != null)
        {
            Object.DestroyImmediate(localTestModelPrefab);
        }
    }

    [Test]
    public void BuildFromJson_CreatesImageAndModelElementsThroughFactories()
    {
        builderObject = new GameObject("PresentationBuilderTest");
        PresentationBuilder builder = builderObject.AddComponent<PresentationBuilder>();
        builderObject.AddComponent<TextElementFactory>();
        builderObject.AddComponent<ImageElementFactory>();
        builderObject.AddComponent<ModelElementFactory>();

        BuiltPresentation built = builder.BuildFromJson(JsonWithRenderableElements);

        Assert.That(built, Is.Not.Null);
        builtRoot = built.presentationRoot;

        Assert.That(built.slides, Has.Count.EqualTo(1));

        BuiltSlide slide = built.slides[0];
        Assert.That(slide.elementIds, Is.EquivalentTo(new[] { "text-1", "image-1", "model-1" }));
        Assert.That(slide.planeAnchor, Is.Not.Null);
        Assert.That(slide.planeAnchor.name, Is.EqualTo("anker"));
        Assert.That(slide.planeAnchor.transform.parent, Is.EqualTo(slide.slideRoot.transform));
        Assert.That(slide.backgroundPanel, Is.EqualTo(slide.objectsByElementId["image-1"]));

        AssertElement(slide, "text-1", "Text_text-1", "text");
        AssertElement(slide, "image-1", "Image_image-1", "image");
        AssertElement(slide, "model-1", "Model_model-1", "model");

        Assert.That(slide.objectsByElementId["text-1"].transform.parent, Is.EqualTo(slide.planeAnchor.transform));
        Assert.That(slide.objectsByElementId["image-1"].transform.parent, Is.EqualTo(slide.planeAnchor.transform));
        Assert.That(slide.objectsByElementId["model-1"].transform.parent, Is.EqualTo(slide.slideRoot.transform));
        Assert.That(slide.objectsByElementId["text-1"].transform.localPosition.z, Is.EqualTo(0f));
        Assert.That(slide.objectsByElementId["image-1"].transform.localPosition.z, Is.GreaterThan(0f));
        float backgroundPanelSlideZ = slide.slideRoot.transform.InverseTransformPoint(slide.backgroundPanel.transform.position).z;
        Assert.That(slide.planeAnchor.transform.localPosition.z, Is.LessThan(backgroundPanelSlideZ));

        TextMeshPro text = slide.objectsByElementId["text-1"].GetComponent<TextMeshPro>();
        Assert.That(text.color, Is.EqualTo(Color.black));

        Renderer imageRenderer = slide.objectsByElementId["image-1"].GetComponent<Renderer>();
        Assert.That(imageRenderer.material.color, Is.EqualTo(Color.white));
        Assert.That(imageRenderer.material.renderQueue, Is.EqualTo((int)RenderQueue.AlphaTest));
        Assert.That(imageRenderer.material.GetTag("RenderType", false), Is.EqualTo("TransparentCutout"));
        AssertZWriteEnabled(imageRenderer.material);

        Renderer modelRenderer = slide.objectsByElementId["model-1"].GetComponent<Renderer>();
        Assert.That(modelRenderer, Is.Null);
    }

    [Test]
    public void BuildFromJson_UsesAssignedLocalTestModelForAllModelElements()
    {
        builderObject = new GameObject("PresentationBuilderTest");
        PresentationBuilder builder = builderObject.AddComponent<PresentationBuilder>();
        builderObject.AddComponent<TextElementFactory>();
        builderObject.AddComponent<ImageElementFactory>();
        ModelElementFactory modelElementFactory = builderObject.AddComponent<ModelElementFactory>();

        localTestModelPrefab = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        localTestModelPrefab.name = "LocalTestModelPrefab";
        SetLocalTestModelPrefab(modelElementFactory, localTestModelPrefab);

        BuiltPresentation built = builder.BuildFromJson(JsonWithRenderableElements);

        Assert.That(built, Is.Not.Null);
        builtRoot = built.presentationRoot;

        GameObject modelObject = built.slides[0].objectsByElementId["model-1"];
        Assert.That(modelObject.name, Is.EqualTo("Model_model-1"));
        Assert.That(modelObject.GetComponent<Renderer>(), Is.Not.Null);
        Assert.That(modelObject, Is.Not.SameAs(localTestModelPrefab));
    }

    [Test]
    public void BuildFromJson_CreatesFallbackBackgroundPanelForTextOnlySlides()
    {
        builderObject = new GameObject("PresentationBuilderTest");
        PresentationBuilder builder = builderObject.AddComponent<PresentationBuilder>();
        builderObject.AddComponent<TextElementFactory>();
        builderObject.AddComponent<ImageElementFactory>();
        builderObject.AddComponent<ModelElementFactory>();

        BuiltPresentation built = builder.BuildFromJson(JsonWithTextOnlySlide);

        Assert.That(built, Is.Not.Null);
        builtRoot = built.presentationRoot;

        BuiltSlide slide = built.slides[0];
        Assert.That(slide.planeAnchor, Is.Not.Null);
        Assert.That(slide.backgroundPanel, Is.Not.Null);
        Assert.That(slide.backgroundPanel.name, Is.EqualTo("BackgroundPanel_slide-1"));
        Assert.That(slide.backgroundPanel.transform.parent, Is.EqualTo(slide.planeAnchor.transform));
        Assert.That(slide.objectsByElementId["text-1"].transform.parent, Is.EqualTo(slide.planeAnchor.transform));
        Assert.That(slide.objectsByElementId["text-1"].transform.localPosition.z, Is.EqualTo(0f));
        Assert.That(slide.backgroundPanel.transform.localPosition.z, Is.GreaterThan(0f));

        Material backgroundMaterial = slide.backgroundPanel.GetComponent<Renderer>().material;
        Assert.That(backgroundMaterial.renderQueue, Is.EqualTo((int)RenderQueue.AlphaTest));
        Assert.That(backgroundMaterial.GetTag("RenderType", false), Is.EqualTo("TransparentCutout"));
        AssertZWriteEnabled(backgroundMaterial);
    }

    [Test]
    public void SlideController_ShowsOnlyCurrentSlide()
    {
        GameObject controllerObject = new GameObject("SlideControllerTest");
        GameObject slideRoot1 = new GameObject("Slide_0");
        GameObject slideRoot2 = new GameObject("Slide_1");

        try
        {
            SlideController slideController = controllerObject.AddComponent<SlideController>();
            BuiltPresentation presentation = new BuiltPresentation();
            presentation.slides.Add(new BuiltSlide { slideId = "slide-1", orderIndex = 0, slideRoot = slideRoot1 });
            presentation.slides.Add(new BuiltSlide { slideId = "slide-2", orderIndex = 1, slideRoot = slideRoot2 });

            slideController.SetPresentation(presentation);

            Assert.That(slideRoot1.activeSelf, Is.True);
            Assert.That(slideRoot2.activeSelf, Is.False);

            slideController.NextSlide();

            Assert.That(slideRoot1.activeSelf, Is.False);
            Assert.That(slideRoot2.activeSelf, Is.True);
        }
        finally
        {
            Object.DestroyImmediate(controllerObject);
            Object.DestroyImmediate(slideRoot1);
            Object.DestroyImmediate(slideRoot2);
        }
    }

    private static void AssertElement(BuiltSlide slide, string elementId, string objectName, string elementType)
    {
        Assert.That(slide.objectsByElementId.ContainsKey(elementId), Is.True);

        GameObject elementObject = slide.objectsByElementId[elementId];
        Assert.That(elementObject.name, Is.EqualTo(objectName));

        PresentationElementObject meta = elementObject.GetComponent<PresentationElementObject>();
        Assert.That(meta, Is.Not.Null);
        Assert.That(meta.elementId, Is.EqualTo(elementId));
        Assert.That(meta.elementType, Is.EqualTo(elementType));
    }

    private static void SetLocalTestModelPrefab(ModelElementFactory factory, GameObject prefab)
    {
        FieldInfo field = typeof(ModelElementFactory).GetField(
            "localTestModelPrefab",
            BindingFlags.Instance | BindingFlags.NonPublic
        );

        field.SetValue(factory, prefab);
    }

    private static void AssertZWriteEnabled(Material material)
    {
        if (!material.HasProperty("_ZWrite"))
        {
            return;
        }

        Assert.That(material.GetFloat("_ZWrite"), Is.EqualTo(1f));
    }
}

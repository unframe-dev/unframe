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

    private const string JsonWithRemoteFbxModel =
        "{"
        + "\"presentationId\":\"presentation-3\","
        + "\"title\":\"Remote FBX\","
        + "\"slides\":[{"
        + "\"id\":\"slide-1\","
        + "\"orderIndex\":0,"
        + "\"elements\":["
        + "{"
        + "\"type\":\"model\","
        + "\"id\":\"model-remote-1\","
        + "\"transform\":{\"position\":{\"x\":1,\"y\":1,\"z\":2},\"rotation\":{\"x\":0,\"y\":45,\"z\":0},\"scale\":{\"x\":0.5,\"y\":0.5,\"z\":0.5}},"
        + "\"asset\":{\"assetId\":\"asset-model-remote-1\",\"url\":\"https://cdn.example.com/assets/model.fbx?token=abc\",\"filename\":\"model.fbx\",\"mimeType\":\"application/octet-stream\",\"sizeBytes\":256}"
        + "}"
        + "]"
        + "}],"
        + "\"updatedAt\":\"2026-05-29T00:00:00.000Z\""
        + "}";

    private const string JsonWithCircularElements =
        "{"
        + "\"presentationId\":\"presentation-circular\","
        + "\"title\":\"Circular\","
        + "\"slides\":[{"
        + "\"id\":\"slide-1\","
        + "\"orderIndex\":0,"
        + "\"elements\":["
        + "{"
        + "\"type\":\"text\","
        + "\"id\":\"text-circular\","
        + "\"transform\":{"
        + "\"position\":{\"x\":0,\"y\":0,\"z\":0},"
        + "\"rotation\":{\"x\":0,\"y\":0,\"z\":0},"
        + "\"scale\":{\"x\":300,\"y\":100,\"z\":1},"
        + "\"circular\":{\"enabled\":true,\"startPosition\":{\"x\":0,\"y\":1,\"z\":2},\"viewpointPosition\":{\"x\":0,\"y\":1,\"z\":0},\"radius\":2,\"angle\":90,\"faceCenter\":true}"
        + "},"
        + "\"text\":\"Right\""
        + "},"
        + "{"
        + "\"type\":\"model\","
        + "\"id\":\"model-circular\","
        + "\"transform\":{"
        + "\"position\":{\"x\":0,\"y\":0,\"z\":0},"
        + "\"rotation\":{\"x\":0,\"y\":10,\"z\":0},"
        + "\"scale\":{\"x\":0.5,\"y\":0.5,\"z\":0.5},"
        + "\"circular\":{\"enabled\":true,\"startPosition\":{\"x\":0,\"y\":1,\"z\":2},\"viewpointPosition\":{\"x\":0,\"y\":1,\"z\":0},\"radius\":2,\"angle\":180,\"faceCenter\":true}"
        + "},"
        + "\"asset\":{\"assetId\":\"asset-model-1\",\"url\":\"\",\"filename\":\"sample.fbx\",\"mimeType\":\"application/octet-stream\",\"sizeBytes\":256}"
        + "}"
        + "]"
        + "}],"
        + "\"updatedAt\":\"2026-05-29T00:00:00.000Z\""
        + "}";

    private const string JsonWithCircularViewSlides =
        "{"
        + "\"presentationId\":\"presentation-circular-view\","
        + "\"title\":\"Circular View\","
        + "\"circularView\":{\"enabled\":true,\"startPosition\":{\"x\":0,\"y\":1,\"z\":2},\"viewpointPosition\":{\"x\":0,\"y\":1,\"z\":0},\"radius\":2,\"startAngle\":0,\"angleStep\":90,\"radiusOffsets\":[0,0.5],\"verticalOffsets\":[0,0.25],\"faceViewpoint\":true},"
        + "\"slides\":["
        + "{"
        + "\"id\":\"slide-1\","
        + "\"orderIndex\":0,"
        + "\"elements\":[{\"type\":\"text\",\"id\":\"text-1\",\"transform\":{\"position\":{\"x\":0,\"y\":0,\"z\":0},\"rotation\":{\"x\":0,\"y\":0,\"z\":0},\"scale\":{\"x\":300,\"y\":100,\"z\":1}},\"text\":\"First\"}]"
        + "},"
        + "{"
        + "\"id\":\"slide-2\","
        + "\"orderIndex\":1,"
        + "\"elements\":[{\"type\":\"text\",\"id\":\"text-2\",\"transform\":{\"position\":{\"x\":0,\"y\":0,\"z\":0},\"rotation\":{\"x\":0,\"y\":0,\"z\":0},\"scale\":{\"x\":300,\"y\":100,\"z\":1}},\"text\":\"Second\"}]"
        + "}"
        + "],"
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

        Assert.That(slide.objectsByElementId["text-1"].transform.parent, Is.EqualTo(slide.slideRoot.transform));
        Assert.That(slide.objectsByElementId["image-1"].transform.parent, Is.EqualTo(slide.slideRoot.transform));
        Assert.That(slide.objectsByElementId["model-1"].transform.parent, Is.EqualTo(slide.slideRoot.transform));
        Assert.That(
            slide.objectsByElementId["text-1"].transform.localPosition.z,
            Is.EqualTo(-2f * TransformApplier.LayoutDepthPerUnit).Within(0.000001f)
        );
        Assert.That(
            slide.objectsByElementId["image-1"].transform.localPosition.z,
            Is.LessThan(slide.objectsByElementId["text-1"].transform.localPosition.z)
        );
        float backgroundPanelSlideZ = slide.slideRoot.transform.InverseTransformPoint(slide.backgroundPanel.transform.position).z;
        Assert.That(slide.planeAnchor.transform.localPosition.z, Is.LessThan(backgroundPanelSlideZ));

        TextMeshPro text = slide.objectsByElementId["text-1"].GetComponent<TextMeshPro>();
        Assert.That(
            text.color,
            Is.EqualTo(new Color(31f / 255f, 41f / 255f, 55f / 255f, 1f))
        );

        Renderer imageRenderer = slide.objectsByElementId["image-1"].GetComponent<Renderer>();
        Material imageMaterial = imageRenderer.sharedMaterial;
        Assert.That(imageMaterial.color, Is.EqualTo(Color.white));
        Assert.That(imageMaterial.renderQueue, Is.EqualTo((int)RenderQueue.Geometry));
        AssertZWriteEnabled(imageMaterial);

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
    public void BuildFromJson_AttachesRemoteFbxModelAssetState()
    {
        builderObject = new GameObject("PresentationBuilderTest");
        PresentationBuilder builder = builderObject.AddComponent<PresentationBuilder>();
        builderObject.AddComponent<TextElementFactory>();
        builderObject.AddComponent<ImageElementFactory>();
        builderObject.AddComponent<ModelElementFactory>();

        BuiltPresentation built = builder.BuildFromJson(JsonWithRemoteFbxModel);

        Assert.That(built, Is.Not.Null);
        builtRoot = built.presentationRoot;

        GameObject modelObject = built.slides[0].objectsByElementId["model-remote-1"];
        RemoteModelAsset remoteAsset = modelObject.GetComponent<RemoteModelAsset>();

        Assert.That(remoteAsset, Is.Not.Null);
        Assert.That(remoteAsset.Url, Is.EqualTo("https://cdn.example.com/assets/model.fbx?token=abc"));
        Assert.That(remoteAsset.Filename, Is.EqualTo("model.fbx"));
        Assert.That(remoteAsset.MimeType, Is.EqualTo("application/octet-stream"));
        Assert.That(remoteAsset.Status, Is.EqualTo(RemoteModelLoadStatus.Pending));
    }

    [Test]
    public void BuildFromJson_PlacesCircularElementsAroundUser()
    {
        builderObject = new GameObject("PresentationBuilderTest");
        PresentationBuilder builder = builderObject.AddComponent<PresentationBuilder>();
        builderObject.AddComponent<TextElementFactory>();
        builderObject.AddComponent<ImageElementFactory>();
        builderObject.AddComponent<ModelElementFactory>();

        BuiltPresentation built = builder.BuildFromJson(JsonWithCircularElements);

        Assert.That(built, Is.Not.Null);
        builtRoot = built.presentationRoot;

        BuiltSlide slide = built.slides[0];
        GameObject textObject = slide.objectsByElementId["text-circular"];
        GameObject modelObject = slide.objectsByElementId["model-circular"];

        Assert.That(built.presentationRoot.transform.localPosition, Is.EqualTo(Vector3.zero));
        Assert.That(textObject.transform.localPosition.x, Is.EqualTo(2f).Within(0.001f));
        Assert.That(textObject.transform.localPosition.y, Is.EqualTo(1f).Within(0.001f));
        Assert.That(textObject.transform.localPosition.z, Is.EqualTo(0f).Within(0.001f));
        Assert.That(textObject.transform.localEulerAngles.y, Is.EqualTo(90f).Within(0.001f));

        Assert.That(modelObject.transform.localPosition.x, Is.EqualTo(0f).Within(0.001f));
        Assert.That(modelObject.transform.localPosition.y, Is.EqualTo(1f).Within(0.001f));
        Assert.That(modelObject.transform.localPosition.z, Is.EqualTo(-2f).Within(0.001f));
        Assert.That(modelObject.transform.localEulerAngles.y, Is.EqualTo(10f).Within(0.001f));
    }

    [Test]
    public void BuildFromJson_PlacesSlidesAroundCircularViewpoint()
    {
        builderObject = new GameObject("PresentationBuilderTest");
        PresentationBuilder builder = builderObject.AddComponent<PresentationBuilder>();
        builderObject.AddComponent<TextElementFactory>();
        builderObject.AddComponent<ImageElementFactory>();
        builderObject.AddComponent<ModelElementFactory>();

        BuiltPresentation built = builder.BuildFromJson(JsonWithCircularViewSlides);

        Assert.That(built, Is.Not.Null);
        builtRoot = built.presentationRoot;

        Assert.That(built.usesCircularView, Is.True);
        Assert.That(built.presentationRoot.transform.localPosition, Is.EqualTo(Vector3.zero));
        Assert.That(built.slides[0].viewAngle, Is.EqualTo(0f));
        Assert.That(built.slides[0].slideRoot.transform.localPosition, Is.EqualTo(new Vector3(0f, 1f, 2f)));
        Assert.That(built.slides[1].viewAngle, Is.EqualTo(90f));
        Assert.That(built.slides[1].slideRoot.transform.localPosition.x, Is.EqualTo(-2.5f).Within(0.001f));
        Assert.That(built.slides[1].slideRoot.transform.localPosition.y, Is.EqualTo(1.25f).Within(0.001f));
        Assert.That(built.slides[1].slideRoot.transform.localPosition.z, Is.EqualTo(0f).Within(0.001f));
        Assert.That(built.slides[1].slideRoot.transform.localEulerAngles.x, Is.GreaterThan(0f));
    }

    [Test]
    public void ModelElementFactory_RecognizesFbxUrlsAndBuildsEditorCachePath()
    {
        ManifestAsset asset = new ManifestAsset
        {
            assetId = "asset/model:remote",
            url = "https://cdn.example.com/assets/model.fbx?token=abc",
            filename = "model.fbx",
            mimeType = "application/octet-stream",
            sizeBytes = 256
        };

        Assert.That(ModelElementFactory.IsSupportedFbxAsset(asset), Is.True);
        Assert.That(
            ModelElementFactory.ResolveEditorFbxCacheAssetPath(asset, "Assets/Generated/RemoteModels"),
            Is.EqualTo("Assets/Generated/RemoteModels/asset_model_remote.fbx")
        );
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
        Assert.That(slide.backgroundPanel.transform.parent, Is.EqualTo(slide.slideRoot.transform));
        Assert.That(slide.objectsByElementId["text-1"].transform.parent, Is.EqualTo(slide.slideRoot.transform));
        Assert.That(
            slide.objectsByElementId["text-1"].transform.localPosition.z,
            Is.EqualTo(-2f * TransformApplier.LayoutDepthPerUnit).Within(0.000001f)
        );
        Assert.That(slide.backgroundPanel.transform.localPosition.z, Is.GreaterThan(0f));

        Material backgroundMaterial = slide.backgroundPanel.GetComponent<Renderer>().sharedMaterial;
        Assert.That(backgroundMaterial.renderQueue, Is.EqualTo(1000));
        AssertZWriteDisabled(backgroundMaterial);
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

    [Test]
    public void SlideController_KeepsRevealedSlidesVisibleForCircularView()
    {
        GameObject controllerObject = new GameObject("SlideControllerTest");
        GameObject slideRoot1 = new GameObject("Slide_0");
        GameObject slideRoot2 = new GameObject("Slide_1");

        try
        {
            SlideController slideController = controllerObject.AddComponent<SlideController>();
            BuiltPresentation presentation = new BuiltPresentation { usesCircularView = true };
            presentation.slides.Add(new BuiltSlide { slideId = "slide-1", orderIndex = 0, slideRoot = slideRoot1 });
            presentation.slides.Add(new BuiltSlide { slideId = "slide-2", orderIndex = 1, slideRoot = slideRoot2 });

            slideController.SetPresentation(presentation);

            Assert.That(slideRoot1.activeSelf, Is.True);
            Assert.That(slideRoot2.activeSelf, Is.False);

            slideController.NextSlide();

            Assert.That(slideRoot1.activeSelf, Is.True);
            Assert.That(slideRoot2.activeSelf, Is.True);
            Assert.That(slideController.CurrentSlideIndex, Is.EqualTo(1));
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

    private static void AssertZWriteDisabled(Material material)
    {
        if (!material.HasProperty("_ZWrite"))
        {
            return;
        }

        Assert.That(material.GetFloat("_ZWrite"), Is.EqualTo(0f));
    }
}

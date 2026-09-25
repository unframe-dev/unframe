using NUnit.Framework;

public sealed class SlideManifestAdapterEditModeTests
{
    private const string ManifestJson =
        "{"
        + "\"presentationId\":\"00000000-0000-4000-8000-000000000001\","
        + "\"title\":\"API presentation\","
        + "\"slides\":["
        + "{\"id\":\"11111111-1111-4111-8111-111111111111\",\"orderIndex\":0,\"elements\":["
        + "{\"type\":\"text\",\"id\":\"21111111-1111-4111-8111-111111111111\","
        + "\"transform\":{\"position\":{\"x\":1,\"y\":2,\"z\":3},\"rotation\":{\"x\":0,\"y\":90,\"z\":0},\"scale\":{\"x\":1,\"y\":1,\"z\":1}},"
        + "\"text\":\"Hello API\"},"
        + "{\"type\":\"image\",\"id\":\"31111111-1111-4111-8111-111111111111\","
        + "\"transform\":{\"position\":{\"x\":0,\"y\":1,\"z\":2},\"rotation\":{\"x\":0,\"y\":0,\"z\":0},\"scale\":{\"x\":2,\"y\":1,\"z\":1}},"
        + "\"asset\":{\"assetId\":\"41111111-1111-4111-8111-111111111111\",\"url\":\"https://assets.example/image.png\",\"filename\":\"image.png\",\"mimeType\":\"image/png\",\"sizeBytes\":128}}"
        + "]},"
        + "{\"id\":\"12222222-2222-4222-8222-222222222222\",\"orderIndex\":1,\"elements\":["
        + "{\"type\":\"shape\",\"id\":\"22222222-2222-4222-8222-222222222222\","
        + "\"transform\":{\"position\":{\"x\":0,\"y\":0,\"z\":1},\"rotation\":{\"x\":0,\"y\":0,\"z\":0},\"scale\":{\"x\":1,\"y\":1,\"z\":1}},"
        + "\"shape\":\"ellipse\",\"fillColor\":\"#3366CC\",\"strokeColor\":\"#FFFFFF\",\"strokeWidth\":2}"
        + "]}"
        + "],"
        + "\"updatedAt\":\"2026-08-14T00:00:00.000Z\""
        + "}";

    [Test]
    public void Endpoint_BuildsManifestUrlFromBaseUrlAndUuid()
    {
        bool succeeded = ManifestApiEndpoint.TryBuildUrl(
            "https://api.example.com/",
            "00000000-0000-4000-8000-000000000001",
            out string url,
            out string error
        );

        Assert.That(succeeded, Is.True, error);
        Assert.That(
            url,
            Is.EqualTo(
                "https://api.example.com/presentations/00000000-0000-4000-8000-000000000001/manifest"
            )
        );
    }

    [Test]
    public void Adapter_ConvertsSlidesElementsTransformsAndAssetsToGroups()
    {
        bool succeeded = SlideManifestPresentationAdapter.TryConvert(
            ManifestJson,
            out PresentationDocument document,
            out string error
        );

        Assert.That(succeeded, Is.True, error);
        Assert.That(document.presentation.id, Is.EqualTo("00000000-0000-4000-8000-000000000001"));
        Assert.That(document.presentation.groups, Has.Length.EqualTo(2));
        Assert.That(document.presentation.groups[0].id, Is.EqualTo("11111111-1111-4111-8111-111111111111"));
        Assert.That(document.presentation.groups[0].elements, Has.Length.EqualTo(2));

        PresentationElement text = document.presentation.groups[0].elements[0];
        Assert.That(text.content.text, Is.EqualTo("Hello API"));
        Assert.That(text.initialState.transform.position, Is.EqualTo(new[] { 1f, 2f, 3f }));
        Assert.That(text.initialState.transform.rotation, Is.EqualTo(new[] { 0f, 90f, 0f }));

        PresentationElement image = document.presentation.groups[0].elements[1];
        Assert.That(image.assetId, Is.EqualTo("41111111-1111-4111-8111-111111111111"));
        Assert.That(document.presentation.assets, Has.Length.EqualTo(1));
        Assert.That(document.presentation.assets[0].src, Is.EqualTo("https://assets.example/image.png"));

        PresentationElement shape = document.presentation.groups[1].elements[0];
        Assert.That(shape.content.shape, Is.EqualTo("ellipse"));
        Assert.That(shape.content.fill.color, Is.EqualTo(new[] { 0.2f, 0.4f, 0.8f, 1f }));
        Assert.That(shape.content.border.enabled, Is.True);
        Assert.That(shape.content.border.width, Is.EqualTo(2f));
    }

    [Test]
    public void Adapter_OutputCanBeParsedByTheCurrentDefinitionParser()
    {
        Assert.That(
            SlideManifestPresentationAdapter.TryConvertToJson(
                ManifestJson,
                out string definitionJson,
                out string conversionError
            ),
            Is.True,
            conversionError
        );

        UnityJsonPresentationDefinitionParser parser = new UnityJsonPresentationDefinitionParser();
        Assert.That(
            parser.TryParse(definitionJson, out PresentationDocument document, out string parseError),
            Is.True,
            parseError
        );
        Assert.That(document.presentation.groups, Has.Length.EqualTo(2));
    }

    [Test]
    public void Adapter_RejectsManifestWithoutSlides()
    {
        const string json =
            "{\"presentationId\":\"00000000-0000-4000-8000-000000000001\","
            + "\"title\":\"Broken\",\"updatedAt\":\"2026-08-14T00:00:00.000Z\"}";

        Assert.That(
            SlideManifestPresentationAdapter.TryConvert(json, out _, out string error),
            Is.False
        );
        Assert.That(error, Does.Contain("slides"));
    }

    [Test]
    public void EditorApiMock_ReturnsAConvertibleManifestForItsPresentationId()
    {
        string path = $"/presentations/{ManifestApiConnectionTestServer.PresentationId}/manifest";

        Assert.That(
            ManifestApiConnectionTestServer.TryGetManifest(path, out string manifestJson),
            Is.True
        );
        Assert.That(
            SlideManifestPresentationAdapter.TryConvert(
                manifestJson,
                out PresentationDocument document,
                out string error
            ),
            Is.True,
            error
        );
        Assert.That(document.presentation.groups, Has.Length.EqualTo(1));
        Assert.That(document.presentation.groups[0].elements, Has.Length.EqualTo(2));
    }

    [Test]
    public void EditorApiMock_RejectsUnknownPresentationPaths()
    {
        Assert.That(
            ManifestApiConnectionTestServer.TryGetManifest(
                "/presentations/00000000-0000-4000-8000-000000000000/manifest",
                out _
            ),
            Is.False
        );
    }
}

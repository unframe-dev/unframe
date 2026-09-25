using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

public static class SlideManifestPresentationAdapter
{
    public static bool TryConvert(
        string manifestJson,
        out PresentationDocument document,
        out string error
    )
    {
        document = null;
        error = null;

        if (string.IsNullOrWhiteSpace(manifestJson))
        {
            error = "Manifest JSON is empty.";
            return false;
        }

        SlideManifestResponse manifest;
        try
        {
            manifest = JsonConvert.DeserializeObject<SlideManifestResponse>(manifestJson);
        }
        catch (JsonException exception)
        {
            error = $"Manifest JSON is invalid: {exception.Message}";
            return false;
        }

        if (!TryValidate(manifest, out error))
        {
            return false;
        }

        List<PresentationAsset> assets = new List<PresentationAsset>();
        HashSet<string> assetIds = new HashSet<string>();
        PresentationGroup[] groups = new PresentationGroup[manifest.slides.Length];

        for (int slideIndex = 0; slideIndex < manifest.slides.Length; slideIndex++)
        {
            SlideManifestSlide slide = manifest.slides[slideIndex];
            PresentationElement[] elements = new PresentationElement[slide.elements.Length];
            for (int elementIndex = 0; elementIndex < slide.elements.Length; elementIndex++)
            {
                SlideManifestElement sourceElement = slide.elements[elementIndex];
                elements[elementIndex] = ConvertElement(sourceElement);
                AddAsset(sourceElement, assets, assetIds);
            }

            groups[slideIndex] = new PresentationGroup
            {
                id = slide.id,
                name = $"Slide {slide.orderIndex + 1}",
                trigger = slideIndex == 0
                    ? new PresentationTrigger { type = "presentationStart" }
                    : null,
                elements = elements,
                dynamicGroups = Array.Empty<PresentationDynamicGroup>(),
                steps = Array.Empty<PresentationStep>()
            };
        }

        document = new PresentationDocument
        {
            schemaVersion = "1.0.0",
            presentation = new PresentationData
            {
                id = manifest.presentationId,
                title = manifest.title,
                stage = CreateDefaultStage(),
                assets = assets.ToArray(),
                groups = groups
            }
        };
        return true;
    }

    public static bool TryConvertToJson(
        string manifestJson,
        out string definitionJson,
        out string error
    )
    {
        definitionJson = null;
        if (!TryConvert(manifestJson, out PresentationDocument document, out error))
        {
            return false;
        }

        definitionJson = JsonConvert.SerializeObject(
            document,
            new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore }
        );
        return true;
    }

    private static bool TryValidate(SlideManifestResponse manifest, out string error)
    {
        if (manifest == null)
        {
            error = "Manifest response is missing.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(manifest.presentationId))
        {
            error = "presentationId is missing.";
            return false;
        }

        if (manifest.title == null)
        {
            error = "title is missing.";
            return false;
        }

        if (manifest.slides == null)
        {
            error = "slides is missing.";
            return false;
        }

        for (int slideIndex = 0; slideIndex < manifest.slides.Length; slideIndex++)
        {
            SlideManifestSlide slide = manifest.slides[slideIndex];
            if (slide == null || string.IsNullOrWhiteSpace(slide.id))
            {
                error = $"slides[{slideIndex}] requires an id.";
                return false;
            }

            if (slide.elements == null)
            {
                error = $"slides[{slideIndex}].elements is missing.";
                return false;
            }

            for (int elementIndex = 0; elementIndex < slide.elements.Length; elementIndex++)
            {
                if (!TryValidateElement(
                        slide.elements[elementIndex],
                        slideIndex,
                        elementIndex,
                        out error
                    ))
                {
                    return false;
                }
            }
        }

        error = null;
        return true;
    }

    private static bool TryValidateElement(
        SlideManifestElement element,
        int slideIndex,
        int elementIndex,
        out string error
    )
    {
        string path = $"slides[{slideIndex}].elements[{elementIndex}]";
        if (element == null || string.IsNullOrWhiteSpace(element.id))
        {
            error = $"{path} requires an id.";
            return false;
        }

        if (element.type != "text" &&
            element.type != "image" &&
            element.type != "model" &&
            element.type != "shape")
        {
            error = $"{path} has unsupported type '{element.type ?? "missing"}'.";
            return false;
        }

        if (element.transform?.position == null ||
            element.transform.rotation == null ||
            element.transform.scale == null)
        {
            error = $"{path}.transform is incomplete.";
            return false;
        }

        if ((element.type == "image" || element.type == "model") &&
            (element.asset == null || string.IsNullOrWhiteSpace(element.asset.assetId) ||
             string.IsNullOrWhiteSpace(element.asset.url)))
        {
            error = $"{path}.asset is incomplete.";
            return false;
        }

        error = null;
        return true;
    }

    private static PresentationElement ConvertElement(SlideManifestElement source)
    {
        ElementContent content = new ElementContent();
        if (source.type == "text")
        {
            content.text = source.text ?? string.Empty;
            content.fontSize = 0.1f;
            content.alignment = "center";
        }
        else if (source.type == "image" || source.type == "model")
        {
            content.assetId = source.asset.assetId;
            content.preserveAspectRatio = true;
        }
        else if (source.type == "shape")
        {
            content.shape = source.shape;
            content.fill = new ElementFill { color = ParseColor(source.fillColor, Color.white) };
            content.border = new ElementBorder
            {
                enabled = source.strokeWidth > 0f,
                color = ParseColor(source.strokeColor, Color.clear),
                width = source.strokeWidth
            };
        }

        return new PresentationElement
        {
            id = source.id,
            type = source.type,
            assetId = source.asset?.assetId,
            content = content,
            initialState = new ElementInitialState
            {
                active = true,
                visible = true,
                opacity = 1f,
                transform = ConvertTransform(source.transform)
            }
        };
    }

    private static void AddAsset(
        SlideManifestElement element,
        List<PresentationAsset> assets,
        HashSet<string> assetIds
    )
    {
        if (element.asset == null || !assetIds.Add(element.asset.assetId))
        {
            return;
        }

        assets.Add(new PresentationAsset
        {
            id = element.asset.assetId,
            type = element.type,
            src = element.asset.url
        });
    }

    private static TransformData ConvertTransform(SlideManifestTransform transform)
    {
        return new TransformData
        {
            position = ToArray(transform.position),
            rotation = ToArray(transform.rotation),
            scale = ToArray(transform.scale)
        };
    }

    private static float[] ToArray(SlideManifestVector3 value)
    {
        return new[] { value.x, value.y, value.z };
    }

    private static float[] ParseColor(string value, Color fallback)
    {
        Color color = !string.IsNullOrWhiteSpace(value) &&
            ColorUtility.TryParseHtmlString(value, out Color parsed)
                ? parsed
                : fallback;
        return new[] { color.r, color.g, color.b, color.a };
    }

    private static PresentationStage CreateDefaultStage()
    {
        return new PresentationStage
        {
            size = new Vector3Data { width = 10f, height = 5f, depth = 10f },
            coordinateSystem = new CoordinateSystemData
            {
                unit = "meter",
                upAxis = "y",
                horizontalAxis = "x",
                audienceDirection = "positiveZ"
            },
            zones = Array.Empty<PresentationZone>()
        };
    }
}

[Serializable]
internal sealed class SlideManifestResponse
{
    public string presentationId;
    public string title;
    public SlideManifestSlide[] slides;
    public string updatedAt;
}

[Serializable]
internal sealed class SlideManifestSlide
{
    public string id;
    public int orderIndex;
    public SlideManifestElement[] elements;
}

[Serializable]
internal sealed class SlideManifestElement
{
    public string type;
    public string id;
    public SlideManifestTransform transform;
    public string text;
    public SlideManifestAsset asset;
    public string shape;
    public string fillColor;
    public string strokeColor;
    public float strokeWidth;
}

[Serializable]
internal sealed class SlideManifestAsset
{
    public string assetId;
    public string url;
    public string filename;
    public string mimeType;
    public long sizeBytes;
}

[Serializable]
internal sealed class SlideManifestTransform
{
    public SlideManifestVector3 position;
    public SlideManifestVector3 rotation;
    public SlideManifestVector3 scale;
}

[Serializable]
internal sealed class SlideManifestVector3
{
    public float x;
    public float y;
    public float z;
}

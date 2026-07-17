using System.Collections.Generic;
using UnityEngine;

public class PresentationBuilder : MonoBehaviour
{
    private const string PlaneAnchorName = "anker";

    [SerializeField] private TextElementFactory textElementFactory;
    [SerializeField] private ImageElementFactory imageElementFactory;
    [SerializeField] private ModelElementFactory modelElementFactory;
    [SerializeField] private SlideController slideController;
    [SerializeField] private float backgroundPanelBackOffset = 0.01f;
    [SerializeField] private Vector3 defaultBackgroundPanelPosition = new Vector3(0f, 1f, 1.2f);
    [SerializeField] private Vector3 defaultBackgroundPanelScale = new Vector3(1.92f, 1.08f, 1f);

    private BuiltPresentation currentBuiltPresentation;
    private ManifestResponse currentManifest;

    private void Awake()
    {
        ResolveElementFactories();
    }

    private void Reset()
    {
        ResolveElementFactories();
    }

    public BuiltPresentation BuildFromJson(string json)
    {
        if (string.IsNullOrEmpty(json))
        {
            Debug.LogError("PresentationBuilder: json is null or empty");
            return null;
        }

        currentManifest = JsonUtility.FromJson<ManifestResponse>(json);

        if (currentManifest == null)
        {
            Debug.LogError("PresentationBuilder: failed to parse manifest json");
            return null;
        }

        return BuildFromManifest(currentManifest);
    }

    private BuiltPresentation BuildFromManifest(ManifestResponse manifest)
    {
        ResolveElementFactories();
        ClearCurrentPresentation();

        string presentationId = ResolvePresentationId(manifest);
        GameObject presentationRoot = new GameObject($"Presentation_{presentationId}");
        presentationRoot.transform.localPosition = ResolvePresentationRootPosition(manifest);


        BuiltPresentation built = new BuiltPresentation
        {
            presentationId = presentationId,
            title = manifest.title,
            presentationRoot = presentationRoot,
            usesCircularView = UsesCircularView(manifest),
            circularView = manifest.circularView
        };

        foreach (ManifestSlide slide in manifest.slides)
        {
            GameObject slideRoot = new GameObject($"Slide_{slide.orderIndex}_{slide.id}");
            slideRoot.transform.SetParent(presentationRoot.transform, false);
            slideRoot.SetActive(false);
            float slideViewAngle = ApplyCircularViewToSlideRoot(slideRoot, manifest, slide);
            LogCircularSlidePlacement(manifest, slide, slideRoot, slideViewAngle);

            ManifestElement backgroundPanelElement = FindBackgroundPanelElement(slide);
            Vector3 backgroundPanelPosition = ResolveBackgroundPanelPosition(slide, backgroundPanelElement);
            Vector3 planeAnchorPosition = ResolvePlaneAnchorPosition(backgroundPanelPosition);
            GameObject planeAnchor = CreatePlaneAnchor(slideRoot.transform, planeAnchorPosition);

            BuiltSlide builtSlide = new BuiltSlide
            {
                slideId = slide.id,
                orderIndex = slide.orderIndex,
                viewAngle = slideViewAngle,
                slideRoot = slideRoot,
                planeAnchor = planeAnchor
            };

            List<ManifestElement> elements = ResolveElements(slide);
            if (elements == null)
            {
                built.slides.Add(builtSlide);
                continue;
            }

            for (int i = 0; i < elements.Count; i++)
            {
                ManifestElement element = elements[i];

                bool isPlaneElement = IsPlaneElement(element);
                bool isBackgroundPanelElement = element == backgroundPanelElement;
                ManifestElement buildElement = CreateBuildElement(element);

                GameObject createdObject = CreateElementObject(
                    manifest,
                    slide,
                    buildElement,
                    slideRoot.transform,
                    i
                );

                if (createdObject == null)
                {
                    continue;
                }

                LogCircularElementPlacement(slide, element, createdObject);
            /*
                if (isPlaneElement)
                {
                    ApplyPlaneElementTransform(createdObject, buildElement, planeAnchorPosition, isBackgroundPanelElement);
                }
            */
                if (isBackgroundPanelElement)
                {
                    builtSlide.backgroundPanel = createdObject;
                }

                AddMetaData(createdObject, manifest, slide, element);
                PresentationElementAnimationFactory.Attach(createdObject, element.animation);

                builtSlide.elementIds.Add(element.id);
                builtSlide.objectsByElementId[element.id] = createdObject;
            }

            if (builtSlide.backgroundPanel == null && !ContainsModelElement(slide))
            {
                builtSlide.backgroundPanel = CreateDefaultBackgroundPanel(
                    slide,
                    slideRoot.transform,
                    Vector3.zero,
                    Vector3.zero
                );
            }

            built.slides.Add(builtSlide);
        }


        currentBuiltPresentation = built;

        if (slideController != null)
        {
            slideController.SetPresentation(built);
        }
        else
        {
            Debug.LogWarning("PresentationBuilder: slideController is not assigned");
        }

        Debug.Log($"Presentation built: {built.title} / slides: {built.slides.Count}");


        return built;
    }

    private static void LogCircularSlidePlacement(
        ManifestResponse manifest,
        ManifestSlide slide,
        GameObject slideRoot,
        float viewAngle
    )
    {
        if (!UsesCircularView(manifest) || slideRoot == null)
        {
            return;
        }

        ManifestCircularView circularView = manifest.circularView;
        Debug.Log(
            "[CircularView] " +
            $"slide={slide.id} orderIndex={slide.orderIndex} " +
            $"startAngle={circularView.startAngle:F2} angleStep={circularView.angleStep:F2} viewAngle={viewAngle:F2} " +
            $"startPosition={FormatVector3(circularView.startPosition)} viewpointPosition={FormatVector3(circularView.viewpointPosition)} " +
            $"radius={circularView.radius:F2} faceViewpoint={circularView.faceViewpoint} " +
            $"localPosition={FormatVector3(slideRoot.transform.localPosition)} localEuler={FormatVector3(slideRoot.transform.localEulerAngles)}"
        );
    }

    private static void LogCircularElementPlacement(
        ManifestSlide slide,
        ManifestElement element,
        GameObject createdObject
    )
    {
        if (!TransformApplier.HasCircularPlacement(element?.transform) || createdObject == null)
        {
            return;
        }

        ManifestCircularPlacement circular = element.transform.circular;
        Debug.Log(
            "[CircularElement] " +
            $"slide={slide.id} element={element.id} type={element.type} " +
            $"angle={circular.angle:F2} startPosition={FormatVector3(circular.startPosition)} " +
            $"viewpointPosition={FormatVector3(circular.viewpointPosition)} radius={circular.radius:F2} faceCenter={circular.faceCenter} " +
            $"localPosition={FormatVector3(createdObject.transform.localPosition)} localEuler={FormatVector3(createdObject.transform.localEulerAngles)} " +
            $"worldPosition={FormatVector3(createdObject.transform.position)} worldEuler={FormatVector3(createdObject.transform.eulerAngles)}"
        );
    }

    private GameObject CreateElementObject(
        ManifestResponse manifest,
        ManifestSlide slide,
        ManifestElement element,
        Transform slideParent,
        int elementOrder = 0
    )
    {
        switch (element.type)
        {
            case "text":
                return textElementFactory.Create(element, slideParent, elementOrder);

            case "image":
            case "background":
            case "shape":
                return imageElementFactory.Create(element, slideParent, elementOrder);

            case "model":
                return modelElementFactory.Create(element, slideParent, elementOrder);

            default:
                Debug.LogWarning($"Unknown element type: {element.type}");
                return null;
        }
    }

    private static GameObject CreatePlaneAnchor(Transform slideParent, Vector3 planeAnchorPosition)
    {
        GameObject planeAnchor = new GameObject(PlaneAnchorName);
        planeAnchor.transform.SetParent(slideParent, false);
        planeAnchor.transform.localPosition = planeAnchorPosition;
        planeAnchor.transform.localRotation = Quaternion.identity;
        planeAnchor.transform.localScale = Vector3.one;

        return planeAnchor;
    }

    private ManifestElement FindBackgroundPanelElement(ManifestSlide slide)
    {
        List<ManifestElement> elements = ResolveElements(slide);
        if (elements == null)
        {
            return null;
        }

        foreach (ManifestElement element in elements)
        {
            if (element != null && element.type == "background")
            {
                return element;
            }
        }

        foreach (ManifestElement element in elements)
        {
            if (element != null && element.type == "image")
            {
                return element;
            }
        }

        return null;
    }

    private Vector3 ResolveBackgroundPanelPosition(ManifestSlide slide, ManifestElement backgroundPanelElement)
    {
        if (backgroundPanelElement?.transform != null)
        {
            return TransformApplier.ToUnityCenterPosition(backgroundPanelElement.transform);
        }

        // background要素がない場合でも、スライド面の中心はUnity原点にする
        return Vector3.zero;
    }

    private ManifestElement FindFirstPlaneElement(ManifestSlide slide)
    {
        List<ManifestElement> elements = ResolveElements(slide);
        if (elements == null)
        {
            return null;
        }

        foreach (ManifestElement element in elements)
        {
            if (IsPlaneElement(element))
            {
                return element;
            }
        }

        return null;
    }

    private ManifestElement CreateBuildElement(ManifestElement element)
    {
        if (element == null)
        {
            return element;
        }

        return new ManifestElement
        {
            type = element.type,
            id = element.id,
            transform = element.transform,
            animation = element.animation,

            text = element.text,
            fontSize = element.fontSize,
            fontColor = element.fontColor,
            textAlign = element.textAlign,
            fontFamily = element.fontFamily,
            fontWeight = element.fontWeight,

            shape = element.shape,
            fillColor = element.fillColor,
            strokeColor = element.strokeColor,
            strokeWidth = element.strokeWidth,

            asset = element.asset,
            assetId = element.assetId,
            displayName = element.displayName,
            src = element.src
        };
    }


    private Vector3 ResolvePlaneAnchorPosition(Vector3 backgroundPanelPosition)
    {
        return new Vector3(
            0f,
            0f,
            backgroundPanelPosition.z - backgroundPanelBackOffset
        );
    }

    /*
    private void ApplyPlaneElementTransform(
        GameObject createdObject,
        ManifestElement element,
        Vector3 planeAnchorPosition,
        bool isBackgroundPanelElement
    )
    {
        ManifestTransform planeTransform = CreatePlaneElementTransform(
            element?.transform,
            planeAnchorPosition,
            isBackgroundPanelElement
        );

        switch (element?.type)
        {
            case "text":
                TransformApplier.ApplyUniformText(createdObject, planeTransform);
                break;

            case "image":
            case "background":
                TransformApplier.ApplyFlatPlane(createdObject, planeTransform);
                break;

            default:
                TransformApplier.Apply(createdObject, planeTransform);
                break;
        }
        }
        */


    /*
    private ManifestTransform CreatePlaneElementTransform(
    ManifestTransform sourceTransform,
    Vector3 planeAnchorPosition,
    bool isBackgroundPanelElement
    )
    {
        Vector3 sourcePosition = sourceTransform?.position != null
            ? ToVector3(sourceTransform.position)
            : Vector3.zero;

        Vector3 localPosition = new Vector3(
            sourcePosition.x - planeAnchorPosition.x,
            sourcePosition.y - planeAnchorPosition.y,
            isBackgroundPanelElement ? backgroundPanelBackOffset : 0f
        );

        return new ManifestTransform
        {
            position = ToManifestVector3(localPosition),
            rotation = sourceTransform?.rotation ?? ToManifestVector3(Vector3.zero),
            scale = sourceTransform?.scale ?? ToManifestVector3(Vector3.one)
        };
    }
    */

    private GameObject CreateDefaultBackgroundPanel(
        ManifestSlide slide,
        Transform parent,
        Vector3 backgroundPanelPosition,
        Vector3 planeAnchorPosition
    )
    {
        GameObject backgroundPanel = GameObject.CreatePrimitive(PrimitiveType.Quad);
        backgroundPanel.name = $"BackgroundPanel_{slide.id}";
        backgroundPanel.transform.SetParent(parent, false);

        // スライド中央をUnity原点に固定
        backgroundPanel.transform.localPosition = new Vector3(
            0f,
            0f,
            backgroundPanelBackOffset
        );

        backgroundPanel.transform.localRotation = Quaternion.identity;

        // 1920px x 1080px を TransformApplier と同じ変換で背景サイズにする
        backgroundPanel.transform.localScale = new Vector3(
            TransformApplier.SlideWidthPx * TransformApplier.MeterPerPixel,
            TransformApplier.SlideHeightPx * TransformApplier.MeterPerPixel,
            1f
        );

        Renderer renderer = backgroundPanel.GetComponent<Renderer>();
        if (renderer != null)
        {
            renderer.material = PresentationPlaneMaterialFactory.CreateBackground(Color.white);
        }

        return backgroundPanel;
    }

    private static bool IsPlaneElement(ManifestElement element)
    {
        return element != null &&
            (
                element.type == "text" ||
                element.type == "image" ||
                element.type == "background" ||
                element.type == "shape"
            );
    }

    private static bool ContainsModelElement(ManifestSlide slide)
    {
        List<ManifestElement> elements = ResolveElements(slide);
        if (elements == null)
        {
            return false;
        }

        foreach (ManifestElement element in elements)
        {
            if (element != null && element.type == "model")
            {
                return true;
            }
        }

        return false;
    }

    private static List<ManifestElement> ResolveElements(ManifestSlide slide)
    {
        return slide?.content?.elements ?? slide?.elements;
    }

    private static Vector3 ResolvePresentationRootPosition(ManifestResponse manifest)
    {
        return UsesCircularView(manifest) || ContainsCircularPlacement(manifest)
            ? Vector3.zero
            : new Vector3(0f, 1.5f, 1f);
    }

    private static float ApplyCircularViewToSlideRoot(
        GameObject slideRoot,
        ManifestResponse manifest,
        ManifestSlide slide
    )
    {
        if (slideRoot == null || !UsesCircularView(manifest))
        {
            return 0f;
        }

        ManifestCircularView circularView = manifest.circularView;
        float viewAngle = circularView.startAngle + slide.orderIndex * circularView.angleStep;
        float placementAngle = -viewAngle;
        float radius = circularView.radius + ResolveCircularViewOffset(circularView.radiusOffsets, slide.orderIndex);
        ManifestVector3 startPosition = OffsetCircularViewStartPosition(
            circularView.startPosition,
            ResolveCircularViewOffset(circularView.verticalOffsets, slide.orderIndex)
        );
        ManifestTransform slideTransform = new ManifestTransform
        {
            position = ToManifestVector3(Vector3.zero),
            rotation = ToManifestVector3(Vector3.zero),
            scale = ToManifestVector3(Vector3.one),
            circular = new ManifestCircularPlacement
            {
                enabled = true,
                startPosition = startPosition,
                viewpointPosition = circularView.viewpointPosition,
                radius = radius,
                angle = placementAngle,
                faceCenter = circularView.faceViewpoint
            }
        };

        slideRoot.transform.localPosition = TransformApplier.ToCircularPosition(slideTransform);
        slideRoot.transform.localEulerAngles = TransformApplier.ToFlatEulerAngles(slideTransform);
        return viewAngle;
    }

    private static float ResolveCircularViewOffset(List<float> offsets, int index)
    {
        if (offsets == null || index < 0 || index >= offsets.Count)
        {
            return 0f;
        }

        return offsets[index];
    }

    private static ManifestVector3 OffsetCircularViewStartPosition(
        ManifestVector3 source,
        float verticalOffset
    )
    {
        return new ManifestVector3
        {
            x = source != null ? source.x : 0f,
            y = (source != null ? source.y : 0f) + verticalOffset,
            z = source != null ? source.z : 1f
        };
    }

    private static bool UsesCircularView(ManifestResponse manifest)
    {
        return manifest?.circularView != null && manifest.circularView.enabled;
    }

    private static bool ContainsCircularPlacement(ManifestResponse manifest)
    {
        if (manifest?.slides == null)
        {
            return false;
        }

        foreach (ManifestSlide slide in manifest.slides)
        {
            List<ManifestElement> elements = ResolveElements(slide);
            if (elements == null)
            {
                continue;
            }

            foreach (ManifestElement element in elements)
            {
                if (TransformApplier.HasCircularPlacement(element?.transform))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static Vector3 ToVector3(ManifestVector3 vector)
    {
        return new Vector3(vector.x, vector.y, vector.z);
    }


    private static ManifestVector3 ToManifestVector3(Vector3 vector)
    {
        return new ManifestVector3
        {
            x = vector.x,
            y = vector.y,
            z = vector.z
        };
    }

    private static string FormatVector3(ManifestVector3 vector)
    {
        if (vector == null)
        {
            return "(null)";
        }

        return $"({vector.x:F3}, {vector.y:F3}, {vector.z:F3})";
    }

    private static string FormatVector3(Vector3 vector)
    {
        return $"({vector.x:F3}, {vector.y:F3}, {vector.z:F3})";
    }

    private static void SetSolidColor(GameObject target, Color color)
    {
        Renderer renderer = target.GetComponent<Renderer>();
        if (renderer == null)
        {
            Debug.LogError("PresentationBuilder: default background Renderer not found");
            return;
        }

        Material material = PresentationPlaneMaterialFactory.CreateSolid(color);
        if (material == null)
        {
            return;
        }

        renderer.material = material;
    }

    private void AddMetaData(
        GameObject obj,
        ManifestResponse manifest,
        ManifestSlide slide,
        ManifestElement element
    )
    {
        PresentationElementObject meta = obj.AddComponent<PresentationElementObject>();

        meta.presentationId = ResolvePresentationId(manifest);
        meta.slideId = slide.id;
        meta.slideIndex = slide.orderIndex;
        meta.elementId = element.id;
        meta.elementType = element.type;
    }

    private void ClearCurrentPresentation()
    {
        if (currentBuiltPresentation == null)
        {
            return;
        }

        if (currentBuiltPresentation.presentationRoot != null)
        {
            Destroy(currentBuiltPresentation.presentationRoot);
        }

        currentBuiltPresentation = null;
    }

    private void ResolveElementFactories()
    {
        if (textElementFactory == null)
        {
            textElementFactory = GetComponent<TextElementFactory>();
        }

        if (imageElementFactory == null)
        {
            imageElementFactory = GetComponent<ImageElementFactory>();
        }

        if (modelElementFactory == null)
        {
            modelElementFactory = GetComponent<ModelElementFactory>();
        }
    }

    private static string ResolvePresentationId(ManifestResponse manifest)
    {
        if (!string.IsNullOrEmpty(manifest?.presentationId))
        {
            return manifest.presentationId;
        }

        return manifest?.id;
    }
}

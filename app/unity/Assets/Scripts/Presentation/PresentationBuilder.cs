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
    [SerializeField] private Vector3 defaultBackgroundPanelScale = new Vector3(1.8f, 1.1f, 1f);

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

        GameObject presentationRoot = new GameObject($"Presentation_{manifest.presentationId}");

        BuiltPresentation built = new BuiltPresentation
        {
            presentationId = manifest.presentationId,
            title = manifest.title,
            presentationRoot = presentationRoot
        };

        foreach (ManifestSlide slide in manifest.slides)
        {
            GameObject slideRoot = new GameObject($"Slide_{slide.orderIndex}_{slide.id}");
            slideRoot.transform.SetParent(presentationRoot.transform, false);

            ManifestElement backgroundPanelElement = FindBackgroundPanelElement(slide);
            Vector3 backgroundPanelPosition = ResolveBackgroundPanelPosition(slide, backgroundPanelElement);
            Vector3 planeAnchorPosition = ResolvePlaneAnchorPosition(backgroundPanelPosition);
            GameObject planeAnchor = CreatePlaneAnchor(slideRoot.transform, planeAnchorPosition);

            BuiltSlide builtSlide = new BuiltSlide
            {
                slideId = slide.id,
                orderIndex = slide.orderIndex,
                slideRoot = slideRoot,
                planeAnchor = planeAnchor
            };

            foreach (ManifestElement element in slide.elements)
            {
                bool isPlaneElement = IsPlaneElement(element);
                bool isBackgroundPanelElement = element == backgroundPanelElement;

                GameObject createdObject = CreateElementObject(
                    manifest,
                    slide,
                    element,
                    isPlaneElement ? planeAnchor.transform : slideRoot.transform
                );

                if (createdObject == null)
                {
                    continue;
                }

                if (isPlaneElement)
                {
                    ApplyPlaneElementTransform(createdObject, element.transform, planeAnchorPosition, isBackgroundPanelElement);
                }

                if (isBackgroundPanelElement)
                {
                    builtSlide.backgroundPanel = createdObject;
                }

                AddMetaData(createdObject, manifest, slide, element);

                builtSlide.elementIds.Add(element.id);
                builtSlide.objectsByElementId[element.id] = createdObject;
            }

            if (builtSlide.backgroundPanel == null)
            {
                builtSlide.backgroundPanel = CreateDefaultBackgroundPanel(
                    slide,
                    planeAnchor.transform,
                    backgroundPanelPosition,
                    planeAnchorPosition
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

    private GameObject CreateElementObject(
        ManifestResponse manifest,
        ManifestSlide slide,
        ManifestElement element,
        Transform slideParent
    )
    {
        switch (element.type)
        {
            case "text":
                if (textElementFactory == null)
                {
                    Debug.LogError($"PresentationBuilder: textElementFactory is not assigned for element: {element.id}");
                    return null;
                }

                return textElementFactory.Create(element, slideParent);

            case "image":
            case "background":
                if (imageElementFactory == null)
                {
                    Debug.LogError($"PresentationBuilder: imageElementFactory is not assigned for element: {element.id}");
                    return null;
                }

                return imageElementFactory.Create(element, slideParent);

            case "model":
                if (modelElementFactory == null)
                {
                    Debug.LogError($"PresentationBuilder: modelElementFactory is not assigned for element: {element.id}");
                    return null;
                }

                return modelElementFactory.Create(element, slideParent);

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
        if (slide?.elements == null)
        {
            return null;
        }

        foreach (ManifestElement element in slide.elements)
        {
            if (element != null && element.type == "background")
            {
                return element;
            }
        }

        foreach (ManifestElement element in slide.elements)
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
        if (backgroundPanelElement?.transform?.position != null)
        {
            return ToVector3(backgroundPanelElement.transform.position);
        }

        ManifestElement firstPlaneElement = FindFirstPlaneElement(slide);
        if (firstPlaneElement?.transform?.position != null)
        {
            Vector3 firstPlaneElementPosition = ToVector3(firstPlaneElement.transform.position);
            firstPlaneElementPosition.z += backgroundPanelBackOffset;
            return firstPlaneElementPosition;
        }

        return defaultBackgroundPanelPosition;
    }

    private ManifestElement FindFirstPlaneElement(ManifestSlide slide)
    {
        if (slide?.elements == null)
        {
            return null;
        }

        foreach (ManifestElement element in slide.elements)
        {
            if (IsPlaneElement(element))
            {
                return element;
            }
        }

        return null;
    }

    private Vector3 ResolvePlaneAnchorPosition(Vector3 backgroundPanelPosition)
    {
        return new Vector3(
            0f,
            0f,
            backgroundPanelPosition.z - backgroundPanelBackOffset
        );
    }

    private void ApplyPlaneElementTransform(
        GameObject createdObject,
        ManifestTransform sourceTransform,
        Vector3 planeAnchorPosition,
        bool isBackgroundPanelElement
    )
    {
        TransformApplier.Apply(
            createdObject,
            CreatePlaneElementTransform(sourceTransform, planeAnchorPosition, isBackgroundPanelElement)
        );
    }

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

    private GameObject CreateDefaultBackgroundPanel(
        ManifestSlide slide,
        Transform planeAnchor,
        Vector3 backgroundPanelPosition,
        Vector3 planeAnchorPosition
    )
    {
        GameObject backgroundPanel = GameObject.CreatePrimitive(PrimitiveType.Quad);
        backgroundPanel.name = $"BackgroundPanel_{slide.id}";
        backgroundPanel.transform.SetParent(planeAnchor, false);
        backgroundPanel.transform.localPosition = new Vector3(
            backgroundPanelPosition.x - planeAnchorPosition.x,
            backgroundPanelPosition.y - planeAnchorPosition.y,
            backgroundPanelBackOffset
        );
        backgroundPanel.transform.localRotation = Quaternion.identity;
        backgroundPanel.transform.localScale = defaultBackgroundPanelScale;
        SetSolidColor(backgroundPanel, Color.white);

        return backgroundPanel;
    }

    private static bool IsPlaneElement(ManifestElement element)
    {
        return element != null &&
            (element.type == "text" || element.type == "image" || element.type == "background");
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

        meta.presentationId = manifest.presentationId;
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
}

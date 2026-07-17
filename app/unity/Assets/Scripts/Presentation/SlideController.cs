using UnityEngine;

public class SlideController : MonoBehaviour
{
    [SerializeField] private bool updateCircularViewSlideFromYaw = true;
    [SerializeField] private bool logCircularViewYaw = true;
    [SerializeField] private float circularViewYawLogIntervalSeconds = 1f;

    private BuiltPresentation builtPresentation;
    private int currentSlideIndex = 0;
    private int revealedMaxSlideIndex = -1;
    private float nextCircularViewYawLogTime = 0f;
    private bool hasCircularYawSample;
    private float lastCounterClockwiseYaw;
    private float accumulatedCounterClockwiseYaw;
    private int manualNavigationFrame = -1;

    public int CurrentSlideIndex => currentSlideIndex;

    private void LateUpdate()
    {
        UpdateCircularViewSlideFromYaw();
    }

    public void SetPresentation(BuiltPresentation presentation)
    {
        builtPresentation = presentation;
        currentSlideIndex = 0;
        revealedMaxSlideIndex = -1;
        hasCircularYawSample = false;
        lastCounterClockwiseYaw = 0f;
        accumulatedCounterClockwiseYaw = 0f;

        ShowSlide(currentSlideIndex);
    }

    public void NextSlide()
    {
        if (builtPresentation == null || builtPresentation.slides.Count == 0)
        {
            Debug.LogWarning("SlideController: presentation is not set");
            return;
        }

        int nextIndex = currentSlideIndex + 1;

        if (nextIndex >= builtPresentation.slides.Count)
        {
            Debug.Log("SlideController: already at last slide");
            return;
        }

        manualNavigationFrame = Time.frameCount;
        ShowSlide(nextIndex);
    }

    public void PreviousSlide()
    {
        if (builtPresentation == null || builtPresentation.slides.Count == 0)
        {
            Debug.LogWarning("SlideController: presentation is not set");
            return;
        }

        int previousIndex = currentSlideIndex - 1;

        if (previousIndex < 0)
        {
            Debug.Log("SlideController: already at first slide");
            return;
        }

        manualNavigationFrame = Time.frameCount;
        ShowSlide(previousIndex);
    }

    public void ShowSlide(int index)
    {
        if (builtPresentation == null)
        {
            Debug.LogWarning("SlideController: presentation is not set");
            return;
        }

        if (index < 0 || index >= builtPresentation.slides.Count)
        {
            Debug.LogWarning($"SlideController: invalid slide index {index}");
            return;
        }

        int requestedIndex = index;
        if (builtPresentation.usesCircularView)
        {
            index = Mathf.Min(index, revealedMaxSlideIndex + 1);
        }

        for (int i = 0; i < builtPresentation.slides.Count; i++)
        {
            BuiltSlide slide = builtPresentation.slides[i];
            bool isActive = ResolveSlideActive(i, index);
            slide.slideRoot.SetActive(isActive);

            Debug.Log(
                "[SlideVisibility] " +
                $"requestedIndex={index} slideIndex={i} slideId={slide.slideId} " +
                $"usesCircularView={builtPresentation.usesCircularView} viewAngle={slide.viewAngle:F2} revealedMaxIndex={revealedMaxSlideIndex} " +
                $"isActive={isActive} localPosition={FormatVector3(slide.slideRoot.transform.localPosition)} " +
                $"localEuler={FormatVector3(slide.slideRoot.transform.localEulerAngles)}"
            );
        }

        currentSlideIndex = index;

        Debug.Log(
            $"SlideController: show slide {currentSlideIndex}" +
            (requestedIndex != currentSlideIndex
                ? $" (requested {requestedIndex}, clamped to the next unseen slide)"
                : string.Empty)
        );
    }

    private static string FormatVector3(Vector3 value)
    {
        return $"({value.x:F3}, {value.y:F3}, {value.z:F3})";
    }

    private void UpdateCircularViewSlideFromYaw()
    {
        if (builtPresentation == null ||
            !builtPresentation.usesCircularView ||
            builtPresentation.circularView == null)
        {
            return;
        }

        Camera mainCamera = Camera.main;
        if (mainCamera == null)
        {
            LogCircularViewYawWarningIfNeeded("[CircularViewYaw] Camera.main not found");
            return;
        }

        ManifestCircularView circularView = builtPresentation.circularView;
        Vector3 viewpoint = ToVector3(circularView.viewpointPosition, Vector3.zero);
        Vector3 start = ToVector3(circularView.startPosition, Vector3.forward);
        Vector3 startDirection = ProjectHorizontal(start - viewpoint, Vector3.forward);
        Vector3 cameraDirection = ProjectHorizontal(mainCamera.transform.forward, Vector3.forward);
        float currentCounterClockwiseYaw = ResolveCounterClockwiseYaw(startDirection, cameraDirection);
        bool shouldAdvanceFromYaw = false;
        if (!hasCircularYawSample)
        {
            hasCircularYawSample = true;
            lastCounterClockwiseYaw = currentCounterClockwiseYaw;
            accumulatedCounterClockwiseYaw = currentCounterClockwiseYaw;
        }
        else
        {
            float yawDelta = Mathf.DeltaAngle(
                lastCounterClockwiseYaw,
                currentCounterClockwiseYaw
            );
            accumulatedCounterClockwiseYaw += yawDelta;
            lastCounterClockwiseYaw = currentCounterClockwiseYaw;
            shouldAdvanceFromYaw = yawDelta > Mathf.Epsilon;
        }

        int nextSlideIndex = currentSlideIndex;
        if (shouldAdvanceFromYaw)
        {
            nextSlideIndex = ResolveNextCircularSlideIndex(
                circularView,
                accumulatedCounterClockwiseYaw,
                currentSlideIndex,
                builtPresentation.slides.Count
            );
        }

        LogCircularViewYawIfNeeded(
            mainCamera,
            circularView,
            startDirection,
            cameraDirection,
            accumulatedCounterClockwiseYaw,
            nextSlideIndex
        );

        if (!updateCircularViewSlideFromYaw ||
            manualNavigationFrame == Time.frameCount ||
            nextSlideIndex < 0 ||
            nextSlideIndex == currentSlideIndex)
        {
            return;
        }

        Debug.Log(
            "[CircularViewSwitch] " +
            $"from={currentSlideIndex} to={nextSlideIndex} yawFromStart={accumulatedCounterClockwiseYaw:F2}"
        );
        ShowSlide(nextSlideIndex);
    }

    private void LogCircularViewYawIfNeeded(
        Camera mainCamera,
        ManifestCircularView circularView,
        Vector3 startDirection,
        Vector3 cameraDirection,
        float yawFromStart,
        int nextSlideIndex
    )
    {
        if (!logCircularViewYaw || Time.time < nextCircularViewYawLogTime)
        {
            return;
        }

        nextCircularViewYawLogTime = Time.time + Mathf.Max(circularViewYawLogIntervalSeconds, 0.1f);

        Debug.Log(
            "[CircularViewYaw] " +
            $"cameraPosition={FormatVector3(mainCamera.transform.position)} cameraEuler={FormatVector3(mainCamera.transform.eulerAngles)} " +
            $"startDirection={FormatVector3(startDirection)} cameraDirection={FormatVector3(cameraDirection)} " +
            $"yawFromStart={yawFromStart:F2} startAngle={circularView.startAngle:F2} angleStep={circularView.angleStep:F2} " +
            $"nextSlideIndex={nextSlideIndex} currentSlideIndex={currentSlideIndex} revealedMaxIndex={revealedMaxSlideIndex} autoSwitch={updateCircularViewSlideFromYaw}"
        );
    }

    private bool ResolveSlideActive(int slideIndex, int requestedIndex)
    {
        if (!builtPresentation.usesCircularView)
        {
            return slideIndex == requestedIndex;
        }

        revealedMaxSlideIndex = Mathf.Max(revealedMaxSlideIndex, requestedIndex);
        return slideIndex <= revealedMaxSlideIndex;
    }

    private void LogCircularViewYawWarningIfNeeded(string message)
    {
        if (!logCircularViewYaw || Time.time < nextCircularViewYawLogTime)
        {
            return;
        }

        nextCircularViewYawLogTime = Time.time + Mathf.Max(circularViewYawLogIntervalSeconds, 0.1f);
        Debug.LogWarning(message);
    }

    private static int ResolveNearestSlideIndex(
        ManifestCircularView circularView,
        float yawFromStart,
        int slideCount
    )
    {
        if (slideCount <= 0 || Mathf.Abs(circularView.angleStep) <= Mathf.Epsilon)
        {
            return -1;
        }

        float slideFloatIndex = (yawFromStart - circularView.startAngle) / circularView.angleStep;
        int nearestSlideIndex = Mathf.RoundToInt(slideFloatIndex);
        return Mathf.Clamp(nearestSlideIndex, 0, slideCount - 1);
    }

    public static int ResolveNextCircularSlideIndex(
        ManifestCircularView circularView,
        float counterClockwiseYaw,
        int currentSlideIndex,
        int slideCount
    )
    {
        if (circularView == null || slideCount <= 0 || currentSlideIndex < 0)
        {
            return currentSlideIndex;
        }

        int nearestSlideIndex = ResolveNearestSlideIndex(
            circularView,
            counterClockwiseYaw,
            slideCount
        );

        if (nearestSlideIndex <= currentSlideIndex)
        {
            return Mathf.Clamp(currentSlideIndex, 0, slideCount - 1);
        }

        return Mathf.Min(currentSlideIndex + 1, nearestSlideIndex);
    }

    private static Vector3 ProjectHorizontal(Vector3 value, Vector3 fallback)
    {
        Vector3 horizontal = new Vector3(value.x, 0f, value.z);

        if (horizontal.sqrMagnitude <= Mathf.Epsilon)
        {
            horizontal = fallback;
        }

        return horizontal.normalized;
    }

    private static Vector3 ToVector3(ManifestVector3 value, Vector3 fallback)
    {
        if (value == null)
        {
            return fallback;
        }

        return new Vector3(value.x, value.y, value.z);
    }

    private static float NormalizeAngle(float angle)
    {
        float normalized = angle % 360f;
        return normalized < 0f ? normalized + 360f : normalized;
    }

    private static float ResolveCounterClockwiseYaw(Vector3 startDirection, Vector3 cameraDirection)
    {
        float clockwiseYaw = Vector3.SignedAngle(startDirection, cameraDirection, Vector3.up);
        return NormalizeAngle(-clockwiseYaw);
    }
}

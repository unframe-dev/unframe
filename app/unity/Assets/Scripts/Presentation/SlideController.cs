using UnityEngine;

public class SlideController : MonoBehaviour
{
    private BuiltPresentation builtPresentation;
    private int currentSlideIndex = 0;

    public int CurrentSlideIndex => currentSlideIndex;

    public void SetPresentation(BuiltPresentation presentation)
    {
        builtPresentation = presentation;
        currentSlideIndex = 0;

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

        for (int i = 0; i < builtPresentation.slides.Count; i++)
        {
            bool isActive = i == index;
            builtPresentation.slides[i].slideRoot.SetActive(isActive);
        }

        currentSlideIndex = index;

        Debug.Log($"SlideController: show slide {currentSlideIndex}");
    }
}
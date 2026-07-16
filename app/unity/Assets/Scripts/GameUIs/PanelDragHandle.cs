using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit;

public class PanelDragHandle : MonoBehaviour
{
    [Header("動かしたい対象")]
    public Transform panelRoot;

    private UnityEngine.XR.Interaction.Toolkit.Interactables.XRGrabInteractable grab;
    private UnityEngine.XR.Interaction.Toolkit.Interactors.XRRayInteractor currentRay;

    private bool isDragging = false;

    void Awake()
    {
        grab = GetComponent<UnityEngine.XR.Interaction.Toolkit.Interactables.XRGrabInteractable>();

        grab.selectEntered.AddListener(OnGrabStart);
        grab.selectExited.AddListener(OnGrabEnd);
    }

    void OnDestroy()
    {
        grab.selectEntered.RemoveListener(OnGrabStart);
        grab.selectExited.RemoveListener(OnGrabEnd);
    }

    private void OnGrabStart(SelectEnterEventArgs args)
    {
        isDragging = true;

        // Ray Interactor を取得
        currentRay = args.interactorObject as UnityEngine.XR.Interaction.Toolkit.Interactors.XRRayInteractor;
    }

    private void OnGrabEnd(SelectExitEventArgs args)
    {
        isDragging = false;
        currentRay = null;
    }

    void Update()
    {
        if (!isDragging || currentRay == null)
            return;

        // Ray の当たっている位置を取得
        if (currentRay.TryGetCurrent3DRaycastHit(out RaycastHit hit))
        {
            panelRoot.position = hit.point;
        }
    }
}
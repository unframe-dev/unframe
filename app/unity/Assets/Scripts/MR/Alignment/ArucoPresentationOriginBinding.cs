using System;
using UnityEngine;
using Unframe.Unity.PresentationRuntime;

public sealed class ArucoPresentationOriginBinding : MonoBehaviour
{
    [SerializeField] private ArucoOriginAlignment alignment;
    [SerializeField] private LocalPresentationFixtureRunner runner;
    [SerializeField] private Transform presentationSpace;
    [SerializeField] private Transform stageRoot;

    public bool IsPresentationVisible => presentationSpace != null && presentationSpace.gameObject.activeSelf;

    public void Configure(ArucoOriginAlignment source, LocalPresentationFixtureRunner presentation,
        Transform space, Transform stage)
    {
        if (source == null || presentation == null || space == null || stage == null
            || space.parent != null || stage.parent != space
            || source.transform.IsChildOf(space) || presentation.transform.IsChildOf(space)
            || transform.IsChildOf(space))
            throw new ArgumentException("Alignment, runner and binding must remain outside an independent presentation space with a direct stage child.");
        alignment = source;
        runner = presentation;
        presentationSpace = space;
        stageRoot = stage;
        runner.SetHierarchyRoot(stageRoot);
        Refresh();
    }

    public void Refresh()
    {
        if (presentationSpace == null) return;
        var origin = runner != null && runner.HasLoadedFixture ? runner.Store.PresentationOrigin : null;
        bool available = isActiveAndEnabled && alignment != null && alignment.isActiveAndEnabled
            && alignment.IsConfirmed && alignment.TrackingAvailable && stageRoot != null
            && presentationSpace.parent == null && stageRoot.parent == presentationSpace
            && !transform.IsChildOf(presentationSpace)
            && runner != null && !runner.transform.IsChildOf(presentationSpace)
            && !alignment.transform.IsChildOf(presentationSpace);
        if (!available || origin == null || !PresentationCoordinateAdapter.TryToUnityPose(origin.Pose, out _))
        {
            Hide();
            return;
        }

        // Calibration is Unity world space; the generated hierarchy owns the reflected Runtime origin.
        Pose calibration = alignment.OriginPose;
        presentationSpace.SetPositionAndRotation(calibration.position, calibration.rotation);
        presentationSpace.localScale = Vector3.one;
        stageRoot.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
        stageRoot.localScale = Vector3.one;
        runner.Hierarchy.ApplyOrigin(origin);
        presentationSpace.gameObject.SetActive(true);
    }

    private void OnEnable() => Refresh();

    private void LateUpdate()
    {
        Refresh();
        if (IsPresentationVisible && runner.CanAdvance && OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger))
        {
            if (!runner.TryAdvance(out string error)) Debug.LogError("[Presentation] " + error, this);
        }
    }

    private void Hide()
    {
        if (presentationSpace != null) presentationSpace.gameObject.SetActive(false);
    }

    private void OnDisable() => Hide();
    private void OnDestroy() => Hide();
}

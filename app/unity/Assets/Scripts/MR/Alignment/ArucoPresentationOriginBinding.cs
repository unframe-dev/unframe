using System;
using UnityEngine;
using Unframe.Unity.PresentationRuntime;

public sealed class ArucoPresentationOriginBinding : MonoBehaviour
{
    [SerializeField] private ArucoPresentationCalibration calibrationSource;
    [SerializeField] private LocalPresentationFixtureRunner runner;
    [SerializeField] private Transform presentationSpace;
    [SerializeField] private Transform stageRoot;

    private bool presentationVisible = true;

    public bool PresentationVisible
    {
        get => presentationVisible;
        set
        {
            presentationVisible = value;
            Refresh();
        }
    }

    public bool IsPresentationVisible => presentationSpace != null && presentationSpace.gameObject.activeSelf;

    public void Configure(ArucoPresentationCalibration source, LocalPresentationFixtureRunner presentation,
        Transform space, Transform stage)
    {
        if (source == null || presentation == null || space == null || stage == null
            || space.parent != null || stage.parent != space
            || source.transform.IsChildOf(space) || presentation.transform.IsChildOf(space)
            || transform.IsChildOf(space))
            throw new ArgumentException("Alignment, runner and binding must remain outside an independent presentation space with a direct stage child.");
        calibrationSource = source;
        runner = presentation;
        presentationSpace = space;
        stageRoot = stage;
        runner.SetHierarchyRoot(stageRoot);
        Refresh();
    }

    public void Refresh()
    {
        if (presentationSpace == null) return;
        if (calibrationSource != null) calibrationSource.Refresh();
        var origin = runner != null && runner.HasLoadedFixture ? runner.Store.PresentationOrigin : null;
        bool available = presentationVisible && isActiveAndEnabled && calibrationSource != null && calibrationSource.isActiveAndEnabled
            && calibrationSource.Calibration.IsValid && stageRoot != null
            && presentationSpace.parent == null && stageRoot.parent == presentationSpace
            && !transform.IsChildOf(presentationSpace)
            && runner != null && !runner.transform.IsChildOf(presentationSpace)
            && !calibrationSource.transform.IsChildOf(presentationSpace);
        if (!available || origin == null || !PresentationCoordinateAdapter.TryToUnityPose(origin.Pose, out _))
        {
            Hide();
            return;
        }

        if (!PresentationCalibrationMath.TryWorldFromPresentation(
            calibrationSource.Calibration.PresentationFromQuestLocal, calibrationSource.QuestTrackingOrigin,
            out Pose calibration, out _))
        {
            Hide();
            return;
        }
        presentationSpace.SetPositionAndRotation(calibration.position, calibration.rotation);
        presentationSpace.localScale = Vector3.one;
        stageRoot.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
        stageRoot.localScale = Vector3.one;
        runner.Hierarchy.ApplyOrigin(origin);
        presentationSpace.gameObject.SetActive(true);
    }

    private void OnEnable() => Refresh();

    private void LateUpdate() => Refresh();

    private void Hide()
    {
        if (presentationSpace != null) presentationSpace.gameObject.SetActive(false);
    }

    private void OnDisable() => Hide();
    private void OnDestroy() => Hide();
}

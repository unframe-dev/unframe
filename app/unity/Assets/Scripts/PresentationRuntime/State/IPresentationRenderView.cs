using System.Collections.Generic;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Validated catalog and current spatial state consumed by the common renderer.
    /// Admission, publication fencing, and asset loading belong to the supplying adapter.
    /// </summary>
    public interface IPresentationNativeRenderView : IPresentationRenderView
    {
        NativeUiResidencyPlan NativeUiResidency { get; }
        bool TryGetAsset(string id, out AssetAccessBinding value);
        bool TryGetVariableState(string id, out VariableState value);
    }

    public interface IPresentationRenderView
    {
        ProjectedRuntimeCatalog Catalog { get; }
        IEnumerable<DeliveredRenderSurface> RenderSurfaces { get; }
        IEnumerable<ProjectedSemanticSurface> SemanticSurfaces { get; }
        Pose StageOrigin { get; }
        IEnumerable<RuntimeRunSnapshot> ActiveRuns { get; }
        bool TryGetMediaState(string id, out MediaRuntimeState value);
        bool TryGetModelClipState(string id, out ModelClipRuntimeState value);
        bool TryGetSurface(string id, out ProjectedSurfaceDefinition value);
        bool TryGetNodeState(string id, out NodeRuntimeState value);
        bool TryGetSurfaceState(string id, out SurfaceRuntimeState value);
        ulong TrackingGeneration { get; }
        ulong TrackedPositionContinuity(AnchorTarget target);
        bool TryGetTrackedPose(AnchorTarget target, out ProjectedTrackedPoseSample value);
        bool TryGetFrozenAnchor(string nodeId, out FrozenAnchorDisplayState value);
    }
}

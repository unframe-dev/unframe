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
    public interface IPresentationRenderView
    {
        ProjectedRuntimeCatalog Catalog { get; }
        IEnumerable<DeliveredRenderSurface> RenderSurfaces { get; }
        IEnumerable<ProjectedSemanticSurface> SemanticSurfaces { get; }
        Pose StageOrigin { get; }
        IEnumerable<RuntimeRunSnapshot> ActiveRuns { get; }
        bool TryGetSurface(string id, out ProjectedSurfaceDefinition value);
        bool TryGetNodeState(string id, out NodeRuntimeState value);
        bool TryGetSurfaceState(string id, out SurfaceRuntimeState value);
        bool TryGetAnchorSample(string nodeId, out ProjectedAnchorBindingSample value);
    }
}

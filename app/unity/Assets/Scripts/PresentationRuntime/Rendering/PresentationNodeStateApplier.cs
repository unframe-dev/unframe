using Unframe.Presentation;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Applies projected node state to generated placeholders without owning rendering policy.
    /// </summary>
    public sealed class PresentationNodeStateApplier
    {
        public void Apply(IPresentationRenderView view, PresentationNodeHierarchy hierarchy)
        {
            if (view == null || hierarchy == null || hierarchy.Registry == null)
            {
                return;
            }

            hierarchy.ApplyOrigin(view.StageOrigin);
            ApplyAnchors(view, hierarchy);
            foreach (ProjectedNodeDefinition definition in view.Catalog.Nodes)
            {
                ApplyNodeState(view, hierarchy, definition.NodeId);
            }
        }

        public void ApplyAnchors(IPresentationRenderView view, PresentationNodeHierarchy hierarchy)
        {
            if (view == null || hierarchy?.Registry == null) return;
            foreach (var entry in hierarchy.Registry.AnchorParents)
            {
                GameObject parent = entry.Value;
                if (!view.TryGetAnchorSample(entry.Key, out Unframe.Realtime.ProjectedAnchorBindingSample sample))
                {
                    parent.SetActive(false);
                    continue;
                }
                if (sample.Position != null)
                    parent.transform.localPosition = PresentationUnityCoordinates.Position(sample.Position);
                if (sample.Rotation != null)
                    parent.transform.localRotation = PresentationUnityCoordinates.Rotation(sample.Rotation);
                parent.SetActive(true);
            }
        }

        public void ApplyNodeState(IPresentationRenderView view, PresentationNodeHierarchy hierarchy, string nodeId)
        {
            if (view == null || hierarchy == null || hierarchy.Registry == null
                || !hierarchy.Registry.TryGet(nodeId, out GameObject nodeObject))
            {
                return;
            }

            if (!view.TryGetNodeState(nodeId, out Unframe.Realtime.NodeRuntimeState state))
            {
                nodeObject.SetActive(false);
                return;
            }
            nodeObject.SetActive(state.Active);
            ApplyVisibility(nodeObject, state.Visible);
            PresentationVisualOpacity.Apply(nodeObject, (float)state.Opacity);
            ApplyTransform(nodeObject.transform, state.Transform);
        }

        private static void ApplyVisibility(GameObject nodeObject, bool visible)
        {
            foreach (Renderer renderer in nodeObject.GetComponentsInChildren<Renderer>(true))
            {
                renderer.enabled = visible;
            }
        }

        private static void ApplyTransform(UnityEngine.Transform target, Unframe.Presentation.Transform source)
        {
            if (source == null)
            {
                return;
            }

            if (source.Position != null)
            {
                target.localPosition = PresentationUnityCoordinates.Position(source.Position);
            }

            if (source.Rotation != null)
            {
                target.localRotation = PresentationUnityCoordinates.Rotation(source.Rotation);
            }

            if (source.Scale != null)
            {
                target.localScale = PresentationUnityCoordinates.Scale(source.Scale);
            }
        }
    }
}

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
                var (parent, anchor) = entry.Value;

                Unframe.Presentation.Vector3 position = null;
                Unframe.Presentation.Quaternion rotation = null;
                bool isFrozen = view.TryGetFrozenAnchor(entry.Key, out var frozen);
                if (isFrozen)
                {
                    position = frozen.Position;
                    rotation = frozen.Rotation;
                }
                else if (view.TryGetTrackedPose(anchor.Target, out var sample))
                {
                    position = sample.Position;
                    rotation = sample.Rotation;
                }

                bool available = isFrozen || ((!anchor.FollowPosition || position != null)
                    && (!anchor.FollowRotation || rotation != null));
                if (available)
                {
                    if (anchor.FollowPosition && position != null)
                        parent.transform.localPosition = PresentationUnityCoordinates.Position(position);
                    if (anchor.FollowRotation && rotation != null)
                        parent.transform.localRotation = PresentationUnityCoordinates.Rotation(rotation);
                }
                parent.SetActive(available);
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
            foreach (Canvas canvas in nodeObject.GetComponentsInChildren<Canvas>(true)) canvas.enabled = visible;
            foreach (Light light in nodeObject.GetComponentsInChildren<Light>(true)) light.enabled = visible;
            foreach (Renderer renderer in nodeObject.GetComponentsInChildren<Renderer>(true))
            {
                renderer.enabled = visible;
            }
        }

        private static void ApplyTransform(UnityEngine.Transform target, Unframe.Presentation.Transform source)
        {
            if (!PresentationCoordinateAdapter.TryToUnityTransform(source, out UnityEngine.Vector3 position, out UnityEngine.Quaternion rotation, out UnityEngine.Vector3 scale))
            {
                return;
            }

            target.localPosition = position;
            target.localRotation = rotation;
            target.localScale = scale;
        }
    }
}

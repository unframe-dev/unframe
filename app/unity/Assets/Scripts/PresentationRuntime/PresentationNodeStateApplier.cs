using Unframe.Presentation.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Applies projected node state to generated placeholders without owning rendering policy.
    /// </summary>
    public sealed class PresentationNodeStateApplier
    {
        public void Apply(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy)
        {
            if (store == null || hierarchy == null || hierarchy.Registry == null)
            {
                return;
            }

            hierarchy.ApplyOrigin(store.PresentationOrigin);
            ApplyAnchors(store, hierarchy);
            foreach (ProjectedNodeDefinition definition in store.Nodes)
            {
                ApplyNodeState(store, hierarchy, definition.NodeId);
            }
        }

        public void ApplyAnchors(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy)
        {
            if (store == null || hierarchy?.Registry == null) return;
            foreach (var entry in hierarchy.Registry.AnchorParents)
            {
                GameObject parent = entry.Value;
                if (!store.TryGetAnchorSample(entry.Key, out Unframe.Realtime.V2.ProjectedAnchorBindingSample sample))
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

        public void ApplyNodeState(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy, string nodeId)
        {
            if (store == null || hierarchy == null || hierarchy.Registry == null
                || !hierarchy.Registry.TryGet(nodeId, out GameObject nodeObject))
            {
                return;
            }

            if (!store.TryGetNodeState(nodeId, out Unframe.Realtime.V2.NodeRuntimeState state))
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

        private static void ApplyTransform(UnityEngine.Transform target, Unframe.Presentation.V2.Transform source)
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

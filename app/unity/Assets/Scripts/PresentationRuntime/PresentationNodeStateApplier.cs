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

            foreach (ProjectedNodeDefinition definition in store.Nodes)
            {
                ApplyNodeState(store, hierarchy, definition.NodeId);
            }
        }

        public void ApplyNodeState(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy, string nodeId)
        {
            if (store == null || hierarchy == null || hierarchy.Registry == null
                || !store.TryGetNodeState(nodeId, out Unframe.Realtime.V2.NodeRuntimeState state)
                || !hierarchy.Registry.TryGet(nodeId, out GameObject nodeObject))
            {
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

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
            if (source == null)
            {
                return;
            }

            if (source.Position != null)
            {
                target.localPosition = new UnityEngine.Vector3((float)source.Position.X, (float)source.Position.Y, (float)source.Position.Z);
            }

            if (source.Rotation != null)
            {
                target.localRotation = new UnityEngine.Quaternion((float)source.Rotation.X, (float)source.Rotation.Y, (float)source.Rotation.Z, (float)source.Rotation.W);
            }

            if (source.Scale != null)
            {
                target.localScale = new UnityEngine.Vector3((float)source.Scale.X, (float)source.Scale.Y, (float)source.Scale.Z);
            }
        }
    }
}

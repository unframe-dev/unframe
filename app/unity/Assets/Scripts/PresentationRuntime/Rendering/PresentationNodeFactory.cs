using System;
using System.Collections.Generic;
using Unframe.Presentation;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Materializes only the projected spatial hierarchy. Rendering and asset loading are separate stages.
    /// </summary>
    public sealed class PresentationNodeFactory
    {
        public bool TryBuild(IPresentationRenderView view, UnityEngine.Transform root, out PresentationNodeRegistry registry, out string error)
        {
            registry = null;
            if (view == null || view.Catalog == null || root == null)
            {
                error = "A validated render catalog and target root are required.";
                return false;
            }

            if (!PresentationNodeHierarchyPlan.TryCreate(view.Catalog.Nodes, out PresentationNodeHierarchyPlan plan, out error)) return false;
            IReadOnlyList<ProjectedNodeDefinition> definitions = plan.Nodes;

            Dictionary<string, GameObject> created = new Dictionary<string, GameObject>();
            Dictionary<string, GameObject> anchors = new Dictionary<string, GameObject>();
            try
            {
                foreach (ProjectedNodeDefinition definition in definitions)
                {
                    GameObject nodeObject = new GameObject(definition.NodeId);
                    nodeObject.AddComponent<PresentationNodeMetadata>().Initialize(definition);
                    created.Add(definition.NodeId, nodeObject);
                }

                foreach (ProjectedSurfaceDefinition surface in view.Catalog.Surfaces)
                {
                    created[surface.HostNodeId].AddComponent<PresentationSurfaceMetadata>().Initialize(surface);
                }

                foreach (ProjectedNodeDefinition definition in definitions)
                {
                    UnityEngine.Transform parent = root;
                    if (definition.Parent.ParentCase == SpatialParent.ParentOneofCase.Node)
                    {
                        parent = created[definition.Parent.Node.NodeId].transform;
                    }
                    else if (definition.Parent.ParentCase == SpatialParent.ParentOneofCase.PresenterAnchor)
                    {
                        GameObject anchor = new GameObject("Presenter Anchor " + definition.NodeId);
                        anchor.transform.SetParent(root, false);
                        anchor.SetActive(false);
                        anchors.Add(definition.NodeId, anchor);
                        parent = anchor.transform;
                    }

                    created[definition.NodeId].transform.SetParent(parent, false);
                }

                foreach (PresentationNodeHierarchyPlan.SiblingGroup siblings in plan.SiblingGroups)
                {
                    for (int index = 0; index < siblings.Nodes.Count; index++)
                        created[siblings.Nodes[index].NodeId].transform.SetSiblingIndex(index);
                }

                registry = new PresentationNodeRegistry();
                foreach (ProjectedNodeDefinition definition in definitions)
                {
                    registry.Register(definition.NodeId, created[definition.NodeId]);
                }
                foreach (KeyValuePair<string, GameObject> anchor in anchors) registry.RegisterAnchor(anchor.Key, anchor.Value);

                error = null;
                return true;
            }
            catch (Exception exception)
            {
                foreach (GameObject nodeObject in created.Values)
                {
                    if (nodeObject != null)
                    {
                        UnityEngine.Object.Destroy(nodeObject);
                    }
                }
                foreach (GameObject anchor in anchors.Values)
                    if (anchor != null) UnityEngine.Object.Destroy(anchor);

                error = "Unable to create the presentation node hierarchy: " + exception.Message;
                return false;
            }
        }
    }
}

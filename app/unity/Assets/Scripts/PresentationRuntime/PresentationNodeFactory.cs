using System;
using System.Collections.Generic;
using Unframe.Presentation.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Materializes only the projected spatial hierarchy. Rendering and asset loading are separate stages.
    /// </summary>
    public sealed class PresentationNodeFactory
    {
        public bool TryBuild(PresentationRuntimeDataStore store, UnityEngine.Transform root, out PresentationNodeRegistry registry, out string error)
        {
            registry = null;
            if (store == null || store.Delivery == null || root == null)
            {
                error = "A received delivery and target root are required.";
                return false;
            }

            List<ProjectedNodeDefinition> definitions = new List<ProjectedNodeDefinition>(store.Nodes);
            Dictionary<string, ProjectedNodeDefinition> byId = new Dictionary<string, ProjectedNodeDefinition>();
            foreach (ProjectedNodeDefinition definition in definitions)
            {
                if (definition == null || String.IsNullOrEmpty(definition.NodeId) || definition.Parent == null || definition.Parent.ParentCase == SpatialParent.ParentOneofCase.None || definition.NodeCase == ProjectedNodeDefinition.NodeOneofCase.None || byId.ContainsKey(definition.NodeId))
                {
                    error = "Delivery contains an invalid projected node.";
                    return false;
                }

                byId.Add(definition.NodeId, definition);
            }

            foreach (ProjectedNodeDefinition definition in definitions)
            {
                if (definition.Parent.ParentCase == SpatialParent.ParentOneofCase.PresenterAnchor)
                {
                    error = "Presenter anchors require an anchor resolver.";
                    return false;
                }

                if (definition.Parent.ParentCase == SpatialParent.ParentOneofCase.Node && !byId.ContainsKey(definition.Parent.Node.NodeId))
                {
                    error = "Delivery node parent is absent.";
                    return false;
                }

                if (HasParentCycle(definition, byId))
                {
                    error = "Delivery node parent graph contains a cycle.";
                    return false;
                }
            }

            Dictionary<string, GameObject> created = new Dictionary<string, GameObject>();
            try
            {
                foreach (ProjectedNodeDefinition definition in definitions)
                {
                    GameObject nodeObject = new GameObject(definition.NodeId);
                    nodeObject.AddComponent<PresentationNodeMetadata>().Initialize(definition);
                    created.Add(definition.NodeId, nodeObject);
                }

                foreach (ProjectedSurfaceDefinition surface in store.Delivery.ProjectionProfile.RuntimeCatalog.Surfaces)
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

                    created[definition.NodeId].transform.SetParent(parent, false);
                }

                SetSiblingOrder(root, definitions, created, null);
                foreach (ProjectedNodeDefinition definition in definitions)
                {
                    if (definition.Parent.ParentCase == SpatialParent.ParentOneofCase.Node)
                    {
                        SetSiblingOrder(created[definition.Parent.Node.NodeId].transform, definitions, created, definition.Parent.Node.NodeId);
                    }
                }

                registry = new PresentationNodeRegistry();
                foreach (ProjectedNodeDefinition definition in definitions)
                {
                    registry.Register(definition.NodeId, created[definition.NodeId]);
                }

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

                error = "Unable to create the presentation node hierarchy: " + exception.Message;
                return false;
            }
        }

        private static bool HasParentCycle(ProjectedNodeDefinition definition, Dictionary<string, ProjectedNodeDefinition> byId)
        {
            HashSet<string> visited = new HashSet<string>();
            ProjectedNodeDefinition current = definition;
            while (current.Parent.ParentCase == SpatialParent.ParentOneofCase.Node)
            {
                if (!visited.Add(current.NodeId))
                {
                    return true;
                }

                current = byId[current.Parent.Node.NodeId];
            }

            return false;
        }

        private static void SetSiblingOrder(UnityEngine.Transform parent, List<ProjectedNodeDefinition> definitions, Dictionary<string, GameObject> created, string parentNodeId)
        {
            List<ProjectedNodeDefinition> children = definitions.FindAll(definition => IsChildOf(definition, parentNodeId));
            children.Sort((left, right) =>
            {
                int order = left.Order.CompareTo(right.Order);
                return order != 0 ? order : string.CompareOrdinal(left.NodeId, right.NodeId);
            });
            for (int index = 0; index < children.Count; index++)
            {
                created[children[index].NodeId].transform.SetSiblingIndex(index);
            }
        }

        private static bool IsChildOf(ProjectedNodeDefinition definition, string parentNodeId)
        {
            if (parentNodeId == null)
            {
                return definition.Parent.ParentCase != SpatialParent.ParentOneofCase.Node;
            }

            return definition.Parent.ParentCase == SpatialParent.ParentOneofCase.Node && definition.Parent.Node.NodeId == parentNodeId;
        }
    }
}

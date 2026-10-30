using System;
using System.Collections.Generic;
using Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationNodeHierarchyPlan
    {
        public sealed class SiblingGroup
        {
            public string ParentNodeId { get; }
            public IReadOnlyList<ProjectedNodeDefinition> Nodes { get; }

            internal SiblingGroup(string parentNodeId, List<ProjectedNodeDefinition> nodes)
            {
                ParentNodeId = parentNodeId;
                Nodes = nodes.AsReadOnly();
            }
        }

        public IReadOnlyList<ProjectedNodeDefinition> Nodes { get; }
        public IReadOnlyList<SiblingGroup> SiblingGroups { get; }

        private PresentationNodeHierarchyPlan(List<ProjectedNodeDefinition> nodes, List<SiblingGroup> siblingGroups)
        {
            Nodes = nodes.AsReadOnly();
            SiblingGroups = siblingGroups.AsReadOnly();
        }

        public static bool TryCreate(IEnumerable<ProjectedNodeDefinition> source, out PresentationNodeHierarchyPlan plan, out string error)
        {
            plan = null;
            if (source == null)
            {
                error = "A projected spatial hierarchy is required.";
                return false;
            }

            var nodes = new List<ProjectedNodeDefinition>(source);
            var byId = new Dictionary<string, ProjectedNodeDefinition>();
            foreach (ProjectedNodeDefinition node in nodes)
            {
                if (node == null || String.IsNullOrEmpty(node.NodeId) || node.Parent == null
                    || node.Parent.ParentCase == SpatialParent.ParentOneofCase.None
                    || node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.None || byId.ContainsKey(node.NodeId))
                {
                    error = "Render catalog contains an invalid projected node.";
                    return false;
                }
                byId.Add(node.NodeId, node);
            }

            foreach (ProjectedNodeDefinition node in nodes)
            {
                if (node.Parent.ParentCase == SpatialParent.ParentOneofCase.PresenterAnchor
                    && (node.Parent.PresenterAnchor.Target == AnchorTarget.Unspecified
                        || !Enum.IsDefined(typeof(AnchorTarget), node.Parent.PresenterAnchor.Target)
                        || !node.Parent.PresenterAnchor.FollowPosition && !node.Parent.PresenterAnchor.FollowRotation))
                {
                    error = "Render catalog presenter anchor is invalid.";
                    return false;
                }
                if (node.Parent.ParentCase == SpatialParent.ParentOneofCase.Node && !byId.ContainsKey(node.Parent.Node.NodeId))
                {
                    error = "Render catalog node parent is absent.";
                    return false;
                }
            }

            var completed = new HashSet<string>();
            foreach (ProjectedNodeDefinition node in nodes)
            {
                if (completed.Contains(node.NodeId)) continue;
                var currentPath = new HashSet<string>();
                ProjectedNodeDefinition current = node;
                while (!completed.Contains(current.NodeId))
                {
                    if (!currentPath.Add(current.NodeId))
                    {
                        error = "Render catalog node parent graph contains a cycle.";
                        return false;
                    }
                    if (current.Parent.ParentCase != SpatialParent.ParentOneofCase.Node) break;
                    current = byId[current.Parent.Node.NodeId];
                }
                completed.UnionWith(currentPath);
            }

            var stageChildren = new List<ProjectedNodeDefinition>();
            var nodeChildren = new Dictionary<string, List<ProjectedNodeDefinition>>();
            foreach (ProjectedNodeDefinition node in nodes)
            {
                if (node.Parent.ParentCase == SpatialParent.ParentOneofCase.Stage)
                {
                    stageChildren.Add(node);
                }
                else if (node.Parent.ParentCase == SpatialParent.ParentOneofCase.Node)
                {
                    string parentNodeId = node.Parent.Node.NodeId;
                    if (!nodeChildren.TryGetValue(parentNodeId, out List<ProjectedNodeDefinition> children))
                    {
                        children = new List<ProjectedNodeDefinition>();
                        nodeChildren.Add(parentNodeId, children);
                    }
                    children.Add(node);
                }
            }

            var groups = new List<SiblingGroup>();
            if (stageChildren.Count != 0) groups.Add(CreateSiblingGroup(null, stageChildren));
            foreach (KeyValuePair<string, List<ProjectedNodeDefinition>> children in nodeChildren)
                groups.Add(CreateSiblingGroup(children.Key, children.Value));

            plan = new PresentationNodeHierarchyPlan(nodes, groups);
            error = null;
            return true;
        }

        private static SiblingGroup CreateSiblingGroup(string parentNodeId, List<ProjectedNodeDefinition> children)
        {
            children.Sort((left, right) =>
            {
                int order = left.Order.CompareTo(right.Order);
                return order != 0 ? order : String.CompareOrdinal(left.NodeId, right.NodeId);
            });
            return new SiblingGroup(parentNodeId, children);
        }
    }
}

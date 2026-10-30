using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationNodeHierarchyPlanTests
{
    [Test]
    public void EachParentHasOneOrderedGroupContainingEachSortableNodeOnce()
    {
        ProjectedNodeDefinition anchor = Node("anchor", null, 0);
        anchor.Parent = new SpatialParent { PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head, FollowPosition = true } };
        var nodes = new[]
        {
            Node("root:b", null, 2), Node("root:a", null, 1),
            Node("child:z", "root:a", 2), Node("child:b", "root:a", 1), Node("child:a", "root:a", 1),
            Node("leaf", "root:b", 0), anchor, Node("anchor-child", "anchor", 0),
        };

        Assert.That(PresentationNodeHierarchyPlan.TryCreate(nodes, out PresentationNodeHierarchyPlan plan, out string error), Is.True, error);
        Assert.That(plan.SiblingGroups.Select(group => group.ParentNodeId), Is.EquivalentTo(new string[] { null, "root:a", "root:b", "anchor" }));
        Assert.That(Group(plan, null), Is.EqualTo(new[] { "root:a", "root:b" }));
        Assert.That(Group(plan, "root:a"), Is.EqualTo(new[] { "child:a", "child:b", "child:z" }));
        Assert.That(Group(plan, "root:b"), Is.EqualTo(new[] { "leaf" }));
        Assert.That(Group(plan, "anchor"), Is.EqualTo(new[] { "anchor-child" }));
        Assert.That(plan.SiblingGroups.SelectMany(group => group.Nodes).Select(node => node.NodeId),
            Is.EquivalentTo(new[] { "root:a", "root:b", "child:a", "child:b", "child:z", "leaf", "anchor-child" }));
        Assert.That(plan.Nodes, Is.EquivalentTo(nodes));
    }

    [Test]
    public void EmptyHierarchyHasNoSiblingWork()
    {
        Assert.That(PresentationNodeHierarchyPlan.TryCreate(Array.Empty<ProjectedNodeDefinition>(), out PresentationNodeHierarchyPlan plan, out string error), Is.True, error);
        Assert.That(plan.Nodes, Is.Empty);
        Assert.That(plan.SiblingGroups, Is.Empty);
    }

    [Test]
    public void SiblingTiesUseOrdinalNodeIdentity()
    {
        var nodes = new[] { Node("z", null, 1), Node("a", null, 1), Node("A", null, 1), Node("first", null, 0) };
        Assert.That(PresentationNodeHierarchyPlan.TryCreate(nodes, out PresentationNodeHierarchyPlan plan, out string error), Is.True, error);
        Assert.That(Group(plan, null), Is.EqualTo(new[] { "first", "A", "a", "z" }));
    }

    [Test]
    public void DeepValidHierarchyDoesNotRequireRecursiveTraversal()
    {
        var nodes = new List<ProjectedNodeDefinition>();
        for (int index = 2047; index >= 0; index--)
            nodes.Add(Node("node:" + index, index == 0 ? null : "node:" + (index - 1), 0));
        Assert.That(PresentationNodeHierarchyPlan.TryCreate(nodes, out PresentationNodeHierarchyPlan plan, out string error), Is.True, error);
        Assert.That(plan.Nodes.Count, Is.EqualTo(2048));
        Assert.That(plan.SiblingGroups.Count, Is.EqualTo(2048));
    }

    [TestCase("duplicate")]
    [TestCase("missing parent")]
    [TestCase("self cycle")]
    [TestCase("cycle")]
    [TestCase("missing node type")]
    [TestCase("missing parent type")]
    [TestCase("invalid anchor")]
    [TestCase("unknown anchor")]
    [TestCase("null node")]
    public void InvalidHierarchyReturnsNoPlan(string invalid)
    {
        var nodes = new List<ProjectedNodeDefinition> { Node("child", "parent", 0), Node("parent", null, 0) };
        switch (invalid)
        {
            case "duplicate": nodes.Add(Node("child", null, 0)); break;
            case "missing parent": nodes[1].Parent = new SpatialParent { Node = new NodeParent { NodeId = "absent" } }; break;
            case "self cycle": nodes[0].Parent = new SpatialParent { Node = new NodeParent { NodeId = "child" } }; break;
            case "cycle": nodes[1].Parent = new SpatialParent { Node = new NodeParent { NodeId = "child" } }; break;
            case "missing node type": nodes[0].ClearNode(); break;
            case "missing parent type": nodes[0].Parent = new SpatialParent(); break;
            case "invalid anchor": nodes[1].Parent = new SpatialParent { PresenterAnchor = new PresenterAnchorParent { Target = AnchorTarget.Head } }; break;
            case "unknown anchor": nodes[1].Parent = new SpatialParent { PresenterAnchor = new PresenterAnchorParent { Target = (AnchorTarget)99, FollowPosition = true } }; break;
            case "null node": nodes.Add(null); break;
        }
        Assert.That(PresentationNodeHierarchyPlan.TryCreate(nodes, out PresentationNodeHierarchyPlan plan, out string error), Is.False);
        Assert.That(plan, Is.Null);
        Assert.That(error, Is.Not.Empty);
    }

    private static string[] Group(PresentationNodeHierarchyPlan plan, string parent) =>
        plan.SiblingGroups.Single(group => group.ParentNodeId == parent).Nodes.Select(node => node.NodeId).ToArray();

    private static ProjectedNodeDefinition Node(string id, string parent, uint order) => new ProjectedNodeDefinition
    {
        NodeId = id,
        Parent = parent == null ? new SpatialParent { Stage = new StageParent() } : new SpatialParent { Node = new NodeParent { NodeId = parent } },
        Container = new ContainerNode(),
        Order = order,
    };
}

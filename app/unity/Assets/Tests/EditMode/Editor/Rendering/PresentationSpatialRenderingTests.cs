using System;
using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.TestTools;
using UnityEditor;
using Wire = Unframe.Presentation;

public sealed class PresentationSpatialRenderingTests
{
    private static ProjectedNodeDefinition Node(string id) => new ProjectedNodeDefinition
    {
        NodeId = id,
        Parent = new SpatialParent { Stage = new StageParent() },
        Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
        Order = (uint)(id.Length + id[0]),
    };

    [UnityTest]
    public IEnumerator PreviewRendersShapeGeometryMaterialsAndRuntimeStateAndReleasesResources()
    {
        var envelope = PresentationPreviewTestFixture.Create();
        var box = Node("box");
        box.Shape = new ShapeNode
        {
            Box = new BoxGeometry { Size = new Wire.Vector3 { X = 2, Y = 3, Z = 4 } },
            Material = new UnlitShapeMaterial { Color = new SrgbaColor { Red = 0.2, Green = 0.4, Blue = 0.6, Alpha = 0.8 }, DoubleSided = true }
        };
        var sphere = Node("sphere");
        sphere.Shape = new ShapeNode
        {
            Sphere = new SphereGeometry { Radius = 0.7 },
            Material = new UnlitShapeMaterial { Color = new SrgbaColor { Red = 1, Alpha = 1 } }
        };
        foreach (var node in new[] { box, sphere })
        {
            envelope.Projection.RuntimeCatalog.Nodes.Add(node);
            envelope.Projection.VisibleNodeIds.Add(node.NodeId);
            envelope.InitialState.NodeStates.Add(PresentationPreviewTestFixture.Node(node.NodeId));
        }
        var state = envelope.InitialState.NodeStates[envelope.InitialState.NodeStates.Count - 2];
        state.Transform.Position = new Wire.Vector3 { X = 1, Y = 2, Z = -3 };
        state.Transform.Scale = new Wire.Vector3 { X = 2, Y = 2, Z = 2 };
        state.Transform.Rotation = new Wire.Quaternion { Y = Math.Sqrt(0.5), W = Math.Sqrt(0.5) };
        state.Opacity = 0.5;
        var root = new GameObject("Spatial test");
        Material material = null;
        GameObject geometry = null;
        try
        {
            using (var transaction = new PresentationPreviewTransaction(root.transform))
            {
                Task<string> prepare = transaction.PrepareAsync(envelope, (_, __, ___) => throw new InvalidOperationException("No assets expected"), CancellationToken.None);
                while (!prepare.IsCompleted) yield return null;
                Assert.That(prepare.IsFaulted, Is.False, prepare.Exception?.ToString());
                transaction.Commit(envelope.RequestId);
                var host = Find(root, "box");
                var renderer = host.GetComponentInChildren<MeshRenderer>();
                Assert.That(renderer, Is.Not.Null, "Box geometry must be generated in the preview renderer.");
                geometry = renderer.gameObject;
                material = renderer.sharedMaterial;
                Assert.That(host.transform.localPosition, Is.EqualTo(new UnityEngine.Vector3(1, 2, 3)));
                Assert.That(host.transform.localScale, Is.EqualTo(UnityEngine.Vector3.one * 2));
                Assert.That(UnityEngine.Quaternion.Angle(host.transform.localRotation, UnityEngine.Quaternion.Euler(0, -90, 0)), Is.LessThan(0.01));
                Assert.That(geometry.transform.localScale, Is.EqualTo(new UnityEngine.Vector3(2, 3, 4)));
                Assert.That(material.GetColor("_BaseColor").a, Is.EqualTo(0.4f).Within(0.0001));
                Assert.That(material.GetColor("_BaseColor").r, Is.EqualTo(QualitySettings.activeColorSpace == ColorSpace.Linear ? Mathf.GammaToLinearSpace(0.2f) : 0.2f).Within(0.0001));
                Assert.That(material.GetFloat("_Cull"), Is.EqualTo((float)CullMode.Off));
                Assert.That(renderer.shadowCastingMode, Is.EqualTo(ShadowCastingMode.Off));
                Assert.That(renderer.receiveShadows, Is.False);
                Assert.That(geometry.GetComponent<Collider>(), Is.Null);
                var sphereMaterial = Find(root, "sphere").GetComponentInChildren<MeshRenderer>().sharedMaterial;
                Assert.That(sphereMaterial.GetFloat("_ZWrite"), Is.EqualTo(1));
                Assert.That(sphereMaterial.renderQueue, Is.EqualTo((int)RenderQueue.Geometry));
                Assert.That(Find(root, "sphere").GetComponentInChildren<MeshRenderer>().transform.localScale.x, Is.EqualTo(1.4f).Within(0.0001));
            }
            Assert.That(geometry == null, Is.True);
            Assert.That(material == null, Is.True, "Generated materials must be disposed with the preview.");
        }
        finally { UnityEngine.Object.DestroyImmediate(root); }
    }

    [UnityTest]
    public IEnumerator PreviewCreatesAllLightKindsWithPhysicalUnitsAndHonorsVisibilityAndOpacity()
    {
        var envelope = PresentationPreviewTestFixture.Create();
        var directional = Node("directional");
        directional.Light = new LightNode { Directional = new DirectionalLight { Color = new SrgbColor { Red = 0.2, Green = 0.4, Blue = 0.6 }, IntensityLux = 12, CastsShadows = true } };
        var point = Node("point");
        point.Light = new LightNode { Point = new PointLight { Color = new SrgbColor { Red = 1, Green = 1, Blue = 1 }, IntensityCandela = 8, RangeMeters = 6 } };
        var spot = Node("spot");
        spot.Light = new LightNode { Spot = new SpotLight { Color = new SrgbColor { Red = 1 }, IntensityCandela = 10, RangeMeters = 7, InnerAngleDegrees = 20, OuterAngleDegrees = 60, CastsShadows = true } };
        foreach (var node in new[] { directional, point, spot })
        {
            envelope.Projection.RuntimeCatalog.Nodes.Add(node);
            envelope.Projection.VisibleNodeIds.Add(node.NodeId);
            var state = PresentationPreviewTestFixture.Node(node.NodeId);
            state.Opacity = 0.5;
            if (node == point) state.Visible = false;
            if (node == spot) state.Active = false;
            envelope.InitialState.NodeStates.Add(state);
        }
        var root = new GameObject("Light test");
        Light sun = null;
        try
        {
            using (var transaction = new PresentationPreviewTransaction(root.transform))
            {
                var prepare = transaction.PrepareAsync(envelope, (_, __, ___) => throw new InvalidOperationException("No assets expected"), CancellationToken.None);
                while (!prepare.IsCompleted) yield return null;
                Assert.That(prepare.IsFaulted, Is.False, prepare.Exception?.ToString());
                transaction.Commit(envelope.RequestId);
                sun = Find(root, "directional").GetComponentInChildren<Light>(true);
                Assert.That(sun, Is.Not.Null);
                Assert.That(sun.type, Is.EqualTo(LightType.Directional));
                Assert.That(sun.lightUnit, Is.EqualTo(LightUnit.Lux));
                Assert.That(sun.intensity, Is.EqualTo(6));
                Assert.That(sun.color.r, Is.EqualTo(0.2f).Within(0.0001));
                Assert.That(sun.shadows, Is.EqualTo(LightShadows.Soft));
                var bulb = Find(root, "point").GetComponentInChildren<Light>(true);
                Assert.That(bulb.type, Is.EqualTo(LightType.Point));
                Assert.That(bulb.lightUnit, Is.EqualTo(LightUnit.Candela));
                Assert.That(bulb.intensity, Is.EqualTo(4));
                Assert.That(bulb.range, Is.EqualTo(6));
                Assert.That(bulb.enabled, Is.False);
                Assert.That(bulb.shadows, Is.EqualTo(LightShadows.None));
                var cone = Find(root, "spot").GetComponentInChildren<Light>(true);
                Assert.That(cone.type, Is.EqualTo(LightType.Spot));
                Assert.That(cone.innerSpotAngle, Is.EqualTo(20));
                Assert.That(cone.spotAngle, Is.EqualTo(60));
                Assert.That(cone.range, Is.EqualTo(7));
                Assert.That(cone.gameObject.activeInHierarchy, Is.False);
                var timeline = new ProjectedTimelineDefinition { TimelineId = "light-fade", DurationMs = 1000 };
                timeline.Tracks.Add(new ProjectedTimelineTrack { Target = new TimelineTrackTarget { NodeId = "directional", Property = TimelineProperty.Opacity }, Keyframes = { new TimelineKeyframe { TimeMs = 0, Number = new NumberKeyframeValue { Value = 1 } }, new TimelineKeyframe { TimeMs = 1000, Number = new NumberKeyframeValue { Value = 0 } } } });
                Assert.That(PresentationLocalPreviewAdapter.TryCreate(envelope, out var input, out string error), Is.True, error);
                var hierarchy = new PresentationNodeHierarchy();
                using var spatial = new PresentationSpatialRenderer();
                try
                {
                    Assert.That(hierarchy.TryReplace(input, root.transform, out error), Is.True, error);
                    Assert.That(spatial.TryBuild(input, hierarchy, out error), Is.True, error);
                    var player = new PresentationTimelinePlayer();
                    Assert.That(player.TryStart(timeline, hierarchy, 0, out error), Is.True, error);
                    player.Update(0.75);
                    Assert.That(spatial.TryRefresh(input, hierarchy, out error), Is.True, error);
                    Assert.That(hierarchy.Registry.TryGet("directional", out var host), Is.True);
                    Assert.That(host.GetComponentInChildren<Light>().intensity, Is.EqualTo(3));
                    player.Update(0.5);
                    Assert.That(spatial.TryRefresh(input, hierarchy, out error), Is.True, error);
                    Assert.That(host.GetComponentInChildren<Light>().intensity, Is.EqualTo(6));
                }
                finally { spatial.Dispose(); hierarchy.Clear(); }
            }
            Assert.That(sun == null, Is.True);
        }
        finally { UnityEngine.Object.DestroyImmediate(root); }
    }

    [UnityTest]
    public IEnumerator ModelInternalOffsetUsesTheSameCoordinateReflectionAsItsSpatialNode()
    {
        byte[] bytes = PresentationModelRuntimeEditModeTests.Glb("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"name\":\"offset\",\"translation\":[1,2,3]}]}");
        var binding = PresentationModelRuntimeEditModeTests.Binding(bytes);
        var envelope = PresentationPreviewTestFixture.Create();
        envelope.Projection.ModelResidency = new Unframe.Delivery.ModelResidencyPlan { BudgetTierId = "local-web-preview", Models = { binding } };
        var node = Node("model"); node.Model = new ModelNode { ModelAssetId = binding.AssetId };
        envelope.Projection.RuntimeCatalog.Nodes.Add(node);
        envelope.Projection.VisibleNodeIds.Add(node.NodeId);
        envelope.InitialState.NodeStates.Add(PresentationPreviewTestFixture.Node(node.NodeId));
        envelope.AssetSet = "{\"schemaVersion\":1,\"assets\":{\"model:one\":{\"checksum\":\"" + binding.Checksum + "\",\"mediaType\":\"model/gltf-binary\",\"encodedSizeBytes\":" + bytes.Length + "}}}";
        envelope.Assets.Add(new Unframe.Preview.LocalPreviewAsset { AssetId = binding.AssetId, Reference = "model-reference" });
        var root = new GameObject("Model coordinates");
        try
        {
            using var transaction = new PresentationPreviewTransaction(root.transform);
            var prepare = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(bytes, "model/gltf-binary")), CancellationToken.None);
            while (!prepare.IsCompleted) yield return null;
            Assert.That(prepare.IsFaulted, Is.False, prepare.Exception?.ToString());
            transaction.Commit(envelope.RequestId);
            var host = Find(root, "model");
            var offset = Find(host, "offset");
            Assert.That(host.transform.InverseTransformPoint(offset.transform.position), Is.EqualTo(new UnityEngine.Vector3(1, 2, -3)).Using(UnityEngine.TestTools.Utils.Vector3ComparerWithEqualsOperator.Instance));
        }
        finally { UnityEngine.Object.DestroyImmediate(root); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void SpatialChildrenInheritVisibilityOpacityAndTimelineOpacityInEitherCatalogOrder(bool reverse)
    {
        var envelope = PresentationPreviewTestFixture.Create();
        var shape = Node("shape-child");
        shape.Parent = new SpatialParent { Node = new NodeParent { NodeId = "node:stage" } };
        shape.Shape = new ShapeNode
        {
            Box = new BoxGeometry { Size = new Wire.Vector3 { X = 1, Y = 1, Z = 1 } },
            Material = new UnlitShapeMaterial { Color = new SrgbaColor { Red = 1, Alpha = 1 } }
        };
        var light = Node("light-child");
        light.Parent = shape.Parent.Clone();
        light.Light = new LightNode { Point = new PointLight { Color = new SrgbColor { Red = 1 }, IntensityCandela = 12, RangeMeters = 5 } };
        foreach (var node in new[] { shape, light })
        {
            envelope.Projection.RuntimeCatalog.Nodes.Add(node);
            envelope.Projection.VisibleNodeIds.Add(node.NodeId);
            var childState = PresentationPreviewTestFixture.Node(node.NodeId);
            childState.Opacity = 0.5;
            envelope.InitialState.NodeStates.Add(childState);
        }
        if (reverse)
        {
            var nodes = new System.Collections.Generic.List<ProjectedNodeDefinition>(envelope.Projection.RuntimeCatalog.Nodes);
            nodes.Reverse();
            envelope.Projection.RuntimeCatalog.Nodes.Clear();
            envelope.Projection.RuntimeCatalog.Nodes.Add(nodes);
        }
        Assert.That(PresentationLocalPreviewAdapter.TryCreate(envelope, out var input, out string error), Is.True, error);
        Assert.That(input.TryGetNodeState("node:stage", out var parent), Is.True);
        parent.Opacity = 0.5;
        var root = new GameObject("Inherited spatial state");
        var hierarchy = new PresentationNodeHierarchy();
        using var spatial = new PresentationSpatialRenderer();
        try
        {
            Assert.That(hierarchy.TryReplace(input, root.transform, out error), Is.True, error);
            Assert.That(spatial.TryBuild(input, hierarchy, out error), Is.True, error);
            var states = new PresentationNodeStateApplier();
            states.Apply(input, hierarchy);
            Assert.That(spatial.TryRefresh(input, hierarchy, out error), Is.True, error);
            var renderer = Find(root, "shape-child").GetComponentInChildren<MeshRenderer>(true);
            var bulb = Find(root, "light-child").GetComponentInChildren<Light>(true);
            Assert.That(renderer.sharedMaterial.GetColor("_BaseColor").a, Is.EqualTo(0.25));
            Assert.That(bulb.intensity, Is.EqualTo(3));
            parent.Visible = false;
            states.Apply(input, hierarchy);
            Assert.That(spatial.TryRefresh(input, hierarchy, out error), Is.True, error);
            Assert.That(renderer.enabled, Is.False);
            Assert.That(bulb.enabled, Is.False);
            parent.Visible = true;
            states.Apply(input, hierarchy);
            spatial.Disable();
            Assert.That(renderer.enabled, Is.False);
            Assert.That(spatial.TryRefresh(input, hierarchy, out error), Is.True, error);
            Assert.That(renderer.enabled && renderer.gameObject.activeInHierarchy, Is.True);
            Assert.That(bulb.enabled && bulb.gameObject.activeInHierarchy, Is.True);
            var timeline = new ProjectedTimelineDefinition { TimelineId = "parent-opacity", DurationMs = 1000 };
            timeline.Tracks.Add(new ProjectedTimelineTrack { Target = new TimelineTrackTarget { NodeId = "node:stage", Property = TimelineProperty.Opacity }, Keyframes = { new TimelineKeyframe { TimeMs = 0, Number = new NumberKeyframeValue { Value = 1 } }, new TimelineKeyframe { TimeMs = 1000, Number = new NumberKeyframeValue { Value = 0 } } } });
            var player = new PresentationTimelinePlayer();
            Assert.That(player.TryStart(timeline, hierarchy, 0, out error), Is.True, error);
            player.Update(0.75);
            Assert.That(spatial.TryRefresh(input, hierarchy, out error), Is.True, error);
            Assert.That(renderer.sharedMaterial.GetColor("_BaseColor").a, Is.EqualTo(0.125));
            Assert.That(bulb.intensity, Is.EqualTo(1.5));
            parent.Active = false;
            states.Apply(input, hierarchy);
            Assert.That(spatial.TryRefresh(input, hierarchy, out error), Is.True, error);
            Assert.That(renderer.gameObject.activeInHierarchy, Is.False);
            Assert.That(bulb.gameObject.activeInHierarchy, Is.False);
        }
        finally { spatial.Dispose(); hierarchy.Clear(); UnityEngine.Object.DestroyImmediate(root); }
    }

    [TestCase(0.1)]
    [TestCase(180)]
    public void SpotAngleEndpointsArePreservedOrExplicitlyRejectedByTheEngineAdapter(double outerAngle)
    {
        var envelope = PresentationPreviewTestFixture.Create();
        var node = Node("spot-edge");
        node.Light = new LightNode
        {
            Spot = new SpotLight
            {
                Color = new SrgbColor { Red = 1 },
                IntensityCandela = 1,
                RangeMeters = 5,
                OuterAngleDegrees = outerAngle,
                InnerAngleDegrees = 0
            }
        };
        envelope.Projection.RuntimeCatalog.Nodes.Add(node);
        envelope.Projection.VisibleNodeIds.Add(node.NodeId);
        envelope.InitialState.NodeStates.Add(PresentationPreviewTestFixture.Node(node.NodeId));
        Assert.That(PresentationLocalPreviewAdapter.TryCreate(envelope, out var input, out string error), Is.True, error);
        var root = new GameObject("Spot angle boundary");
        var hierarchy = new PresentationNodeHierarchy();
        using var spatial = new PresentationSpatialRenderer();
        try
        {
            Assert.That(hierarchy.TryReplace(input, root.transform, out error), Is.True, error);
            if (spatial.TryBuild(input, hierarchy, out error))
            {
                var light = root.GetComponentInChildren<Light>(true);
                Assert.That(light.spotAngle, Is.EqualTo((float)outerAngle));
                Assert.That(light.innerSpotAngle, Is.Zero);
            }
            else
            {
                Assert.That(error, Is.EqualTo("spatial-spot-angle-unsupported"));
                Assert.That(root.GetComponentsInChildren<Light>(true), Is.Empty);
            }
        }
        finally { spatial.Dispose(); hierarchy.Clear(); UnityEngine.Object.DestroyImmediate(root); }
    }

    [Test]
    public void QuestRenderPipelineAllowsExplicitAdditionalLightShadows()
    {
        var pipeline = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>("Assets/Settings/Mobile_RPAsset.asset");
        Assert.That(pipeline, Is.Not.Null);
        var serialized = new SerializedObject(pipeline);
        Assert.That(serialized.FindProperty("m_AdditionalLightShadowsSupported").boolValue, Is.True);
    }

    private static GameObject Find(GameObject root, string name)
    {
        foreach (var child in root.GetComponentsInChildren<UnityEngine.Transform>(true)) if (child.name == name) return child.gameObject;
        Assert.Fail("Missing object: " + name);
        return null;
    }
}

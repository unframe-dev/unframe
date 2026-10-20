using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

public sealed class PresentationBakedRenderingEditModeTests
{
    [Test]
    public void BakedPartitionsSortByLayerWithinEachPhysicalSurfaceWithoutChangingItsDepthOrder()
    {
        var store = new PresentationRuntimeDataStore();
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out DeliveryManifest delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        var renders = store.Delivery.ProjectionProfile.RenderSurfaces;
        renders.Clear();
        foreach (ProjectedSurfaceDefinition surface in store.Catalog.Surfaces)
        {
            surface.LogicalSize = new Unframe.Presentation.Vector2 { X = 100, Y = 100 };
            surface.PhysicalSizeMeters = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
            foreach (uint layer in new[] { uint.MaxValue, 0u, 32768u })
                renders.Add(new DeliveredRenderSurface
                {
                    RenderSurfaceId = surface.SurfaceId + ":" + layer,
                    SemanticSurfaceId = surface.SurfaceId,
                    RendererKind = RendererKind.BakedWeb,
                    Layer = layer,
                    LogicalBounds = new LogicalBounds { X = layer == 0 ? 0 : 70, Y = 0, Width = 30, Height = 30 },
                });
        }
        var root = new GameObject("partition order root");
        var hierarchy = new PresentationNodeHierarchy();
        try
        {
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            using (var renderer = new PresentationBakedSurfaceRenderer())
            {
                Assert.That(renderer.TryBuild(store, hierarchy, out error), Is.True, error);
                int surfaces = 0;
                foreach (ProjectedSurfaceDefinition surface in store.Catalog.Surfaces)
                {
                    surfaces++;
                    Assert.That(hierarchy.Registry.TryGet(surface.HostNodeId, out GameObject host), Is.True);
                    Assert.That(host.GetComponent<SortingGroup>(), Is.Not.Null);
                    Assert.That(host.GetComponent<SortingGroup>().sortingOrder, Is.Zero,
                        "physical surfaces retain distance ordering instead of a global partition priority");
                    MeshRenderer background = host.transform.Find(surface.SurfaceId + ":0").GetComponent<MeshRenderer>();
                    MeshRenderer middle = host.transform.Find(surface.SurfaceId + ":32768").GetComponent<MeshRenderer>();
                    MeshRenderer foreground = host.transform.Find(surface.SurfaceId + ":" + uint.MaxValue).GetComponent<MeshRenderer>();
                    Assert.That(background.sortingOrder, Is.LessThan(middle.sortingOrder));
                    Assert.That(middle.sortingOrder, Is.LessThan(foreground.sortingOrder));
                    Assert.That(foreground.transform.localPosition.z, Is.Zero,
                        "uint32 layer is a compositing order, not a physical displacement");
                }
                Assert.That(surfaces, Is.GreaterThan(1));
                SortingGroup[] groups = root.GetComponentsInChildren<SortingGroup>();
                Assert.That(renderer.TryBuild(store, hierarchy, out error), Is.True, error);
                CollectionAssert.AreEquivalent(groups, root.GetComponentsInChildren<SortingGroup>(),
                    "rebuild must reuse groups so deferred destruction cannot remove the current surface ordering");
            }
            Assert.That(root.GetComponentsInChildren<SortingGroup>(), Is.Empty);
        }
        finally { hierarchy.Clear(); Object.DestroyImmediate(root); }
    }

    [Test]
    public void BakedShaderTargetsUniversalRenderPipelineWithoutImportErrors()
    {
        Shader shader = Resources.Load<Shader>("BakedSurface");
        Assert.That(shader, Is.Not.Null);
        var material = new Material(shader);
        try
        {
            Assert.That(material.GetTag("RenderPipeline", false), Is.EqualTo("UniversalPipeline"));
            Assert.That(material.FindPass("BakedSurface"), Is.GreaterThanOrEqualTo(0));
            Assert.That(ShaderUtil.ShaderHasError(shader), Is.False);
        }
        finally { Object.DestroyImmediate(material); }
    }

    [Test]
    public void BakedShaderIsPackagedWithTwoResidentTextureSlotsAndOpacity()
    {
        Shader shader = Resources.Load<Shader>("BakedSurface");
        Assert.That(shader, Is.Not.Null);
        using (var renderer = new PresentationBakedSurfaceRenderer())
        {
            var material = new Material(shader);
            try
            {
                Assert.That(material.HasProperty("_FromTex"), Is.True);
                Assert.That(material.HasProperty("_ToTex"), Is.True);
                Assert.That(material.HasProperty("_Blend"), Is.True);
                Assert.That(material.HasProperty("_Color"), Is.True);
            }
            finally { Object.DestroyImmediate(material); }
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void BakedOpacityUsesOneMaterialChannelForNodeStateAndTimeline(bool independentView)
    {
        var store = new PresentationRuntimeDataStore();
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out DeliveryManifest delivery, out string error), Is.True, error);
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
            out ControlServerItem snapshot, out error), Is.True, error);
        foreach (NodeRuntimeState node in snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates)
            if (node.NodeId == "node:text-greeting")
            {
                node.Opacity = 0.5;
                node.Transform.Position = new Unframe.Presentation.Vector3 { X = 2, Y = 3, Z = 4 };
            }
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryGetSurface("semantic-surface:text-greeting", out ProjectedSurfaceDefinition surface), Is.True);
        surface.LogicalSize = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        surface.PhysicalSizeMeters = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        store.Delivery.ProjectionProfile.RenderSurfaces.Clear();
        store.Delivery.ProjectionProfile.RenderSurfaces.Add(new DeliveredRenderSurface
        {
            RenderSurfaceId = "render:opacity",
            SemanticSurfaceId = surface.SurfaceId,
            RendererKind = RendererKind.BakedWeb,
            LogicalBounds = new LogicalBounds { Width = 1, Height = 1 },
            StateBindings = { new DeliveredStateBinding { StateId = "state:text-greeting", Empty = new EmptyStateBinding() } },
        });
        IPresentationRenderView view = independentView
            ? (IPresentationRenderView)new StaticRenderView(store.Delivery.ProjectionProfile.RuntimeCatalog,
                store.Delivery.ProjectionProfile.RenderSurfaces, store.Delivery.ProjectionProfile.SemanticSurfaces,
                snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates,
                snapshot.ConnectionSnapshot.Snapshot.RuntimeView.SurfaceStates)
            : store;
        var root = new GameObject("opacity root");
        var hierarchy = new PresentationNodeHierarchy();
        var timelines = new PresentationTimelinePlayer();
        try
        {
            Assert.That(hierarchy.TryReplace(view, root.transform, out error), Is.True, error);
            using (var renderer = new PresentationBakedSurfaceRenderer())
            using (var textures = new PresentationTextureResidency())
            {
                Assert.That(renderer.TryBuild(view, hierarchy, out error), Is.True, error);
                new PresentationNodeStateApplier().Apply(view, hierarchy);
                Assert.That(renderer.TryRefresh(view, textures, 0, out error), Is.True, error);
                Assert.That(hierarchy.Registry.TryGet("node:text-greeting", out GameObject host), Is.True);
                Assert.That(host.transform.localPosition, Is.EqualTo(new UnityEngine.Vector3(2, 3, -4)));
                MeshRenderer quad = host.transform.Find("render:opacity").GetComponent<MeshRenderer>();
                Assert.That(quad.transform.localScale, Is.EqualTo(UnityEngine.Vector3.one));
                Assert.That(quad.transform.localPosition, Is.EqualTo(UnityEngine.Vector3.zero));
                Assert.That(quad.sharedMaterial.GetColor("_Color").a, Is.EqualTo(0.5f).Within(0.0001f));
                Assert.That(quad.sharedMaterial.HasProperty("_Opacity"), Is.False, "baked shader must not multiply a second node opacity channel");
                var timeline = new ProjectedTimelineDefinition
                {
                    TimelineId = "timeline:opacity",
                    DurationMs = 1000,
                    Tracks =
                    {
                        new ProjectedTimelineTrack
                        {
                            Target = new TimelineTrackTarget { NodeId = "node:text-greeting", Property = TimelineProperty.Opacity },
                            Keyframes =
                            {
                                new TimelineKeyframe { TimeMs = 0, Number = new NumberKeyframeValue { Value = 0.5 } },
                                new TimelineKeyframe { TimeMs = 1000, Number = new NumberKeyframeValue { Value = 0 } },
                            },
                        },
                    },
                };
                Assert.That(timelines.TryStart(timeline, hierarchy, 0, out error), Is.True, error);
                Assert.That(renderer.TryRefresh(view, textures, 500, out error), Is.True, error);
                timelines.Update(0.5);
                Assert.That(quad.sharedMaterial.GetColor("_Color").a, Is.EqualTo(0.25f).Within(0.0001f));
                Assert.That(renderer.TryRefresh(view, textures, 1000, out error), Is.True, error);
                timelines.Update(1);
                Assert.That(quad.sharedMaterial.GetColor("_Color").a, Is.Zero);
            }
        }
        finally { timelines.Clear(); hierarchy.Clear(); Object.DestroyImmediate(root); }
    }

    [Test]
    public void TransitionEasingAndRuntimeClockFollowCanonicalTime()
    {
        MethodInfo ease = typeof(PresentationBakedSurfaceRenderer).GetMethod("Ease", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.That((float)ease.Invoke(null, new object[] { 0.5f, Easing.CubicIn }), Is.EqualTo(0.125f).Within(0.0001f));
        Assert.That((float)ease.Invoke(null, new object[] { 0.5f, Easing.CubicOut }), Is.EqualTo(0.875f).Within(0.0001f));

        MethodInfo sample = typeof(PresentationBakedRuntime).GetMethod("SampleRuntimeTimeMs", BindingFlags.NonPublic | BindingFlags.Static);
        var clock = new RuntimeClockSnapshot { RuntimeTimeMs = 1200, Running = new Running() };
        Assert.That((double)sample.Invoke(null, new object[] { clock, 10d, 10.4d }), Is.EqualTo(1600d).Within(0.001d));
        clock.Paused = new Paused { Reason = PauseReason.ExplicitPause };
        Assert.That((double)sample.Invoke(null, new object[] { clock, 10d, 30d }), Is.EqualTo(1200d));
    }

    private sealed class StaticRenderView : IPresentationRenderView
    {
        private readonly IEnumerable<NodeRuntimeState> nodes;
        private readonly IEnumerable<SurfaceRuntimeState> surfaces;

        public StaticRenderView(ProjectedRuntimeCatalog catalog, IEnumerable<DeliveredRenderSurface> renderSurfaces,
            IEnumerable<ProjectedSemanticSurface> semanticSurfaces, IEnumerable<NodeRuntimeState> nodes,
            IEnumerable<SurfaceRuntimeState> surfaces)
        {
            Catalog = catalog;
            RenderSurfaces = renderSurfaces;
            SemanticSurfaces = semanticSurfaces;
            this.nodes = nodes;
            this.surfaces = surfaces;
        }

        public ProjectedRuntimeCatalog Catalog { get; }
        public IEnumerable<DeliveredRenderSurface> RenderSurfaces { get; }
        public IEnumerable<ProjectedSemanticSurface> SemanticSurfaces { get; }
        public Unframe.Presentation.Pose StageOrigin { get { return null; } }
        public IEnumerable<RuntimeRunSnapshot> ActiveRuns { get { return System.Array.Empty<RuntimeRunSnapshot>(); } }

        public bool TryGetSurface(string id, out ProjectedSurfaceDefinition value)
        {
            foreach (ProjectedSurfaceDefinition surface in Catalog.Surfaces)
                if (surface.SurfaceId == id) { value = surface; return true; }
            value = null;
            return false;
        }

        public bool TryGetNodeState(string id, out NodeRuntimeState value)
        {
            foreach (NodeRuntimeState node in nodes)
                if (node.NodeId == id) { value = node; return true; }
            value = null;
            return false;
        }

        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value)
        {
            foreach (SurfaceRuntimeState surface in surfaces)
                if (surface.SurfaceId == id) { value = surface; return true; }
            value = null;
            return false;
        }

        public bool TryGetAnchorSample(string nodeId, out ProjectedAnchorBindingSample value)
        {
            value = null;
            return false;
        }
    }

}

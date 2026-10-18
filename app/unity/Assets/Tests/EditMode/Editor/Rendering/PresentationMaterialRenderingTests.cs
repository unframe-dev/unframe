using System.Collections.Generic;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.Rendering;

public sealed class PresentationMaterialRenderingTests
{
    private GameObject host;
    private LocalPresentationFixtureRunner runner;
    private DeliveryManifest delivery;
    private ControlServerItem snapshot;
    private readonly List<TextAsset> fixtures = new List<TextAsset>();

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("material-fixture-runner");
        runner = host.AddComponent<LocalPresentationFixtureRunner>();
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(
            Resources.Load<TextAsset>("PresentationFixtures/LocalDelivery").text,
            out delivery,
            out string error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(
            Resources.Load<TextAsset>("PresentationFixtures/LocalSnapshot").text,
            out snapshot,
            out error), Is.True, error);

        foreach (ProjectedNodeDefinition node in delivery.ProjectionProfile.RuntimeCatalog.Nodes)
        {
            if (node.NodeId == "node:opening-panel")
            {
                node.Shape.Material = new UnlitShapeMaterial
                {
                    Color = new Unframe.Presentation.SrgbaColor
                    {
                        Red = 0.2,
                        Green = 0.4,
                        Blue = 0.6,
                        Alpha = 0.5,
                    },
                    DoubleSided = true,
                    CastsShadows = false,
                };
            }
        }

        foreach (DeliveredRenderSurface surface in delivery.ProjectionProfile.RenderSurfaces)
        {
            if (surface.SemanticSurfaceId != "semantic-surface:text-greeting")
            {
                continue;
            }

            foreach (DeliveredArtifact artifact in surface.Artifacts)
            {
                foreach (NativeUiNode node in artifact.NativeUi.Nodes)
                {
                    if (node.NodeCase == NativeUiNode.NodeOneofCase.Text)
                    {
                        node.Text.Color = new Unframe.Delivery.SrgbaColor
                        {
                            Red = 0.2,
                            Green = 0.4,
                            Blue = 0.6,
                            Alpha = 0.5,
                        };
                    }
                }
            }
        }

        foreach (NodeRuntimeState state in snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates)
        {
            if (state.NodeId == "node:opening-panel" || state.NodeId == "node:text-greeting")
            {
                state.Opacity = 0.4;
            }
        }
    }

    [TearDown]
    public void TearDown()
    {
        Object.DestroyImmediate(host);
        foreach (TextAsset fixture in fixtures)
        {
            Object.DestroyImmediate(fixture);
        }

        fixtures.Clear();
    }

    [Test]
    public void ShapeUsesPresentationShaderWithContractColorOpacityAndShadowSettings()
    {
        Load();
        Renderer renderer = GetRenderer("node:opening-panel");
        Assert.That(renderer.sharedMaterial.shader.name, Is.EqualTo("Unframe/Presentation/Unlit"));
        AssertBaseColor(renderer, 0.2f);
        Assert.That(renderer.sharedMaterial.GetFloat("_Cull"), Is.EqualTo((float)CullMode.Off));
        Assert.That(renderer.shadowCastingMode, Is.EqualTo(ShadowCastingMode.Off));
        Assert.That(renderer.receiveShadows, Is.False);
    }

    [Test]
    public void ModelPlaceholderUsesPresentationShader()
    {
        Load();
        Assert.That(GetRenderer("node:cube").sharedMaterial.shader.name,
            Is.EqualTo("Unframe/Presentation/Unlit"));
    }

    [Test]
    public void TextUsesPresentationShaderAndFontAtlas()
    {
        Load();
        Assert.That(runner.Hierarchy.Registry.TryGet("node:text-greeting", out GameObject node), Is.True);
        TextMesh text = node.GetComponentInChildren<TextMesh>(true);
        Material material = text.GetComponent<Renderer>().sharedMaterial;
        Assert.That(material.shader.name, Is.EqualTo("Unframe/Presentation/Unlit"));
        Assert.That(material.GetTexture("_BaseMap"), Is.SameAs(text.font.material.mainTexture));
    }

    [Test]
    public void NativeUiColorCombinesWithRuntimeOpacity()
    {
        Load();
        AssertBaseColor(GetRenderer("node:text-greeting"), 0.2f);
    }

    [Test]
    public void SurfaceRefreshPreservesChangedVisibilityAndOpacityWithoutCompoundingAlpha()
    {
        TextAsset stateFixture = CreateFixture(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = 1,
                EventId = "event:change-text-opacity",
                Fence = CreateFence(),
                NodeStateCommitted = new NodeStateCommitted
                {
                    State = new NodeRuntimeState
                    {
                        NodeId = "node:text-greeting",
                        Active = true,
                        Visible = false,
                        Opacity = 0.6,
                    },
                },
            },
        });
        runner.SetReliableEventFixtures(new[]
        {
            stateFixture,
            CreateSurfaceRefreshFixture(2),
            CreateSurfaceRefreshFixture(3),
        });
        Load();
        for (int index = 0; index < 3; index++)
        {
            Assert.That(runner.TryAdvance(out string error), Is.True, error);
            Renderer renderer = GetRenderer("node:text-greeting");
            Assert.That(renderer.enabled, Is.False);
            AssertBaseColor(renderer, 0.3f);
        }
    }

    private void Load()
    {
        runner.SetDeliveryFixture(CreateFixture(delivery));
        runner.SetSnapshotFixture(CreateFixture(snapshot));
        Assert.That(runner.TryLoad(out string error), Is.True, error);
    }

    private Renderer GetRenderer(string nodeId)
    {
        Assert.That(runner.Hierarchy.Registry.TryGet(nodeId, out GameObject node), Is.True);
        Renderer renderer = node.GetComponentInChildren<Renderer>(true);
        Assert.That(renderer, Is.Not.Null);
        return renderer;
    }

    private static void AssertBaseColor(Renderer renderer, float alpha)
    {
        Assert.That(renderer.sharedMaterial.HasProperty("_BaseColor"), Is.True);
        Color actual = renderer.sharedMaterial.GetColor("_BaseColor");
        Color expected = new Color(0.2f, 0.4f, 0.6f, alpha);
        if (QualitySettings.activeColorSpace == ColorSpace.Linear)
        {
            expected = expected.linear;
        }

        Assert.That(actual.r, Is.EqualTo(expected.r).Within(0.001f));
        Assert.That(actual.g, Is.EqualTo(expected.g).Within(0.001f));
        Assert.That(actual.b, Is.EqualTo(expected.b).Within(0.001f));
        Assert.That(actual.a, Is.EqualTo(alpha).Within(0.001f));
    }

    private TextAsset CreateFixture(IMessage message)
    {
        TextAsset fixture = new TextAsset(JsonFormatter.Default.Format(message));
        fixtures.Add(fixture);
        return fixture;
    }

    private TextAsset CreateSurfaceRefreshFixture(ulong sequence)
    {
        return CreateFixture(new ControlServerItem
        {
            ReliableEvent = new ProjectedReliableEvent
            {
                Sequence = sequence,
                EventId = "event:surface-refresh-" + sequence,
                Fence = CreateFence(),
                SurfaceStateChanged = new SurfaceStateChanged
                {
                    SurfaceId = "semantic-surface:text-greeting",
                    StateId = "state:text-greeting",
                },
            },
        });
    }

    private RuntimeProjectionFence CreateFence()
    {
        return new RuntimeProjectionFence
        {
            SessionId = delivery.SessionId,
            Publication = delivery.Publication.Clone(),
            AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
            ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
        };
    }
}

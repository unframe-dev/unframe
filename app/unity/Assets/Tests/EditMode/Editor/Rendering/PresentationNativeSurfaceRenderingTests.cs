using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationNativeSurfaceRenderingTests
{
    [Test]
    public void NumberTextUsesInvariantFixedPrecisionAndCurrentVariable()
    {
        var source = new NativeTextValue { NumberVariable = new NumberVariableText { VariableId = "score", FractionDigits = 2 } };
        Assert.That(PresentationNativeSurfaceRenderer.TryResolveText(source,
            id => new VariableState { VariableId = id, Value = new ScalarValue { NumberValue = 12.5 } }, out string text), Is.True);
        Assert.That(text, Is.EqualTo("12.50"));
    }

    [Test]
    public void MissingVariableFailsInsteadOfShowingDefaultValue()
    {
        var source = new NativeTextValue { NumberVariable = new NumberVariableText { VariableId = "score" } };
        Assert.That(PresentationNativeSurfaceRenderer.TryResolveText(source, id => null, out _), Is.False);
    }

    [Test]
    public void NativeTextUsesDeliveredFontWithoutDependingOnDefaultFont() => VerifyNativeText(false);

    [Test]
    public void NativeUiRefreshPreservesContractColorVisibilityAndNonAccumulatingOpacity() => VerifyNativeText(true);

    private static void VerifyNativeText(bool verifyRefresh)
    {
        TMP_FontAsset previousDefault = TMP_Settings.defaultFontAsset;
        TMP_Settings.defaultFontAsset = null;
        var fontWarnings = new List<string>();
        Application.LogCallback captureWarning = (message, stack, type) =>
        {
            if (type == LogType.Warning && message.Contains("Font Asset")) fontWarnings.Add(message);
        };
        Application.logMessageReceived += captureWarning;
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out DeliveryManifest delivery, out string error), Is.True, error);
        string fontPath = Path.Combine(Application.dataPath, "TextMesh Pro/Fonts/LiberationSans.ttf");
        byte[] fontBytes = File.ReadAllBytes(fontPath);
        string fontChecksum;
        using (var sha = System.Security.Cryptography.SHA256.Create())
            fontChecksum = "sha256:" + System.BitConverter.ToString(sha.ComputeHash(fontBytes)).Replace("-", "").ToLowerInvariant();
        delivery.AssetAccess.Add(new AssetAccessBinding
        {
            AssetId = "font", Checksum = fontChecksum, MediaType = "font/ttf", EncodedSizeBytes = (ulong)fontBytes.Length,
        });
        delivery.Residency.NativeUi = new NativeUiResidencyPlan
        {
            FontAssetCount = 1, FontAssetIds = { "font" },
            Glyphs =
            {
                new GlyphResidencyKey { FontChecksum = fontChecksum, UnicodeScalar = '1' },
                new GlyphResidencyKey { FontChecksum = fontChecksum, UnicodeScalar = '2' },
                new GlyphResidencyKey { FontChecksum = fontChecksum, UnicodeScalar = '3' },
            },
        };
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
            out ControlServerItem snapshot, out error), Is.True, error);
        foreach (NodeRuntimeState state in snapshot.ConnectionSnapshot.Snapshot.RuntimeView.NodeStates)
            if (state.NodeId == "node:text-greeting") { state.Opacity = 0.4; state.Visible = true; }
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryGetSurface("semantic-surface:text-greeting", out ProjectedSurfaceDefinition surface), Is.True);
        surface.LogicalSize = new Unframe.Presentation.Vector2 { X = 100, Y = 100 };
        surface.PhysicalSizeMeters = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        var render = new DeliveredRenderSurface
        {
            RenderSurfaceId = "native-test", SemanticSurfaceId = surface.SurfaceId, RendererKind = RendererKind.NativeUi,
            LogicalBounds = new LogicalBounds { Width = 100, Height = 100 },
            StateBindings = { new DeliveredStateBinding { StateId = "state:text-greeting", Artifact = new ArtifactStateBinding { ArtifactId = "text" } } },
            Artifacts = { new DeliveredArtifact { NativeUi = new NativeUiArtifact
            {
                ArtifactId = "text", RootNodeId = "label", Nodes = { new NativeUiNode { Text = new NativeUiText
                {
                    NodeId = "label", Bounds = new LogicalBounds { X = 10, Y = 20, Width = 80, Height = 40 },
                    Font = new ResolvedFont { Primary = new FontFace { AssetId = "font" } }, FontSize = 20, LineHeight = 24,
                    Color = new Unframe.Delivery.SrgbaColor { Red = 0.2, Green = 0.4, Blue = 0.6, Alpha = 0.5 },
                    Align = NativeTextAlign.Start, Overflow = NativeTextOverflow.Clip, MaxCodePoints = 16,
                    Value = new NativeTextValue { Literal = new LiteralText { Value = "123" } },
                } } },
            } } },
        };
        store.Delivery.ProjectionProfile.RenderSurfaces.Clear();
        store.Delivery.ProjectionProfile.RenderSurfaces.Add(render);
        var root = new GameObject("native-test-root");
        var hierarchy = new PresentationNodeHierarchy();
        try
        {
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            using (var renderer = new PresentationNativeSurfaceRenderer())
            {
                var paths = new Dictionary<string, string> { { "font", fontPath } };
                Assert.That(renderer.TryBuild(store, hierarchy, paths, out error), Is.True, error);
                var text = root.GetComponentInChildren<TextMeshProUGUI>(true);
                Assert.That(text, Is.Not.Null);
                Assert.That(text.rectTransform.anchoredPosition, Is.EqualTo(new UnityEngine.Vector2(10, -20)));
                Assert.That(text.rectTransform.sizeDelta, Is.EqualTo(new UnityEngine.Vector2(80, 40)));
                Assert.That(text.canvas.renderMode, Is.EqualTo(RenderMode.WorldSpace));
                Assert.That(renderer.IsReady, Is.True);
                Assert.That(fontWarnings, Is.Empty, "The delivered font must be assigned before TextMeshPro initialization.");
                if (verifyRefresh)
                {
                    Assert.That(renderer.TryRefresh(store, 0, out error), Is.True, error);
                    var canvas = text.GetComponentInParent<Canvas>();
                    var opacity = canvas.GetComponent<CanvasGroup>();
                    Assert.That(text.color, Is.EqualTo(new Color(0.2f, 0.4f, 0.6f, 0.5f)));
                    Assert.That(opacity.alpha * text.color.a, Is.EqualTo(0.2f).Within(0.001f));
                    Assert.That(canvas.enabled, Is.True);
                    Assert.That(store.TryGetNodeState("node:text-greeting", out NodeRuntimeState current), Is.True);
                    NodeRuntimeState changed = current.Clone();
                    changed.Opacity = 0.6;
                    changed.Visible = false;
                    Assert.That(store.TryReceiveControl(new ControlServerItem
                    {
                        ReliableEvent = new ProjectedReliableEvent
                        {
                            Sequence = 1, EventId = "event:change-text-opacity",
                            Fence = new RuntimeProjectionFence
                            {
                                SessionId = delivery.SessionId, Publication = delivery.Publication.Clone(),
                                AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
                                ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
                            },
                            NodeStateCommitted = new NodeStateCommitted { State = changed },
                        },
                    }, out error), Is.True, error);
                    for (int refresh = 0; refresh < 3; refresh++)
                    {
                        Assert.That(renderer.TryRefresh(store, refresh + 1, out error), Is.True, error);
                        Assert.That(canvas.enabled, Is.False);
                        Assert.That(text.color, Is.EqualTo(new Color(0.2f, 0.4f, 0.6f, 0.5f)));
                        Assert.That(opacity.alpha * text.color.a, Is.EqualTo(0.3f).Within(0.001f),
                            "Refresh must apply authoritative opacity without multiplying the previous alpha.");
                    }
                }
                UnityEngine.Object.DestroyImmediate(text.gameObject);
                Assert.That(renderer.IsReady, Is.False);
            }
        }
        finally
        {
            Application.logMessageReceived -= captureWarning;
            TMP_Settings.defaultFontAsset = previousDefault;
            hierarchy.Clear();
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void VideoClockSamplesPausedAndLoopedPositions()
    {
        Assert.That(PresentationVideoSurfaceRenderer.SamplePositionMs(new PlaybackClock
        { Paused = new PausedClock { PositionMs = 750 } }, 4000, 1000, false), Is.EqualTo(750));
        Assert.That(PresentationVideoSurfaceRenderer.SamplePositionMs(new PlaybackClock
        { Playing = new PlayingClock { PositionAtReferenceMs = 250, ReferenceRuntimeTimeMs = 1000 } }, 2250, 1000, true), Is.EqualTo(500));
    }
}

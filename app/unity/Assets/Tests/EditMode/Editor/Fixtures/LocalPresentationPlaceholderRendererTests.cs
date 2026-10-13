using System.Reflection;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class LocalPresentationPlaceholderRendererTests
{
    [TestCase("A long heading that must wrap without overflowing its panel")]
    [TestCase("MRならではの表現を使いながら、伝わりやすさを保ち、自分もやってみたくなるプレゼンへ。")]
    public void LongTextWrapsAndFitsItsDeclaredBounds(string literal)
    {
        var root = new GameObject("text-layout-test");
        try
        {
            TextMesh text = Create(root.transform, literal,
                new LogicalBounds { X = 0.3, Y = 0.2, Width = 2.4, Height = 1.1 },
                new LogicalBounds { Width = 3, Height = 1.5 });
            Assert.That(text.text, Does.Contain("\n"));
            Assert.That(text.text.Replace("\n", ""), Is.EqualTo(literal));
            Assert.That(text.transform.localScale.x, Is.EqualTo(text.transform.localScale.y));
            AssertFits(text, new Rect(-1.2f, -0.55f, 2.4f, 1.1f));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void FitUsesLocalCoordinatesRegardlessOfParentScaleAndRotation()
    {
        var root = new GameObject("nested-text-layout-test");
        try
        {
            root.transform.localScale = new Vector3(0.225f, 0.225f, 0.225f);
            root.transform.rotation = Quaternion.Euler(15f, 35f, 0f);
            TextMesh text = Create(root.transform, "A larger line\nA second line\nThird line",
                new LogicalBounds { X = 0.4, Y = 0.3, Width = 2, Height = 0.8 },
                new LogicalBounds { Width = 3, Height = 2 });
            AssertFits(text, new Rect(-1.1f, -0.1f, 2f, 0.8f));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void TextBoundsAreConstrainedToTheSurfaceCanvas()
    {
        var root = new GameObject("clip-layout-test");
        try
        {
            TextMesh text = Create(root.transform, "An overlapping layout box",
                new LogicalBounds { X = -1, Y = -1, Width = 5, Height = 5 },
                new LogicalBounds { Width = 2, Height = 1 });
            AssertFits(text, new Rect(-1f, -0.5f, 2f, 1f));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void SurfaceRefreshFitsReplacementTextAndPreservesOpacity()
    {
        var host = new GameObject("refresh-layout-test");
        var renderer = new LocalPresentationPlaceholderRenderer();
        try
        {
            var runner = host.AddComponent<LocalPresentationFixtureRunner>();
            Assert.That(runner.TryLoad(out string error), Is.True, error);
            DeliveredRenderSurface surface = runner.Store.Delivery.ProjectionProfile.RenderSurfaces[0];
            surface.LogicalBounds = new LogicalBounds { Width = 3, Height = 1.5 };
            foreach (DeliveredArtifact artifact in surface.Artifacts)
            {
                if (artifact.NativeUi == null) continue;
                foreach (NativeUiNode node in artifact.NativeUi.Nodes)
                {
                    if (node.Text != null) node.Text.Bounds = new LogicalBounds { X = 0.3, Y = 0.2, Width = 2.4, Height = 1.1 };
                }
            }
            renderer.Render(runner.Store, runner.Hierarchy);
            TextMesh initial = FindText(runner, surface.SemanticSurfaceId);
            var opacityType = typeof(LocalPresentationPlaceholderRenderer).Assembly.GetType("Unframe.Unity.PresentationRuntime.PresentationVisualOpacity");
            opacityType.GetMethod("Apply").Invoke(null, new object[] { initial.gameObject, 0.3f });
            initial.GetComponent<Renderer>().enabled = false;
            foreach (DeliveredArtifact artifact in surface.Artifacts)
            {
                if (artifact.NativeUi == null) continue;
                foreach (NativeUiNode node in artifact.NativeUi.Nodes)
                {
                    if (node.Text != null) node.Text.Value.Literal.Value = "A replacement heading that is much longer than the original.";
                }
            }
            renderer.RefreshSurfaces(runner.Store);
            TextMesh refreshed = FindText(runner, surface.SemanticSurfaceId);
            Assert.That(initial == null, Is.True);
            Assert.That(refreshed.text, Does.Contain("\n"));
            Assert.That(refreshed.GetComponent<Renderer>().enabled, Is.False);
            Assert.That((float)opacityType.GetProperty("Opacity", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(refreshed.GetComponent(opacityType)), Is.EqualTo(0.3f).Within(0.001f));
            AssertFits(refreshed, new Rect(-1.2f, -0.55f, 2.4f, 1.1f));
        }
        finally
        {
            renderer.Clear();
            Object.DestroyImmediate(host);
        }
    }

    [TestCase(NativeTextAlign.Start)]
    [TestCase(NativeTextAlign.Center)]
    [TestCase(NativeTextAlign.End)]
    public void TextUsesTheRequestedHorizontalAlignment(NativeTextAlign align)
    {
        var root = new GameObject("aligned-text-test");
        try
        {
            var rect = new Rect(-1.2f, -0.55f, 2.4f, 1.1f);
            TextMesh text = Create(root.transform, "Short\nLonger text",
                new LogicalBounds { X = .3, Y = .2, Width = 2.4, Height = 1.1 },
                new LogicalBounds { Width = 3, Height = 1.5 }, align);
            Assert.That(text.alignment, Is.EqualTo(align == NativeTextAlign.Start ? TextAlignment.Left
                : align == NativeTextAlign.End ? TextAlignment.Right : TextAlignment.Center));
            Bounds measured = text.GetComponent<Renderer>().localBounds;
            float min = text.transform.localPosition.x + measured.min.x * text.transform.localScale.x;
            float max = text.transform.localPosition.x + measured.max.x * text.transform.localScale.x;
            if (align == NativeTextAlign.Start) Assert.That(min, Is.EqualTo(rect.xMin).Within(.001f));
            else if (align == NativeTextAlign.End) Assert.That(max, Is.EqualTo(rect.xMax).Within(.001f));
            else Assert.That((min + max) / 2, Is.EqualTo(rect.center.x).Within(.001f));
            AssertFits(text, rect);
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void BodyTextKeepsItsSmallerTypeSizeAndLineHeight()
    {
        var root = new GameObject("text-hierarchy-test");
        try
        {
            var bounds = new LogicalBounds { Width = 6, Height = 3 };
            TextMesh title = Create(root.transform, "Title", bounds, bounds, NativeTextAlign.Start, 20, 24);
            TextMesh body = Create(root.transform, "Body", bounds, bounds, NativeTextAlign.Start, 13, 17);
            Assert.That(body.characterSize / title.characterSize, Is.EqualTo(13f / 20).Within(.001f));
            Assert.That(body.lineSpacing, Is.EqualTo(17f / 13).Within(.001f));
        }
        finally { Object.DestroyImmediate(root); }
    }

    [Test]
    public void LowerBodyTextRemainsVisibleOverItsPanelFromAnElevatedView()
    {
        var root = new GameObject("panel-body-render-test");
        var cameraObject = new GameObject("panel-body-camera");
        var output = new RenderTexture(512, 512, 24);
        var pixels = new Texture2D(512, 512, TextureFormat.RGB24, false);
        var panelMaterial = new Material(Resources.Load<Shader>("PresentationMaterials/PresentationUnlit"));
        RenderTexture previous = RenderTexture.active;
        try
        {
            var panel = GameObject.CreatePrimitive(PrimitiveType.Cube);
            panel.transform.SetParent(root.transform, false);
            panel.transform.localScale = new Vector3(3, 1.5f, .02f);
            panel.layer = 30;
            panelMaterial.SetColor("_BaseColor", Color.white);
            panel.GetComponent<Renderer>().sharedMaterial = panelMaterial;
            TextMesh text = Create(root.transform, "Body text", new LogicalBounds
            { X = .3, Y = .9, Width = 2.4, Height = .4 },
                new LogicalBounds { Width = 3, Height = 1.5 }, NativeTextAlign.Start, 13, 17);
            text.gameObject.layer = 30;
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.transform.position = new Vector3(0, .75f, -2.7f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.white;
            camera.cullingMask = 1 << 30;
            camera.targetTexture = output;
            camera.Render();
            RenderTexture.active = output;
            pixels.ReadPixels(new Rect(0, 0, 512, 512), 0, 0);
            pixels.Apply();
            int ink = 0;
            foreach (Color pixel in pixels.GetPixels()) if (pixel.grayscale < .2f) ink++;
            Assert.That(ink, Is.GreaterThan(30), "The panel must not cover text positioned in front of it.");
        }
        finally
        {
            RenderTexture.active = previous;
            Object.DestroyImmediate(cameraObject);
            Object.DestroyImmediate(root);
            output.Release();
            Object.DestroyImmediate(output);
            Object.DestroyImmediate(pixels);
            Object.DestroyImmediate(panelMaterial);
        }
    }

    private static TextMesh FindText(LocalPresentationFixtureRunner runner, string surfaceId)
    {
        foreach (Unframe.Presentation.ProjectedNodeDefinition node in runner.Store.Nodes)
        {
            if (node.Surface == null || node.Surface.SemanticSurfaceId != surfaceId) continue;
            Assert.That(runner.Hierarchy.Registry.TryGet(node.NodeId, out GameObject nodeObject), Is.True);
            TextMesh[] texts = nodeObject.GetComponentsInChildren<TextMesh>(true);
            return texts[texts.Length - 1];
        }
        Assert.Fail("Expected a text surface.");
        return null;
    }

    private static TextMesh Create(Transform parent, string literal, LogicalBounds bounds, LogicalBounds surface,
        NativeTextAlign align = NativeTextAlign.Center, double fontSize = 0, double lineHeight = 0)
    {
        var value = new NativeUiText
        {
            Value = new NativeTextValue { Literal = new LiteralText { Value = literal } },
            Bounds = bounds,
            Align = align,
            FontSize = fontSize,
            LineHeight = lineHeight,
            Color = new SrgbaColor { Red = 0, Green = 0, Blue = 0, Alpha = 1 }
        };
        var method = typeof(LocalPresentationPlaceholderRenderer).GetMethod("CreateText", BindingFlags.NonPublic | BindingFlags.Static);
        var created = (GameObject)method.Invoke(null, new object[] { parent, value, surface, 0 });
        return created.GetComponent<TextMesh>();
    }

    private static void AssertFits(TextMesh text, Rect bounds)
    {
        Bounds measured = text.GetComponent<Renderer>().localBounds;
        Vector3 min = text.transform.localPosition + Vector3.Scale(measured.min, text.transform.localScale);
        Vector3 max = text.transform.localPosition + Vector3.Scale(measured.max, text.transform.localScale);
        Assert.That(min.x, Is.GreaterThanOrEqualTo(bounds.xMin - 0.001f));
        Assert.That(max.x, Is.LessThanOrEqualTo(bounds.xMax + 0.001f));
        Assert.That(min.y, Is.GreaterThanOrEqualTo(bounds.yMin - 0.001f));
        Assert.That(max.y, Is.LessThanOrEqualTo(bounds.yMax + 0.001f));
    }
}

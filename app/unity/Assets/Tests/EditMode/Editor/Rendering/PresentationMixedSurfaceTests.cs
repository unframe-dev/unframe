using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;
using UnityEngine.UI;
using AssetDatabase = UnityEditor.AssetDatabase;
using Object = UnityEngine.Object;

public sealed class PresentationMixedSurfaceTests
{
    private sealed class Decoder : IPresentationVideoDecoder
    {
        public Texture Frame = Texture2D.blackTexture;
        public Texture Texture => Frame;
        public bool IsPrepared { get; private set; }
        public Task PrepareAsync(VideoArtifact artifact, string url, CancellationToken token) { IsPrepared = true; return Task.CompletedTask; }
        public bool TryApply(bool playing, double seconds, out string error) { error = null; return true; }
        public void Pause() { }
        public void Dispose() { IsPrepared = false; }
    }
    private static PresentationRuntimeDataStore Store(out ProjectedSurfaceDefinition surface, bool nativeFont = false)
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out DeliveryManifest delivery, out string error), Is.True, error);
        if (nativeFont)
        {
            string path = System.IO.Path.Combine(Application.dataPath, "TextMesh Pro/Fonts/LiberationSans.ttf");
            byte[] font = System.IO.File.ReadAllBytes(path); string checksum;
            using (var sha = SHA256.Create()) checksum = "sha256:" + BitConverter.ToString(sha.ComputeHash(font)).Replace("-", "").ToLowerInvariant();
            delivery.AssetAccess.Add(new AssetAccessBinding { AssetId = "font", Checksum = checksum, MediaType = "font/ttf", EncodedSizeBytes = (ulong)font.Length });
            delivery.Residency.NativeUi = new NativeUiResidencyPlan { FontAssetIds = { "font" }, Glyphs = { new GlyphResidencyKey { FontChecksum = checksum, UnicodeScalar = 'M' } } };
        }
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(delivery, out error), Is.True, error);
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
            out ControlServerItem snapshot, out error), Is.True, error);
        Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
        Assert.That(store.TryGetSurface("semantic-surface:text-greeting", out surface), Is.True);
        surface.LogicalSize = new Unframe.Presentation.Vector2 { X = 100, Y = 100 };
        surface.PhysicalSizeMeters = new Unframe.Presentation.Vector2 { X = 1, Y = 1 };
        store.Delivery.ProjectionProfile.RenderSurfaces.Clear();
        store.Delivery.ProjectionProfile.SemanticSurfaces.Clear();
        return store;
    }
    private static DeliveredRenderSurface Partition(ProjectedSurfaceDefinition surface, RendererKind kind, uint layer)
    {
        return new DeliveredRenderSurface
        {
            RenderSurfaceId = kind.ToString(),
            SemanticSurfaceId = surface.SurfaceId,
            RendererKind = kind,
            Layer = layer,
            LogicalBounds = new LogicalBounds { Width = 100, Height = 100 }
        };
    }
    private static byte[] AddVideo(PresentationRuntimeDataStore store, DeliveredRenderSurface render, string stateId)
    {
        byte[] bytes = PresentationTestFixtures.Load("Video").bytes;
        string checksum; using (var sha = SHA256.Create()) checksum = "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        render.Artifacts.Add(new DeliveredArtifact
        {
            Video = new VideoArtifact
            {
                ArtifactId = "video",
                VideoAssetId = "video:one",
                Checksum = checksum,
                EncodedSizeBytes = (ulong)bytes.Length,
                Codec = VideoCodec.H264,
                PixelSize = new PixelSize { Width = 320, Height = 180 },
                DurationMs = 6000,
                HasAudio = true,
                Fit = SurfaceFit.Contain
            }
        });
        render.StateBindings.Add(new DeliveredStateBinding { StateId = stateId, Artifact = new ArtifactStateBinding { ArtifactId = "video" } });
        store.Delivery.ProjectionProfile.RenderSurfaces.Add(render);
        return bytes;
    }
    [Test]
    public async Task ActualMixedRenderersShareLayerOrderWithoutMovingTheSurfacePlane()
    {
        var store = Store(out var surface);
        store.TryGetSurfaceState(surface.SurfaceId, out var state);
        var render = Partition(surface, RendererKind.Video, 0);
        byte[] bytes = AddVideo(store, render, state.StateId);
        store.Delivery.ProjectionProfile.RenderSurfaces.Add(Partition(surface, RendererKind.NativeUi, 1));
        store.Delivery.ProjectionProfile.RenderSurfaces.Add(Partition(surface, RendererKind.BakedWeb, uint.MaxValue));
        var root = new GameObject("Mixed renderer layers"); var hierarchy = new PresentationNodeHierarchy();
        using (var baked = new PresentationBakedSurfaceRenderer())
        using (var native = new PresentationNativeSurfaceRenderer())
        using (var videos = new PresentationVideoResidency(() => new Decoder()))
        {
            try
            {
                Assert.That(hierarchy.TryReplace(store, root.transform, out var error), Is.True, error);
                hierarchy.Registry.TryGet(surface.HostNodeId, out var host);
                Assert.That(baked.TryBuild(store, hierarchy, out error), Is.True, error);
                Assert.That(native.TryBuild(store, hierarchy, new Dictionary<string, string>(), out error), Is.True, error);
                await videos.BuildAsync(store, hierarchy, (_, __) => Task.FromResult(new PresentationPreviewAssetData(bytes, "video/mp4")), CancellationToken.None);
                var back = host.transform.Find("Video"); var middle = host.transform.Find("NativeUi"); var front = host.transform.Find("BakedWeb");
                Assert.That(back.GetComponent<MeshRenderer>().sortingOrder, Is.LessThan(middle.GetComponent<Canvas>().sortingOrder));
                Assert.That(middle.GetComponent<Canvas>().sortingOrder, Is.LessThan(front.GetComponent<MeshRenderer>().sortingOrder));
                Assert.That(back.localPosition.z, Is.Zero); Assert.That(middle.localPosition.z, Is.Zero); Assert.That(front.localPosition.z, Is.Zero);
            }
            finally { hierarchy.Clear(); Object.DestroyImmediate(root); }
        }
    }
    [Test]
    public async Task ScenePicksVisibleVideoInSemanticCoordinatesAndStopsAfterDisable()
    {
        var store = Store(out var surface);
        store.TryGetSurfaceState(surface.SurfaceId, out var state);
        byte[] bytes = AddVideo(store, Partition(surface, RendererKind.Video, 0), state.StateId);
        store.Delivery.ProjectionProfile.SemanticSurfaces.Add(new ProjectedSemanticSurface
        {
            SemanticSurfaceId = surface.SurfaceId,
            States = { new SurfaceSemanticState { StateId = state.StateId, InteractiveRegions = { new InteractiveRegion
            {
                InteractionId = "continue", NormalizedBounds = new LogicalBounds { X = .25, Y = .25, Width = .5, Height = .5 }
            } } } }
        });
        var root = new GameObject("Video semantic picking"); var hierarchy = new PresentationNodeHierarchy();
        using (var scene = new PresentationSceneRenderer())
        {
            try
            {
                Assert.That(hierarchy.TryReplace(store, root.transform, out var error), Is.True, error);
                hierarchy.Registry.TryGet(surface.HostNodeId, out var host); host.SetActive(true);
                store.TryGetNodeState(surface.HostNodeId, out var node); node.Active = node.Visible = true; node.Opacity = 1;
                var baked = new PresentationBakedSurfaceRenderer(); var native = new PresentationNativeSurfaceRenderer();
                var videos = new PresentationVideoResidency(() => new Decoder());
                Assert.That(baked.TryBuild(store, hierarchy, out error), Is.True, error);
                Assert.That(native.TryBuild(store, hierarchy, new Dictionary<string, string>(), out error), Is.True, error);
                await videos.BuildAsync(store, hierarchy, (_, __) => Task.FromResult(new PresentationPreviewAssetData(bytes, "video/mp4")), CancellationToken.None);
                Assert.That(videos.TryUpdate(store, 0, out error), Is.True, error);
                var flags = BindingFlags.Instance | BindingFlags.NonPublic;
                typeof(PresentationSceneRenderer).GetField("baked", flags).SetValue(scene, baked);
                typeof(PresentationSceneRenderer).GetField("native", flags).SetValue(scene, native);
                typeof(PresentationSceneRenderer).GetProperty("Videos").SetValue(scene, videos);
                typeof(PresentationSceneRenderer).GetField("loaded", flags).SetValue(scene, true);
                typeof(PresentationSceneRenderer).GetField("interactionsEnabled", flags)?.SetValue(scene, true);
                Ray RayAt(float y) => new Ray(host.transform.TransformPoint(new UnityEngine.Vector3(0, y, -1)), host.transform.forward);
                Assert.That(scene.TryPickInteraction(RayAt(.2f), store, out var id, out var interaction), Is.True);
                Assert.That(id, Is.EqualTo(surface.SurfaceId)); Assert.That(interaction, Is.EqualTo("continue"));
                Assert.That(scene.TryPickInteraction(RayAt(.4f), store, out _, out _), Is.False, "Letterboxed video does not occupy the whole semantic surface.");
                node.Visible = false;
                Assert.That(scene.TryPickInteraction(RayAt(0), store, out _, out _), Is.False);
                node.Visible = true; scene.Disable();
                Assert.That(scene.TryPickInteraction(RayAt(0), store, out _, out _), Is.False);
            }
            finally { hierarchy.Clear(); Object.DestroyImmediate(root); }
        }
    }
    [UnityTest]
    public IEnumerator MixedCanvasAndMeshPixelsFollowEveryLayerPermutation()
    {
        yield return new EnterPlayMode();
        yield return RenderMixedLayerPermutations();
        yield return new ExitPlayMode();
    }

    private static IEnumerator RenderMixedLayerPermutations()
    {
        var previousScene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
        var scene = UnityEngine.SceneManagement.SceneManager.CreateScene("Mixed surface compositing");
        UnityEngine.SceneManagement.SceneManager.SetActiveScene(scene);
        var previousDefault = GraphicsSettings.defaultRenderPipeline;
        var previousQuality = QualitySettings.renderPipeline;
        var previousTarget = RenderTexture.active;
        var cameraHost = new GameObject("Mixed surface camera", typeof(Camera));
        var target = new RenderTexture(128, 128, 24, RenderTextureFormat.ARGB32);
        var pixels = new Texture2D(128, 128, TextureFormat.RGBA32, false);
        var red = new Texture2D(1, 1, TextureFormat.RGBA32, false);
        var blue = new Texture2D(1, 1, TextureFormat.RGBA32, false);
        red.SetPixel(0, 0, Color.red); red.Apply(); blue.SetPixel(0, 0, Color.blue); blue.Apply();
        try
        {
            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/PC_RPAsset.asset");
            Assert.That(pipeline, Is.Not.Null);
            GraphicsSettings.defaultRenderPipeline = pipeline; QualitySettings.renderPipeline = pipeline;
            var camera = cameraHost.GetComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.black;
            camera.orthographic = true; camera.orthographicSize = .6f; camera.aspect = 1;
            camera.nearClipPlane = .01f; camera.farClipPlane = 10;
            camera.stereoTargetEye = StereoTargetEyeMask.None; camera.cullingMask = 1 << 31;
            target.Create();
            for (int permutation = 0; permutation < 3; permutation++)
            {
                var store = Store(out var surface, true); store.TryGetSurfaceState(surface.SurfaceId, out var state);
                var video = Partition(surface, RendererKind.Video, (uint)permutation);
                byte[] bytes = AddVideo(store, video, state.StateId); video.Artifacts[0].Video.Fit = SurfaceFit.Stretch;
                var nativePartition = Partition(surface, RendererKind.NativeUi, (uint)((permutation + 1) % 3));
                nativePartition.StateBindings.Add(new DeliveredStateBinding { StateId = state.StateId, Artifact = new ArtifactStateBinding { ArtifactId = "letters" } });
                nativePartition.Artifacts.Add(new DeliveredArtifact
                {
                    NativeUi = new NativeUiArtifact
                    {
                        ArtifactId = "letters",
                        RootNodeId = "clipped-group",
                        Nodes =
                    {
                        new NativeUiNode { Group = new NativeUiGroup { NodeId = "clipped-group", Clip = true, Bounds = new LogicalBounds { Width = 50, Height = 100 }, ChildNodeIds = { "letters" } } },
                        new NativeUiNode { Text = new NativeUiText
                        {
                            NodeId = "letters", Bounds = new LogicalBounds { Width = 100, Height = 100 },
                            Font = new ResolvedFont { Primary = new FontFace { AssetId = "font" } }, FontSize = 90, LineHeight = 100,
                            Color = new Unframe.Delivery.SrgbaColor { Green = 1, Alpha = 1 }, Align = NativeTextAlign.Start,
                            Overflow = NativeTextOverflow.Clip, MaxCodePoints = 8, Value = new NativeTextValue { Literal = new LiteralText { Value = "MMMM" } }
                        } }
                    }
                    }
                });
                store.Delivery.ProjectionProfile.RenderSurfaces.Add(nativePartition);
                string fontPath = System.IO.Path.Combine(Application.dataPath, "TextMesh Pro/Fonts/LiberationSans.ttf");
                store.Delivery.ProjectionProfile.RenderSurfaces.Add(Partition(surface, RendererKind.BakedWeb, (uint)((permutation + 2) % 3)));
                var root = new GameObject("Mixed layers " + permutation); var hierarchy = new PresentationNodeHierarchy();
                using (var baked = new PresentationBakedSurfaceRenderer())
                using (var native = new PresentationNativeSurfaceRenderer())
                using (var videos = new PresentationVideoResidency(() => new Decoder { Frame = red }))
                {
                    try
                    {
                        Assert.That(hierarchy.TryReplace(store, root.transform, out var error), Is.True, error);
                        hierarchy.Registry.TryGet(surface.HostNodeId, out var host);
                        host.SetActive(true); host.transform.SetPositionAndRotation(new UnityEngine.Vector3(0, 0, 2), UnityEngine.Quaternion.identity);
                        host.transform.localScale = UnityEngine.Vector3.one;
                        store.TryGetNodeState(surface.HostNodeId, out var node); node.Active = node.Visible = true; node.Opacity = 1;
                        Assert.That(baked.TryBuild(store, hierarchy, out error), Is.True, error);
                        Assert.That(native.TryBuild(store, hierarchy, new Dictionary<string, string> { { "font", fontPath } }, out error), Is.True, error);
                        Assert.That(native.TryRefresh(store, 0, out error), Is.True, error);
                        var load = videos.BuildAsync(store, hierarchy, (_, __) => Task.FromResult(new PresentationPreviewAssetData(bytes, "video/mp4")), CancellationToken.None);
                        while (!load.IsCompleted) yield return null;
                        load.GetAwaiter().GetResult(); Assert.That(videos.TryUpdate(store, 0, out error), Is.True, error);
                        var canvas = host.transform.Find("NativeUi").GetComponent<Canvas>();
                        canvas.worldCamera = camera;
                        var mesh = host.transform.Find("BakedWeb").GetComponent<MeshRenderer>();
                        mesh.sharedMaterial.SetTexture("_FromTex", blue); mesh.sharedMaterial.SetTexture("_ToTex", blue);
                        foreach (UnityEngine.Transform child in root.GetComponentsInChildren<UnityEngine.Transform>(true)) child.gameObject.layer = 31;
                        var videoMesh = host.transform.Find("Video").GetComponent<MeshRenderer>();
                        videoMesh.enabled = false; mesh.enabled = false;
                        for (int frame = 0; frame < 3; frame++) yield return null;
                        Canvas.ForceUpdateCanvases();
                        Assert.That(native.TryRefresh(store, 0, out error), Is.True, error);
                        void Capture()
                        {
                            RenderPipeline.SubmitRenderRequest(camera, new UniversalRenderPipeline.SingleCameraRequest { destination = target });
                            RenderTexture.active = target; pixels.ReadPixels(new Rect(0, 0, 128, 128), 0, 0); pixels.Apply();
                        }
                        Capture();
                        var nativePoints = new List<UnityEngine.Vector2Int>();
                        for (int y = 0; y < 128; y++)
                            for (int x = 0; x < 128; x++)
                            {
                                Color pixel = pixels.GetPixel(x, y);
                                if (pixel.g > .9f && pixel.r < .05f && pixel.b < .05f) nativePoints.Add(new UnityEngine.Vector2Int(x, y));
                                if (x > 65) Assert.That(pixel.g, Is.LessThan(.05f), "Parent group clip must remove right-half glyphs.");
                            }
                        System.IO.File.WriteAllBytes(System.IO.Path.Combine(Application.temporaryCachePath, "native-only-" + permutation + ".png"), pixels.EncodeToPNG());
                        Assert.That(nativePoints.Count, Is.GreaterThan(30), "Delivered Native UI letters must produce visible pixels.");
                        int videoOrder = videoMesh.sortingOrder;
                        var nativeGroup = canvas.GetComponent<SortingGroup>(); int nativeOrder = nativeGroup.sortingOrder;
                        nativeGroup.sortingOrder = 1; videoMesh.sortingOrder = 0; videoMesh.enabled = true;
                        yield return null; Capture();
                        Color[] nativeOverVideo = pixels.GetPixels();
                        int referenceGlyphs = 0;
                        foreach (var point in nativePoints)
                        { Color pixel = nativeOverVideo[point.y * 128 + point.x]; if (pixel.g > .9f && pixel.r < .6f) referenceGlyphs++; }
                        Assert.That(referenceGlyphs, Is.GreaterThan(30), "Reference must contain Native glyphs composited over the red video.");
                        nativeGroup.sortingOrder = nativeOrder; videoMesh.sortingOrder = videoOrder; mesh.enabled = true;
                        yield return null; Capture();
                        string directory = System.IO.Path.Combine(Application.temporaryCachePath, "unframe-mixed-surface-pixels");
                        System.IO.Directory.CreateDirectory(directory); System.IO.File.WriteAllBytes(System.IO.Path.Combine(directory, permutation + ".png"), pixels.EncodeToPNG());
                        Color expected = permutation == 0 ? Color.blue : permutation == 1 ? Color.green : Color.red;
                        foreach (var point in nativePoints)
                        {
                            Color actual = pixels.GetPixel(point.x, point.y);
                            Color expectedPixel = permutation == 1 ? nativeOverVideo[point.y * 128 + point.x] : expected;
                            Assert.That(actual.r, Is.EqualTo(expectedPixel.r).Within(.015f), "red at permutation " + permutation);
                            Assert.That(actual.g, Is.EqualTo(expectedPixel.g).Within(.015f), "green at permutation " + permutation);
                            Assert.That(actual.b, Is.EqualTo(expectedPixel.b).Within(.015f), "blue at permutation " + permutation);
                        }
                    }
                    finally { hierarchy.Clear(); Object.DestroyImmediate(root); }
                }
            }
        }
        finally
        {
            GraphicsSettings.defaultRenderPipeline = previousDefault; QualitySettings.renderPipeline = previousQuality;
            RenderTexture.active = previousTarget; target.Release(); Object.DestroyImmediate(target); Object.DestroyImmediate(pixels);
            Object.DestroyImmediate(red); Object.DestroyImmediate(blue); Object.DestroyImmediate(cameraHost);
            UnityEngine.SceneManagement.SceneManager.SetActiveScene(previousScene);
            UnityEngine.SceneManagement.SceneManager.UnloadSceneAsync(scene);
        }
    }
}

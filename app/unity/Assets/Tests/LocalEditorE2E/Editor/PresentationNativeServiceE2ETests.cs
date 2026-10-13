using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Cysharp.Net.Http;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;

namespace Unframe.Tests.LocalEditorE2E
{
    public sealed class PresentationNativeServiceE2ETests
    {
        [Serializable]
        private sealed class Result
        {
            public string status;
            public string stage;
            public string failureType;
            public string failureStackTrace;
            public bool sessionReady;
            public string publicationHash;
            public string definitionHash;
            public string renderBundleHash;
            public string assetSetHash;
            public ulong reliableSequence;
            public int nodes;
            public int texturedRenderers;
            public int coloredPixels;
            public string screenshot;
        }

        private Task activeRun;
        private CancellationTokenSource activeLifetime;
        private PresentationRuntimeHost activeHost;
        private PresentationEncodedAssetCache activeCache;
        private string activeDirectory;

        [UnityTearDown]
        public IEnumerator ReleaseNativeServiceResources()
        {
            activeLifetime?.Cancel();
            float deadline = Time.realtimeSinceStartup + 10;
            while (activeRun != null && !activeRun.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
            if (activeRun?.IsFaulted == true) { var observed = activeRun.Exception; }
            activeHost?.Dispose();
            activeCache?.Dispose();
            activeLifetime?.Dispose();
            if (activeDirectory != null && Directory.Exists(activeDirectory)) Directory.Delete(activeDirectory, true);
            Assert.That(activeRun == null || activeRun.IsCompleted, Is.True, "Native transport did not stop after cancellation.");
            if (Application.isPlaying) yield return new ExitPlayMode();
            GraphicsSettings.defaultRenderPipeline = null;
            QualitySettings.renderPipeline = null;
            AssetDatabase.DeleteAsset("Assets/NativeE2ESettings");
        }

        [UnityTest]
        public IEnumerator PublishedServiceDeliveryAndRealtimeSnapshotRenderInNativeEditor()
        {
            if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("UNFRAME_E2E_RESULT_PATH")))
                Assert.Ignore("Native service E2E requires the local service process environment.");
            AssetDatabase.DeleteAsset("Assets/NativeE2ESettings");
            Directory.CreateDirectory("Assets/NativeE2ESettings");
            var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
            var pipeline = UniversalRenderPipelineAsset.Create(rendererData);
            AssetDatabase.CreateAsset(rendererData, "Assets/NativeE2ESettings/Renderer.asset");
            AssetDatabase.CreateAsset(pipeline, "Assets/NativeE2ESettings/Pipeline.asset");
            // URP's editor initializer populates the runtime shader settings required for camera requests.
            typeof(UniversalRenderPipelineAsset).Assembly.GetType("UnityEngine.Rendering.Universal.UniversalRenderPipelineGlobalSettings", true).GetMethod("Ensure", BindingFlags.Static | BindingFlags.NonPublic)
                .Invoke(null, new object[] { true });
            GraphicsSettings.defaultRenderPipeline = pipeline;
            QualitySettings.renderPipeline = pipeline;
            AssetDatabase.SaveAssets();
            yield return new EnterPlayMode();
            yield return RunServiceInPlayMode();
        }

        private IEnumerator RunServiceInPlayMode()
        {
            string resultPath = Required("UNFRAME_E2E_RESULT_PATH");
            string ca = File.ReadAllText(Required("UNFRAME_E2E_CA_FILE"));
            string origin = Required("UNFRAME_E2E_CONTROL_PLANE_ORIGIN");
            string session = Required("UNFRAME_E2E_SESSION_ID");
            string bearer = Required("UNFRAME_E2E_BEARER");
            var result = new Result { status = "failed", stage = "initializing" };
            Directory.CreateDirectory(Path.GetDirectoryName(resultPath));

            var lifetime = activeLifetime = new CancellationTokenSource();
            string directory = Path.Combine(Path.GetTempPath(), "unframe-native-e2e-" + Guid.NewGuid().ToString("N"));
            activeDirectory = directory;
            Directory.CreateDirectory(directory);
            var cache = activeCache = new PresentationEncodedAssetCache(Path.Combine(directory, "cache"));
            var host = activeHost = new PresentationRuntimeHost(Path.Combine(directory, "sessions.json"), cache);
            var runtimeObject = new GameObject("Native E2E Runtime");
            var runtime = runtimeObject.AddComponent<PresentationBakedRuntime>();
            var connection = new PresentationControlPlaneConnection(new Uri(origin), session,
                _ => Task.FromResult(bearer), host,
                () => new YetAnotherHttpHandler { RootCertificates = ca, Http2Only = false },
                () => new YetAnotherHttpHandler { RootCertificates = ca, Http2Only = true });
            Task running = activeRun = connection.RunAsync(runtime, lifetime.Token);
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D pixels = null;
            try
            {
                result.stage = "session-ready";
                float deadline = Time.realtimeSinceStartup + 90;
                while (!runtime.SessionReady && !running.IsCompleted && Time.realtimeSinceStartup < deadline)
                    yield return null;
                Assert.That(runtime.SessionReady, Is.True, "Native runtime did not reach SessionReady.");
                result.sessionReady = runtime.SessionReady;
                yield return null;
                var delivery = runtime.Delivery;
                Assert.That(delivery, Is.Not.Null);
                Assert.That(delivery.Publication.PublicationManifestHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_PUBLICATION_HASH")));
                Assert.That(delivery.DefinitionHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_DEFINITION_HASH")));
                Assert.That(delivery.RenderBundleHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_RENDER_BUNDLE_HASH")));
                Assert.That(delivery.AssetSetHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_ASSET_SET_HASH")));
                Assert.That(runtime.TryGetLastConnectionSnapshot(out var snapshot), Is.True);
                Assert.That(snapshot.Fence.Publication, Is.EqualTo(delivery.Publication));
                Assert.That(snapshot.ProjectionInstance, Is.EqualTo(delivery.ProjectionInstance));
                var detachedDelivery = runtime.Delivery;
                detachedDelivery.DefinitionHash = "mutated-read-copy";
                Assert.That(runtime.Delivery.DefinitionHash, Is.EqualTo(delivery.DefinitionHash));
                snapshot.ReliableSequence++;
                Assert.That(runtime.TryGetLastConnectionSnapshot(out snapshot), Is.True);
                Assert.That(snapshot.ReliableSequence, Is.EqualTo(snapshot.Snapshot.ReliableSequence));
                var state = snapshot.Snapshot.RuntimeView;
                Assert.That(state.NodeStates.Count, Is.GreaterThan(0));
                result.stage = "hierarchy";
                var nodes = runtimeObject.GetComponentsInChildren<PresentationNodeMetadata>(true);
                var generatedRoot = runtimeObject.transform.Find("Presentation Nodes");
                var stagePosition = state.PresentationOrigin.Pose.Position;
                Assert.That(Vector3.Distance(generatedRoot.localPosition,
                    new Vector3((float)stagePosition.X, (float)stagePosition.Y, -(float)stagePosition.Z)), Is.LessThan(0.0001f));
                Assert.That(nodes.Length, Is.EqualTo(delivery.ProjectionProfile.RuntimeCatalog.Nodes.Count));
                foreach (var definition in delivery.ProjectionProfile.RuntimeCatalog.Nodes)
                {
                    var node = nodes.Single(n => n.NodeId == definition.NodeId);
                    if (definition.Parent.ParentCase == Unframe.Presentation.SpatialParent.ParentOneofCase.Node)
                        Assert.That(node.transform.parent.GetComponent<PresentationNodeMetadata>().NodeId, Is.EqualTo(definition.Parent.Node.NodeId));
                    if (!state.NodeStates.Any(n => n.NodeId == definition.NodeId))
                        Assert.That(node.gameObject.activeSelf, Is.False);
                }
                foreach (var nodeState in state.NodeStates)
                {
                    var node = nodes.Single(n => n.NodeId == nodeState.NodeId);
                    Assert.That(node.gameObject.activeSelf, Is.EqualTo(nodeState.Active));
                    var position = nodeState.Transform.Position;
                    Assert.That(Vector3.Distance(node.transform.localPosition,
                        new Vector3((float)position.X, (float)position.Y, -(float)position.Z)), Is.LessThan(0.0001f));
                    var rotation = nodeState.Transform.Rotation;
                    Assert.That(Quaternion.Angle(node.transform.localRotation,
                        new Quaternion(-(float)rotation.X, -(float)rotation.Y, (float)rotation.Z, (float)rotation.W)), Is.LessThan(0.001f));
                    var scale = nodeState.Transform.Scale;
                    Assert.That(Vector3.Distance(node.transform.localScale,
                        new Vector3((float)scale.X, (float)scale.Y, (float)scale.Z)), Is.LessThan(0.0001f));
                }
                var renderers = runtimeObject.GetComponentsInChildren<MeshRenderer>().Where(r => r.enabled).ToArray();
                Assert.That(renderers.Length, Is.GreaterThan(0));
                foreach (var surface in delivery.ProjectionProfile.RenderSurfaces)
                {
                    var semantic = delivery.ProjectionProfile.RuntimeCatalog.Surfaces.Single(s => s.SurfaceId == surface.SemanticSurfaceId);
                    var quad = runtimeObject.GetComponentsInChildren<MeshRenderer>(true).Single(r => r.name == surface.RenderSurfaceId);
                    double fitX = semantic.PhysicalSizeMeters.X / semantic.LogicalSize.X;
                    double fitY = semantic.PhysicalSizeMeters.Y / semantic.LogicalSize.Y;
                    if (semantic.Fit == Unframe.Presentation.SurfaceFit.Contain) fitX = fitY = Math.Min(fitX, fitY);
                    if (semantic.Fit == Unframe.Presentation.SurfaceFit.Cover) fitX = fitY = Math.Max(fitX, fitY);
                    var bounds = surface.LogicalBounds;
                    Assert.That(Vector3.Distance(quad.transform.localScale,
                        new Vector3((float)(bounds.Width * fitX), (float)(bounds.Height * fitY), 1)), Is.LessThan(0.0001f));
                    Assert.That(Vector3.Distance(quad.transform.localPosition,
                        new Vector3((float)((bounds.X + bounds.Width / 2 - semantic.LogicalSize.X / 2) * fitX),
                            (float)((semantic.LogicalSize.Y / 2 - bounds.Y - bounds.Height / 2) * fitY), -(float)surface.Layer * 0.0001f)), Is.LessThan(0.0001f));
                }
                foreach (var renderer in renderers)
                {
                    Assert.That(renderer.sharedMaterial.shader.name, Is.EqualTo("Unframe/BakedSurface"));
                    var properties = new MaterialPropertyBlock();
                    renderer.GetPropertyBlock(properties);
                    var texture = properties.GetTexture("_FromTex") as Texture2D
                        ?? renderer.sharedMaterial.GetTexture("_FromTex") as Texture2D;
                    Assert.That(texture, Is.Not.Null);
                    Assert.That(texture.isReadable, Is.False);
                    Assert.That(texture.mipmapCount, Is.EqualTo(1));
                    Assert.That(texture.format, Is.EqualTo(TextureFormat.RGBA32));
                    Assert.That(delivery.Residency.Textures.Textures.Any(binding => binding.PixelSize.Width == (ulong)texture.width
                        && binding.PixelSize.Height == (ulong)texture.height), Is.True);
                    var hostNode = renderer.transform.parent.GetComponent<PresentationNodeMetadata>();
                    var nodeState = state.NodeStates.Single(n => n.NodeId == hostNode.NodeId);
                    Assert.That(renderer.sharedMaterial.GetColor("_Color").a, Is.EqualTo((float)nodeState.Opacity).Within(0.0001f));
                }
                result.stage = "camera-render";
                cameraObject = new GameObject("Native E2E Camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.black;
                camera.nearClipPlane = 0.01f;
                camera.farClipPlane = 20000;
                cameraObject.AddComponent<PresentationPreviewCamera>().Frame(runtimeObject.transform);
                target = new RenderTexture(256, 256, 24, RenderTextureFormat.ARGB32);
                target.Create();
                yield return null;
                RenderPipeline.SubmitRenderRequest(camera, new UniversalRenderPipeline.SingleCameraRequest { destination = target });
                var previous = RenderTexture.active;
                RenderTexture.active = target;
                pixels = new Texture2D(256, 256, TextureFormat.RGBA32, false);
                pixels.ReadPixels(new Rect(0, 0, 256, 256), 0, 0);
                pixels.Apply();
                RenderTexture.active = previous;
                result.coloredPixels = pixels.GetPixels32().Count(p => p.r > 8 || p.g > 8 || p.b > 8);
                Assert.That(result.coloredPixels, Is.GreaterThan(100), "Baked surfaces did not produce visible camera pixels.");
                result.screenshot = Path.ChangeExtension(resultPath, ".png");
                File.WriteAllBytes(result.screenshot, pixels.EncodeToPNG());
                result.publicationHash = delivery.Publication.PublicationManifestHash;
                result.definitionHash = delivery.DefinitionHash;
                result.renderBundleHash = delivery.RenderBundleHash;
                result.assetSetHash = delivery.AssetSetHash;
                result.reliableSequence = snapshot.ReliableSequence;
                result.nodes = nodes.Length;
                result.texturedRenderers = renderers.Length;
                result.status = "passed";
                result.stage = "complete";
            }
            finally
            {
                lifetime.Cancel();
                if (running.IsFaulted)
                {
                    var failure = running.Exception.GetBaseException();
                    result.failureType = failure.GetType().Name;
                    result.failureStackTrace = failure.StackTrace;
                }
                if (pixels != null) UnityEngine.Object.Destroy(pixels);
                if (target != null) { target.Release(); UnityEngine.Object.Destroy(target); }
                if (cameraObject != null) UnityEngine.Object.Destroy(cameraObject);
                UnityEngine.Object.Destroy(runtimeObject);
                File.WriteAllText(resultPath, JsonUtility.ToJson(result, true));
            }

        }

        private static string Required(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (String.IsNullOrEmpty(value)) throw new InvalidOperationException("Required native E2E environment is absent: " + name);
            return value;
        }
    }
}

public sealed class PresentationNativeDomainReloadEditModeTests
{
    private const string EnvironmentName = "UNFRAME_NATIVE_DOMAIN_RELOAD_TEST";
    private static string ResultPath => Path.Combine(Path.GetTempPath(), "unframe-domain-reload-" + System.Diagnostics.Process.GetCurrentProcess().Id + ".json");

    [UnityTest]
    public IEnumerator EnvironmentReadAndResultWriteSurviveEnteringAndExitingPlayMode()
    {
        Environment.SetEnvironmentVariable(EnvironmentName, "https://localhost:19443/");
        yield return new EnterPlayMode();
        yield return ReadCapturedInputsInPlayMode();
        yield return new ExitPlayMode();
        Assert.That(File.ReadAllText(ResultPath), Is.EqualTo("https://localhost:19443/"));
    }

    private IEnumerator ReadCapturedInputsInPlayMode()
    {
        string origin = Environment.GetEnvironmentVariable(EnvironmentName);
        string certificate = "test-certificate-input";
        Func<Task<string>> provider = () => Task.FromResult(origin);
        Func<string> capturedCertificate = () => certificate;
        yield return null;
        Assert.That(new Uri(origin).Host, Is.EqualTo("localhost"));
        Assert.That(provider().Result, Is.EqualTo("https://localhost:19443/"));
        Assert.That(capturedCertificate(), Is.EqualTo("test-certificate-input"));
        File.WriteAllText(ResultPath, provider().Result);
    }

    [UnityTearDown]
    public IEnumerator RemoveDomainReloadFixture()
    {
        if (Application.isPlaying) yield return new ExitPlayMode();
        Environment.SetEnvironmentVariable(EnvironmentName, null);
        if (File.Exists(ResultPath)) File.Delete(ResultPath);
    }
}

public sealed class PresentationNativeBootstrapCodecEditModeTests
{
    [Test]
    public void CloudNullFingerprintRemainsNullAfterBootstrapJsonDecode()
    {
        object result = Decode("{\"runtimeKind\":\"Cloud\",\"fingerprint\":null}");
        Assert.That(result.GetType().GetField("fingerprint").GetValue(result), Is.Null);
    }

    [Test]
    public void VenueEdgeFingerprintIsRetainedWithoutRemovingThePin()
    {
        string pin = "sha256:" + new string('a', 64);
        object result = Decode("{\"runtimeKind\":\"VenueEdge\",\"fingerprint\":\"" + pin + "\"}");
        Assert.That(result.GetType().GetField("fingerprint").GetValue(result), Is.EqualTo(pin));
    }

    [TestCase("{\"runtimeKind\":\"VenueEdge\",\"fingerprint\":null}")]
    [TestCase("{\"runtimeKind\":\"VenueEdge\",\"fingerprint\":\"\"}")]
    [TestCase("{\"runtimeKind\":\"VenueEdge\"}")]
    [TestCase("{\"runtimeKind\":\"Cloud\",\"fingerprint\":\"\"}")]
    [TestCase("{\"runtimeKind\":\"Cloud\",\"fingerprint\":false}")]
    [TestCase("{\"runtimeKind\":\"Cloud\"}")]
    public void MissingOrInvalidFingerprintCannotDisableValidation(string json)
    {
        var failure = Assert.Throws<TargetInvocationException>(() => Decode(json));
        Assert.That(failure.InnerException, Is.InstanceOf<InvalidOperationException>());
    }

    private static object Decode(string json)
    {
        return typeof(PresentationControlPlaneConnection).GetMethod("ParseBootstrap", BindingFlags.Static | BindingFlags.NonPublic)
            .Invoke(null, new object[] { json });
    }
}

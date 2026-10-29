using System;
using System.Collections;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Cysharp.Net.Http;
using Grpc.Core;
using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;
using Transform = UnityEngine.Transform;

namespace Unframe.Tests.LocalEditorE2E
{
    public sealed class PresentationRealtimeServiceE2ETests
    {
        [Serializable]
        private sealed class Configuration
        {
            public string controlPlaneOrigin, sessionId, presenterCredential, caFile;
            public string unityStatusFile, unityCommandFile, stateDirectory;
            [NonSerialized] public bool started;
            [NonSerialized] public ControlClientItem staleInput, gestureInput;
        }

        [Serializable]
        private sealed class Command { public string id, kind; }

        [Serializable]
        private sealed class Status
        {
            public string phase = "connecting", stepId = "", reliableSequence = "0", stateSequence = "0";
            public string commandId = "", commandResult = "", surfaceState = "", error = "";
            public string failureDetail = "", resynchronizationReason = "";
            public string connectionId = "", originVersion = "0", assignmentEpoch = "0", pauseReason = "";
            public bool paused, controlReady, inputReady, completed;
            public int connections, assets, texturedRenderers, resynchronizations, renderedPixels;
            public double opacity, renderedOpacity;
        }

        private CancellationTokenSource lifetime;
        private Task running;
        private PresentationRuntimeHost host;
        private PresentationEncodedAssetCache cache;
        private GameObject runtimeObject;
        private GameObject cameraObject;
        private RenderTexture target;
        private Texture2D pixels;

        [UnityTest]
        public IEnumerator ProductRuntimeSynchronizesAndRecoversOverTheRealServices()
        {
            if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("UNFRAME_REALTIME_E2E_CONFIG")))
                Assert.Ignore("The real service environment is supplied by realtime-e2e --unity.");
            AssetDatabase.DeleteAsset("Assets/RealtimeE2ESettings");
            Directory.CreateDirectory("Assets/RealtimeE2ESettings");
            var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
            var pipeline = UniversalRenderPipelineAsset.Create(rendererData);
            AssetDatabase.CreateAsset(rendererData, "Assets/RealtimeE2ESettings/Renderer.asset");
            AssetDatabase.CreateAsset(pipeline, "Assets/RealtimeE2ESettings/Pipeline.asset");
            typeof(UniversalRenderPipelineAsset).Assembly.GetType("UnityEngine.Rendering.Universal.UniversalRenderPipelineGlobalSettings", true)
                .GetMethod("Ensure", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, new object[] { true });
            GraphicsSettings.defaultRenderPipeline = pipeline;
            QualitySettings.renderPipeline = pipeline;
            AssetDatabase.SaveAssets();
            yield return new EnterPlayMode();
            yield return ObserveProductRuntime();
        }

        private IEnumerator ObserveProductRuntime()
        {
            var configuration = JsonUtility.FromJson<Configuration>(File.ReadAllText(Environment.GetEnvironmentVariable("UNFRAME_REALTIME_E2E_CONFIG")));
            Assert.That(new Uri(configuration.controlPlaneOrigin).Host, Is.EqualTo("localhost"));
            Assert.That(Path.IsPathRooted(configuration.unityStatusFile), Is.True);
            Assert.That(Path.IsPathRooted(configuration.unityCommandFile), Is.True);
            string ca = File.ReadAllText(configuration.caFile);
            lifetime = new CancellationTokenSource(TimeSpan.FromMinutes(8));
            string cacheDirectory = Path.Combine(configuration.stateDirectory, "unity-cache");
            cache = new PresentationEncodedAssetCache(cacheDirectory);
            host = new PresentationRuntimeHost(Path.Combine(configuration.stateDirectory, "unity-sessions.json"), cache);
            runtimeObject = new GameObject("Realtime E2E Product Runtime");
            var runtime = runtimeObject.AddComponent<PresentationBakedRuntime>();
            Transform presentation = PresentationNativeRuntimeFixture.Configure(runtime);
            cameraObject = new GameObject("Realtime E2E Product Camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.black;
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 20000;
            var framing = cameraObject.AddComponent<PresentationPreviewCamera>();
            target = new RenderTexture(256, 256, 24, RenderTextureFormat.ARGB32);
            target.Create();
            pixels = new Texture2D(256, 256, TextureFormat.RGBA32, false);
            var status = new Status();
            runtime.SnapshotResynchronizationRequired += reason => { status.resynchronizations++; status.resynchronizationReason = reason.ToString(); };
            var connection = new PresentationControlPlaneConnection(new Uri(configuration.controlPlaneOrigin), configuration.sessionId,
                _ => Task.FromResult(configuration.presenterCredential), host,
                () => new YetAnotherHttpHandler { RootCertificates = ca, Http2Only = false },
                () => new YetAnotherHttpHandler { RootCertificates = ca, Http2Only = true });
            running = connection.RunAsync(runtime, lifetime.Token);
            string previousSnapshot = null;
            Task commandTask = null;
            Command active = null;
            bool stopping = false;
            string renderedCut = null;
            while (!lifetime.IsCancellationRequested && !stopping)
            {
                status.controlReady = runtime.ControlReady;
                status.inputReady = runtime.InputSynchronization?.Ready == true;
                status.paused = runtime.DataStore.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Paused;
                status.stepId = runtime.DataStore.Progression?.CurrentStepId ?? "";
                status.reliableSequence = runtime.DataStore.LastReliableSequence.ToString(CultureInfo.InvariantCulture);
                status.stateSequence = runtime.DataStore.LastStateFrameSequence.ToString(CultureInfo.InvariantCulture);
                status.originVersion = (runtime.DataStore.PresentationOrigin?.Version ?? 0).ToString(CultureInfo.InvariantCulture);
                status.assignmentEpoch = (runtime.Delivery?.ProjectionInstance?.AssignmentEpoch ?? 0).ToString(CultureInfo.InvariantCulture);
                status.pauseReason = runtime.DataStore.RuntimeClock?.Paused?.Reason.ToString() ?? "";
                status.assets = runtime.Delivery?.AssetAccess.Count ?? 0;
                status.completed = running.IsCompleted;
                status.phase = runtime.SessionReady ? "ready" : status.connections == 0 ? "connecting" : "disconnected";
                if (runtime.TryGetLastConnectionSnapshot(out var snapshot) && previousSnapshot != snapshot.ConnectionId)
                {
                    status.connections++;
                    previousSnapshot = snapshot.ConnectionId;
                    status.connectionId = snapshot.ConnectionId;
                }
                status.surfaceState = runtime.DataStore.TryGetSurfaceState("reference-surface:reference-surface-root", out var surface) ? surface.StateId : "";
                status.opacity = runtime.DataStore.TryGetNodeState("reference-surface:surface-node", out var node) ? node.Opacity : -1;
                MeshRenderer[] renderers = presentation.GetComponentsInChildren<MeshRenderer>(true);
                status.texturedRenderers = 0;
                status.renderedOpacity = -1;
                foreach (var renderer in renderers)
                {
                    if (renderer.sharedMaterial == null) continue;
                    var block = new MaterialPropertyBlock();
                    renderer.GetPropertyBlock(block);
                    Texture texture = block.GetTexture("_FromTex") ?? renderer.sharedMaterial.GetTexture("_FromTex");
                    if (texture != null) status.texturedRenderers++;
                    status.renderedOpacity = renderer.sharedMaterial.GetColor("_Color").a;
                }
                string cut = status.connections + ":" + status.stepId + ":" + status.paused + ":" + status.renderedOpacity.ToString(CultureInfo.InvariantCulture);
                if (runtime.SessionReady && status.texturedRenderers > 0 && renderedCut != cut)
                {
                    framing.Frame(presentation);
                    RenderPipeline.SubmitRenderRequest(camera, new UniversalRenderPipeline.SingleCameraRequest { destination = target });
                    var previous = RenderTexture.active;
                    try
                    {
                        RenderTexture.active = target;
                        pixels.ReadPixels(new Rect(0, 0, 256, 256), 0, 0);
                        pixels.Apply();
                        status.renderedPixels = pixels.GetPixels32().Count(p => p.r > 8 || p.g > 8 || p.b > 8);
                    }
                    finally { RenderTexture.active = previous; }
                    renderedCut = cut;
                }
                if (running.IsFaulted)
                {
                    status.error = PresentationConnectionErrors.FromException(running.Exception.GetBaseException());
                    if (running.Exception.GetBaseException() is RpcException rpc) status.failureDetail = rpc.Status.Detail;
                    status.phase = "disconnected";
                }
                if (commandTask != null && commandTask.IsCompleted)
                {
                    status.commandId = active.id;
                    status.commandResult = commandTask.IsFaulted ? "rejected" : commandTask.IsCanceled ? "cancelled" : "accepted";
                    if (commandTask.IsFaulted) status.error = PresentationConnectionErrors.FromException(commandTask.Exception.GetBaseException());
                    stopping = active.kind == "stop";
                    commandTask = null;
                }
                WriteStatus(configuration.unityStatusFile, status);
                if (commandTask == null && File.Exists(configuration.unityCommandFile))
                {
                    Command next = JsonUtility.FromJson<Command>(File.ReadAllText(configuration.unityCommandFile));
                    if (next != null && !String.IsNullOrEmpty(next.id) && next.id != status.commandId)
                    {
                        active = next;
                        commandTask = ExecuteAsync(next, runtime, running, configuration, ca, lifetime.Token);
                    }
                }
                yield return null;
            }
            lifetime.Token.ThrowIfCancellationRequested();
            Assert.That(stopping, Is.True, "The service scenario must stop its real Unity client explicitly.");
        }

        private static async Task ExecuteAsync(Command command, PresentationBakedRuntime runtime, Task running, Configuration configuration, string ca, CancellationToken token)
        {
            if (command.kind == "stop") return;
            if (running.IsCompleted || !runtime.ControlReady || runtime.InputSynchronization?.Ready != true)
                throw new InvalidOperationException("The product Runtime is not accepting Presenter commands.");
            async Task Confirm(RuntimeControlKind kind)
            {
                CommandOutcome outcome = await runtime.SendConfirmedAsync(QuestPresentationInput.CreateControl(kind,
                    runtime.PresentationOriginVersion, runtime.InputSynchronization.CommandEpoch), token);
                if (outcome.ResultCase != CommandOutcome.ResultOneofCase.Accepted)
                    throw new InvalidOperationException("The Runtime rejected the control command.");
            }
            switch (command.kind)
            {
                case "pause":
                    if (runtime.DataStore.Progression?.CurrentStepId == "start") configuration.staleInput = SampleGesture(runtime);
                    await Confirm(RuntimeControlKind.Pause); return;
                case "resume": await Confirm(RuntimeControlKind.Resume); return;
                case "begin":
                    await QuestOnboardingStart.BeginPresenterAsync(async () =>
                    {
                        if (configuration.started) return;
                        using (var client = new HttpClient(new YetAnotherHttpHandler { RootCertificates = ca, Http2Only = false }))
                        using (var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(configuration.controlPlaneOrigin), "/sessions/" + Uri.EscapeDataString(configuration.sessionId) + "/start")))
                        {
                            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration.presenterCredential);
                            request.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
                            using (var response = await client.SendAsync(request, token))
                                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("The Control Plane did not start the Session.");
                        }
                        configuration.started = true;
                    }, () => runtime.SessionReady,
                        () => runtime.ControlReady, () => running.IsCompleted, () => runtime.PlaybackStatus,
                        () => Confirm(RuntimeControlKind.Resume), TimeSpan.FromSeconds(15), token);
                    return;
                case "gesture":
                    configuration.gestureInput = SampleGesture(runtime);
                    CommandOutcome accepted = await runtime.SendConfirmedAsync(configuration.gestureInput, token);
                    if (accepted.Accepted?.CueCommitted?.CueId != "swipe-continue")
                        throw new InvalidOperationException("The sample Gesture Cue was not committed.");
                    return;
                case "retry-gesture":
                    if (configuration.gestureInput == null) throw new InvalidOperationException("No sample Gesture has been sent.");
                    CommandOutcome duplicate = await runtime.SendConfirmedAsync(configuration.gestureInput, token);
                    if (duplicate.Accepted?.CueCommitted?.CueId != "swipe-continue")
                        throw new InvalidOperationException("The sample Gesture retry did not retain its committed result.");
                    return;
                case "stale-gesture":
                    if (configuration.staleInput == null) throw new InvalidOperationException("No input captured before pause is available.");
                    CommandOutcome rejected = await runtime.SendConfirmedAsync(configuration.staleInput, token);
                    if (rejected.Rejected?.Reason != CommandRejectionReason.InputContextStale)
                        throw new InvalidOperationException("The Runtime did not reject input captured before pause.");
                    return;
                default: throw new InvalidOperationException("Unsupported Unity E2E command.");
            }
        }

        private static ControlClientItem SampleGesture(PresentationBakedRuntime runtime)
        {
            var recognition = new PresenterRecognition();
            recognition.Reset(runtime.InputSynchronization.Context, runtime.InputSynchronization.Catalog);
            var origin = new Unframe.Presentation.Vector3();
            var ahead = new Unframe.Presentation.Vector3 { Z = -1 };
            recognition.SampleHands(0, origin, null, ahead);
            recognition.SampleHands(0.2, origin, null, ahead);
            recognition.SampleHands(0.25, new Unframe.Presentation.Vector3 { X = -0.08 }, null, ahead);
            PresenterRecognitionResult gesture = recognition.SampleHands(0.3, new Unframe.Presentation.Vector3 { X = -0.3 }, null, ahead);
            if (gesture?.Gesture != GestureKind.SwipeLeft) throw new InvalidOperationException("The product recognizer did not recognize the sample swipe.");
            return QuestPresentationInput.CreateRecognition(gesture, runtime.PresentationOriginVersion, runtime.InputSynchronization.CommandEpoch);
        }

        private static void WriteStatus(string path, Status status)
        {
            string temporary = path + ".unity.tmp";
            File.WriteAllText(temporary, JsonUtility.ToJson(status));
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }

        [UnityTearDown]
        public IEnumerator StopProductRuntime()
        {
            lifetime?.Cancel();
            float deadline = Time.realtimeSinceStartup + 10;
            while (running != null && !running.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
            if (running?.IsFaulted == true) { var observed = running.Exception; }
            Assert.That(running == null || running.IsCompleted, Is.True, "The product transport did not stop.");
            if (runtimeObject != null) UnityEngine.Object.Destroy(runtimeObject);
            if (pixels != null) UnityEngine.Object.Destroy(pixels);
            if (target != null) { target.Release(); UnityEngine.Object.Destroy(target); }
            if (cameraObject != null) UnityEngine.Object.Destroy(cameraObject);
            host?.Dispose();
            cache?.Dispose();
            lifetime?.Dispose();
            if (Application.isPlaying) yield return new ExitPlayMode();
            GraphicsSettings.defaultRenderPipeline = null;
            QualitySettings.renderPipeline = null;
            AssetDatabase.DeleteAsset("Assets/RealtimeE2ESettings");
        }
    }
}

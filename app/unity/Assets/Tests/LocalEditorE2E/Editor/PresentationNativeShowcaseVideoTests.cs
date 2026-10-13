using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Cysharp.Net.Http;
using NUnit.Framework;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;

public sealed class PresentationNativeShowcaseVideoTests
{
    [Serializable]
    public sealed class Flow
    {
        public float durationSeconds = 40;
        public int framesPerSecond = 20;
        public string nodeId, surfaceId, initialStepId, initialStateId;
        public Command[] commands;
    }
    [Serializable]
    public sealed class Command
    {
        public float atSeconds;
        public string logicalEventName, interactionId, expectedStepId, expectedStateId, expectedTimelineId, expectedCueId;
    }
    [Serializable]
    private sealed class CommandEvidence
    {
        public string clientEventId, logicalEventName, interactionId, stepId, stateId, timelineId, cueId;
        public ulong sequenceBefore, sequenceAfter;
        public float videoSeconds, minimumRenderedOpacity = 1, maximumRenderedOpacity;
        public bool timelineOpacityChanged;
        public List<float> opacitySamples = new List<float>();
    }
    [Serializable]
    private sealed class TimelineEvidence
    {
        public string timelineId, cueId;
        public ulong reliableSequence, runSequence;
    }
    [Serializable]
    private sealed class StateEvidence
    {
        public int frame;
        public ulong reliableSequence, runtimeTimeMs;
        public string stepId, stateId;
        public float nodeOpacity, renderedOpacity, videoSeconds, captureWallSeconds, frameDriftSeconds;
        public Vector3 nodePosition, cameraPosition;
        public Vector2 viewportMinimum, viewportMaximum;
        public Quaternion cameraRotation;
    }
    [Serializable]
    private sealed class Result
    {
        public string status = "failed", stage = "initializing", failureType, failureStackTrace;
        public bool sessionReady, cameraMoved, pacingValidated, fullPresentationInView;
        public float expectedDurationSeconds, wallDurationSeconds, maxFrameDriftSeconds, actualCaptureFramesPerSecond;
        public float minimumRenderedOpacity = 1, maximumRenderedOpacity;
        public bool timelineOpacityChanged;
        public int frames, width = 1280, height = 720, framesPerSecond;
        public ulong reliableSequence;
        public string publicationHash, definitionHash, renderBundleHash, assetSetHash;
        public List<CommandEvidence> acceptedCommands = new List<CommandEvidence>();
        public List<TimelineEvidence> observedTimelines = new List<TimelineEvidence>();
        public List<StateEvidence> states = new List<StateEvidence>();
    }

    private CancellationTokenSource lifetime;
    private Task connectionTask;
    private PresentationRuntimeHost host;
    private PresentationEncodedAssetCache cache;
    private string cacheDirectory;

    [UnityTest]
    public IEnumerator ActualRuntimeCommandsAndCameraMotionProduceShowcaseFrames()
    {
        if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("UNFRAME_SHOWCASE_FLOW_FILE")))
            Assert.Ignore("Showcase capture requires the local service process environment.");
        ConfigurePipeline();
        yield return new EnterPlayMode();
        yield return CaptureInPlayMode();
    }

    private IEnumerator CaptureInPlayMode()
    {
        var flow = JsonUtility.FromJson<Flow>(File.ReadAllText(Required("UNFRAME_SHOWCASE_FLOW_FILE")));
        ValidateFlow(flow);
        string frameDirectory = Path.GetFullPath(Required("UNFRAME_SHOWCASE_FRAME_DIRECTORY"));
        string resultPath = Required("UNFRAME_E2E_RESULT_PATH");
        Directory.CreateDirectory(frameDirectory);
        Assert.That(Directory.GetFiles(frameDirectory, "frame-*.png"), Is.Empty, "Frame directory must be fresh.");
        Directory.CreateDirectory(Path.GetDirectoryName(resultPath));
        string ca = File.ReadAllText(Required("UNFRAME_E2E_CA_FILE"));
        string bearer = Required("UNFRAME_E2E_BEARER");
        var result = new Result { framesPerSecond = flow.framesPerSecond, expectedDurationSeconds = flow.durationSeconds };
        lifetime = new CancellationTokenSource();
        cacheDirectory = Path.Combine(Path.GetTempPath(), "unframe-showcase-" + Guid.NewGuid().ToString("N"));
        cache = new PresentationEncodedAssetCache(Path.Combine(cacheDirectory, "cache"));
        host = new PresentationRuntimeHost(Path.Combine(cacheDirectory, "sessions.json"), cache);
        var root = new GameObject("Showcase Runtime");
        var runtime = root.AddComponent<PresentationBakedRuntime>();
        var connection = new PresentationControlPlaneConnection(new Uri(Required("UNFRAME_E2E_CONTROL_PLANE_ORIGIN")),
            Required("UNFRAME_E2E_SESSION_ID"), _ => Task.FromResult(bearer), host,
            () => new YetAnotherHttpHandler { RootCertificates = ca, Http2Only = false },
            () => new YetAnotherHttpHandler { RootCertificates = ca, Http2Only = true });
        connectionTask = connection.RunAsync(runtime, lifetime.Token);
        GameObject cameraObject = null;
        RenderTexture target = null;
        Texture2D pixels = null;
        PresentationRealtimeConnection realtime = null;
        Action observe = null;
        System.Diagnostics.Stopwatch captureClock = null;
        try
        {
            result.stage = "session-ready";
            float deadline = Time.realtimeSinceStartup + 90;
            while (!runtime.SessionReady && !connectionTask.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.That(runtime.SessionReady, Is.True, "Showcase runtime did not reach SessionReady.");
            result.sessionReady = runtime.SessionReady;
            Assert.That(runtime.CanSendInput, Is.True, "Showcase requires a Presenter session.");
            var delivery = runtime.Delivery;
            Assert.That(delivery.Publication.PublicationManifestHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_PUBLICATION_HASH")));
            Assert.That(delivery.DefinitionHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_DEFINITION_HASH")));
            Assert.That(delivery.RenderBundleHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_RENDER_BUNDLE_HASH")));
            Assert.That(delivery.AssetSetHash, Is.EqualTo(Required("UNFRAME_E2E_EXPECTED_ASSET_SET_HASH")));
            result.publicationHash = delivery.Publication.PublicationManifestHash;
            result.definitionHash = delivery.DefinitionHash;
            result.renderBundleHash = delivery.RenderBundleHash;
            result.assetSetHash = delivery.AssetSetHash;
            // The runtime exposes commands publicly; its live accepted store remains private to production.
            var store = (PresentationRuntimeDataStore)typeof(PresentationBakedRuntime).GetField("store", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(runtime);
            realtime = (PresentationRealtimeConnection)typeof(PresentationBakedRuntime).GetField("connection", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(runtime);
            Assert.That(store.Progression.CurrentStepId, Is.EqualTo(flow.initialStepId));
            Assert.That(store.TryGetSurfaceState(flow.surfaceId, out var initialSurface), Is.True);
            Assert.That(initialSurface.StateId, Is.EqualTo(flow.initialStateId));
            var seenRuns = new HashSet<ulong>();
            observe = () =>
            {
                foreach (var run in store.ActiveRuns)
                    if (run.RunCase == RuntimeRunSnapshot.RunOneofCase.Timeline && seenRuns.Add(run.RunId.RunSequence))
                        result.observedTimelines.Add(new TimelineEvidence
                        {
                            timelineId = run.Timeline.TimelineId,
                            cueId = run.Cause?.CueId,
                            reliableSequence = store.LastReliableSequence,
                            runSequence = run.RunId.RunSequence
                        });
            };
            realtime.RuntimeChanged += observe;
            observe();
            yield return null;
            cameraObject = new GameObject("Showcase Camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.02f, 0.028f, 0.05f, 1);
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 20000;
            camera.aspect = 1280f / 720f;
            var framing = cameraObject.AddComponent<PresentationPreviewCamera>();
            framing.Frame(root.transform);
            framing.enabled = false;
            Bounds bounds = VisibleBounds(root);
            float tangent = Mathf.Tan(camera.fieldOfView * Mathf.Deg2Rad / 2);
            float distance = Mathf.Max(0.5f, Mathf.Max(bounds.extents.y / tangent, bounds.extents.x / (tangent * camera.aspect)) * 1.12f);
            target = new RenderTexture(1280, 720, 24, RenderTextureFormat.ARGB32);
            target.Create();
            pixels = new Texture2D(1280, 720, TextureFormat.RGB24, false);
            yield return null;
            int totalFrames = Mathf.RoundToInt(flow.durationSeconds * flow.framesPerSecond);
            int commandIndex = 0;
            Command pending = null;
            CommandEvidence pendingEvidence = null;
            float pendingDeadline = 0, cameraResetTime = 0;
            captureClock = System.Diagnostics.Stopwatch.StartNew();
            Vector3 firstCameraPosition = camera.transform.position;
            result.stage = "capturing";
            for (int frame = 0; frame < totalFrames; frame++)
            {
                float movieTime = (float)frame / flow.framesPerSecond;
                while (captureClock.Elapsed.TotalSeconds < movieTime) yield return null;
                Assert.That(runtime.SessionReady, Is.True, "Showcase transport lost readiness.");
                if (pending == null && commandIndex < flow.commands.Length && movieTime >= flow.commands[commandIndex].atSeconds)
                {
                    pending = flow.commands[commandIndex++];
                    pendingEvidence = new CommandEvidence
                    {
                        clientEventId = "showcase:" + Guid.NewGuid().ToString("N"),
                        logicalEventName = pending.logicalEventName,
                        interactionId = pending.interactionId,
                        sequenceBefore = store.LastReliableSequence,
                        videoSeconds = movieTime
                    };
                    ControlClientItem input;
                    if (!String.IsNullOrEmpty(pending.interactionId))
                        input = new ControlClientItem
                        {
                            SurfaceInteraction = new SurfaceInteractionCommand
                            {
                                ClientEventId = pendingEvidence.clientEventId,
                                SurfaceId = flow.surfaceId,
                                InteractionId = pending.interactionId,
                                PresentationOriginVersion = runtime.PresentationOriginVersion,
                                CapturedAtClientMonotonicMs = (ulong)(Time.realtimeSinceStartupAsDouble * 1000)
                            }
                        };
                    else
                        input = new ControlClientItem
                        {
                            LogicalInput = new LogicalInputCommand
                            {
                                ClientEventId = pendingEvidence.clientEventId,
                                LogicalEventName = pending.logicalEventName,
                                PresentationOriginVersion = runtime.PresentationOriginVersion
                            }
                        };
                    Task sending = runtime.SendAsync(input, lifetime.Token);
                    while (!sending.IsCompleted) yield return null;
                    if (sending.IsFaulted) { var observed = sending.Exception; }
                    Assert.That(sending.IsFaulted || sending.IsCanceled, Is.False, "Showcase input could not be sent.");
                    pendingDeadline = Time.realtimeSinceStartup + 10;
                }
                if (pending != null)
                {
                    bool stateChanged = store.TryGetSurfaceState(flow.surfaceId, out var state) && state.StateId == pending.expectedStateId;
                    bool stepChanged = store.Progression.CurrentStepId == pending.expectedStepId;
                    var timeline = result.observedTimelines.LastOrDefault(t => t.reliableSequence > pendingEvidence.sequenceBefore
                        && t.timelineId == pending.expectedTimelineId && t.cueId == pending.expectedCueId);
                    if (stateChanged && stepChanged && timeline != null && store.LastReliableSequence > pendingEvidence.sequenceBefore)
                    {
                        pendingEvidence.stepId = store.Progression.CurrentStepId;
                        pendingEvidence.stateId = state.StateId;
                        pendingEvidence.sequenceAfter = store.LastReliableSequence;
                        pendingEvidence.timelineId = timeline.timelineId;
                        pendingEvidence.cueId = timeline.cueId;
                        result.acceptedCommands.Add(pendingEvidence);
                        pending = null;
                        cameraResetTime = movieTime;
                    }
                    else Assert.That(Time.realtimeSinceStartup, Is.LessThan(pendingDeadline), "Showcase command did not produce the required Step/Cue/Timeline/state.");
                }
                bounds = VisibleBounds(root);
                MoveCamera(camera, bounds, distance, movieTime - cameraResetTime);
                ReadViewportBounds(camera, bounds, out Vector2 viewportMinimum, out Vector2 viewportMaximum);
                Assert.That(viewportMinimum.x, Is.GreaterThanOrEqualTo(0.025f));
                Assert.That(viewportMinimum.y, Is.GreaterThanOrEqualTo(0.025f));
                Assert.That(viewportMaximum.x, Is.LessThanOrEqualTo(0.975f));
                Assert.That(viewportMaximum.y, Is.LessThanOrEqualTo(0.975f));
                if (frame == 0) firstCameraPosition = camera.transform.position;
                result.cameraMoved |= Vector3.Distance(firstCameraPosition, camera.transform.position) > 0.05f;
                float captureWallSeconds = (float)captureClock.Elapsed.TotalSeconds;
                float frameDriftSeconds = captureWallSeconds - movieTime;
                result.maxFrameDriftSeconds = Mathf.Max(result.maxFrameDriftSeconds, frameDriftSeconds);
                RenderPipeline.SubmitRenderRequest(camera, new UniversalRenderPipeline.SingleCameraRequest { destination = target });
                var previous = RenderTexture.active;
                try
                {
                    RenderTexture.active = target;
                    pixels.ReadPixels(new Rect(0, 0, 1280, 720), 0, 0);
                    pixels.Apply();
                }
                finally { RenderTexture.active = previous; }
                if (frame == 0)
                    Assert.That(pixels.GetPixels32().Count(p => p.r > 80 || p.g > 80 || p.b > 80), Is.GreaterThan(1000), "Showcase camera did not render visible presentation pixels.");
                File.WriteAllBytes(Path.Combine(frameDirectory, "frame-" + frame.ToString("D6") + ".png"), pixels.EncodeToPNG());
                result.frames++;
                Assert.That(store.TryGetNodeState(flow.nodeId, out var node), Is.True);
                Assert.That(store.TryGetSurfaceState(flow.surfaceId, out var surface), Is.True);
                float renderedOpacity = RenderedOpacity(root);
                result.minimumRenderedOpacity = Mathf.Min(result.minimumRenderedOpacity, renderedOpacity);
                result.maximumRenderedOpacity = Mathf.Max(result.maximumRenderedOpacity, renderedOpacity);
                if (result.acceptedCommands.Count > 0)
                {
                    var accepted = result.acceptedCommands[result.acceptedCommands.Count - 1];
                    accepted.minimumRenderedOpacity = Mathf.Min(accepted.minimumRenderedOpacity, renderedOpacity);
                    accepted.maximumRenderedOpacity = Mathf.Max(accepted.maximumRenderedOpacity, renderedOpacity);
                    if (!accepted.opacitySamples.Any(sample => Mathf.Abs(sample - renderedOpacity) < 0.005f)) accepted.opacitySamples.Add(renderedOpacity);
                    accepted.timelineOpacityChanged = accepted.opacitySamples.Count >= 3
                        && accepted.maximumRenderedOpacity - accepted.minimumRenderedOpacity > 0.1f;
                }
                result.states.Add(new StateEvidence
                {
                    frame = frame,
                    videoSeconds = movieTime,
                    captureWallSeconds = captureWallSeconds,
                    frameDriftSeconds = frameDriftSeconds,
                    reliableSequence = store.LastReliableSequence,
                    runtimeTimeMs = store.RuntimeClock.RuntimeTimeMs,
                    stepId = store.Progression.CurrentStepId,
                    stateId = surface.StateId,
                    nodeOpacity = (float)node.Opacity,
                    renderedOpacity = renderedOpacity,
                    nodePosition = new Vector3((float)node.Transform.Position.X, (float)node.Transform.Position.Y, (float)node.Transform.Position.Z),
                    viewportMinimum = viewportMinimum,
                    viewportMaximum = viewportMaximum,
                    cameraPosition = camera.transform.position,
                    cameraRotation = camera.transform.rotation
                });
                yield return null;
            }
            result.wallDurationSeconds = (float)captureClock.Elapsed.TotalSeconds;
            result.actualCaptureFramesPerSecond = result.frames / result.wallDurationSeconds;
            Assert.That(result.maxFrameDriftSeconds, Is.LessThanOrEqualTo(0.5f), "Capture drift would misrepresent live timeline timing.");
            Assert.That(result.wallDurationSeconds, Is.InRange(flow.durationSeconds - 1f / flow.framesPerSecond, flow.durationSeconds + 0.75f),
                "Capture wall duration differs from movie duration.");
            result.pacingValidated = true;
            result.fullPresentationInView = true;
            Assert.That(pending, Is.Null, "A showcase command was still awaiting its accepted state.");
            Assert.That(result.acceptedCommands.Count, Is.EqualTo(flow.commands.Length));
            Assert.That(result.cameraMoved, Is.True);
            Assert.That(result.frames, Is.EqualTo(totalFrames));
            result.timelineOpacityChanged = result.maximumRenderedOpacity - result.minimumRenderedOpacity > 0.1f;
            Assert.That(result.timelineOpacityChanged, Is.True, "Live timelines did not change rendered material opacity.");
            Assert.That(result.acceptedCommands.All(command => command.timelineOpacityChanged), Is.True,
                "A command timeline did not visibly change its rendered material opacity.");
            result.reliableSequence = store.LastReliableSequence;
            result.status = "passed";
            result.stage = "complete";
        }
        finally
        {
            if (captureClock != null)
            {
                result.wallDurationSeconds = (float)captureClock.Elapsed.TotalSeconds;
                result.actualCaptureFramesPerSecond = result.wallDurationSeconds > 0 ? result.frames / result.wallDurationSeconds : 0;
            }
            if (realtime != null && observe != null) realtime.RuntimeChanged -= observe;
            lifetime.Cancel();
            if (connectionTask.IsFaulted)
            {
                var error = connectionTask.Exception.GetBaseException();
                result.failureType = error.GetType().Name;
                result.failureStackTrace = error.StackTrace;
            }
            if (pixels != null) UnityEngine.Object.Destroy(pixels);
            if (target != null) { target.Release(); UnityEngine.Object.Destroy(target); }
            if (cameraObject != null) UnityEngine.Object.Destroy(cameraObject);
            UnityEngine.Object.Destroy(root);
            File.WriteAllText(resultPath, JsonUtility.ToJson(result, true));
        }
    }

    [UnityTearDown]
    public IEnumerator ReleaseResources()
    {
        lifetime?.Cancel();
        float deadline = Time.realtimeSinceStartup + 10;
        while (connectionTask != null && !connectionTask.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
        if (connectionTask?.IsFaulted == true) { var observed = connectionTask.Exception; }
        bool stopped = connectionTask == null || connectionTask.IsCompleted;
        try
        {
            host?.Dispose(); cache?.Dispose(); lifetime?.Dispose();
            if (cacheDirectory != null && Directory.Exists(cacheDirectory)) Directory.Delete(cacheDirectory, true);
        }
        finally
        {
            lifetime = null;
            connectionTask = null;
            host = null;
            cache = null;
            cacheDirectory = null;
        }
        Assert.That(stopped, Is.True, "Showcase transport did not stop.");
        if (Application.isPlaying) yield return new ExitPlayMode();
        GraphicsSettings.defaultRenderPipeline = null;
        QualitySettings.renderPipeline = null;
        AssetDatabase.DeleteAsset("Assets/ShowcaseSettings");
    }

    private static void ConfigurePipeline()
    {
        AssetDatabase.DeleteAsset("Assets/ShowcaseSettings");
        Directory.CreateDirectory("Assets/ShowcaseSettings");
        var renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
        var pipeline = UniversalRenderPipelineAsset.Create(renderer);
        AssetDatabase.CreateAsset(renderer, "Assets/ShowcaseSettings/Renderer.asset");
        AssetDatabase.CreateAsset(pipeline, "Assets/ShowcaseSettings/Pipeline.asset");
        typeof(UniversalRenderPipelineAsset).Assembly.GetType("UnityEngine.Rendering.Universal.UniversalRenderPipelineGlobalSettings", true)
            .GetMethod("Ensure", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, new object[] { true });
        GraphicsSettings.defaultRenderPipeline = pipeline;
        QualitySettings.renderPipeline = pipeline;
        AssetDatabase.SaveAssets();
    }
    private static Bounds VisibleBounds(GameObject root)
    {
        var renderers = root.GetComponentsInChildren<Renderer>().Where(r => r.enabled).ToArray();
        Assert.That(renderers.Length, Is.GreaterThan(0));
        var bounds = renderers[0].bounds;
        foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
        return bounds;
    }
    private static float RenderedOpacity(GameObject root)
    {
        var renderer = root.GetComponentsInChildren<MeshRenderer>().FirstOrDefault(r => r.enabled);
        return renderer == null ? 0 : renderer.sharedMaterial.GetColor("_Color").a;
    }
    private static void MoveCamera(Camera camera, Bounds bounds, float distance, float seconds)
    {
        float closingReturn = 1 - Mathf.SmoothStep(0, 1, Mathf.Clamp01((seconds - 7) / 2));
        float orbit = Mathf.SmoothStep(0, 1, Mathf.Clamp01((seconds - 1.5f) / 2)) * closingReturn;
        float pan = Mathf.Sin(Mathf.Clamp01((seconds - 3.5f) / 1.5f) * Mathf.PI);
        float zoom = Mathf.SmoothStep(0, 1, Mathf.Clamp01((seconds - 5) / 1.5f)) * closingReturn;
        Quaternion rotation = Quaternion.Euler(4 * orbit, 12 * orbit, 0);
        Vector3 target = bounds.center + rotation * Vector3.right * (distance * 0.035f * pan);
        float requestedDistance = distance * (1 + 0.3f * orbit) * Mathf.Lerp(1, 0.9f, zoom);
        float tangent = Mathf.Tan(camera.fieldOfView * Mathf.Deg2Rad / 2);
        float minimumDistance = camera.nearClipPlane;
        foreach (Vector3 corner in BoundsCorners(bounds))
        {
            Vector3 local = Quaternion.Inverse(rotation) * (corner - target);
            minimumDistance = Mathf.Max(minimumDistance, Mathf.Abs(local.x) / (tangent * camera.aspect * 0.94f) - local.z,
                Mathf.Abs(local.y) / (tangent * 0.94f) - local.z, camera.nearClipPlane - local.z);
        }
        camera.transform.rotation = rotation;
        camera.transform.position = target - rotation * Vector3.forward * Mathf.Max(requestedDistance, minimumDistance);
    }

    private static IEnumerable<Vector3> BoundsCorners(Bounds bounds)
    {
        for (int x = -1; x <= 1; x += 2)
            for (int y = -1; y <= 1; y += 2)
                for (int z = -1; z <= 1; z += 2)
                    yield return bounds.center + Vector3.Scale(bounds.extents, new Vector3(x, y, z));
    }

    private static void ReadViewportBounds(Camera camera, Bounds bounds, out Vector2 minimum, out Vector2 maximum)
    {
        minimum = Vector2.one;
        maximum = Vector2.zero;
        foreach (Vector3 corner in BoundsCorners(bounds))
        {
            Vector3 projected = camera.WorldToViewportPoint(corner);
            Assert.That(projected.z, Is.GreaterThanOrEqualTo(camera.nearClipPlane));
            minimum = Vector2.Min(minimum, new Vector2(projected.x, projected.y));
            maximum = Vector2.Max(maximum, new Vector2(projected.x, projected.y));
        }
    }

    [Test]
    public void CameraPathKeepsTheFullWideQuadVisibleAndReturnsToFront()
    {
        var root = new GameObject("showcase framing test");
        try
        {
            var camera = root.AddComponent<Camera>();
            camera.aspect = 1280f / 720f;
            camera.fieldOfView = 60;
            camera.nearClipPlane = 0.01f;
            var bounds = new Bounds(new Vector3(2, 1, -3), new Vector3(1.6f, 0.9f, 0.01f));
            float tangent = Mathf.Tan(camera.fieldOfView * Mathf.Deg2Rad / 2);
            float distance = Mathf.Max(bounds.extents.y / tangent, bounds.extents.x / (tangent * camera.aspect)) * 1.12f;
            for (int frame = 0; frame <= 12 * 24; frame++)
            {
                MoveCamera(camera, bounds, distance, (float)frame / 24);
                ReadViewportBounds(camera, bounds, out Vector2 minimum, out Vector2 maximum);
                Assert.That(minimum.x, Is.GreaterThanOrEqualTo(0.025f));
                Assert.That(minimum.y, Is.GreaterThanOrEqualTo(0.025f));
                Assert.That(maximum.x, Is.LessThanOrEqualTo(0.975f));
                Assert.That(maximum.y, Is.LessThanOrEqualTo(0.975f));
            }
            Assert.That(Quaternion.Angle(camera.transform.rotation, Quaternion.identity), Is.LessThan(0.001f));
        }
        finally { UnityEngine.Object.DestroyImmediate(root); }
    }

    private static void ValidateFlow(Flow flow)
    {
        Assert.That(flow, Is.Not.Null);
        Assert.That(flow.durationSeconds, Is.InRange(30, 60));
        Assert.That(flow.framesPerSecond, Is.InRange(12, 30));
        Assert.That(flow.commands, Is.Not.Null.And.Not.Empty);
        Assert.That(flow.nodeId, Is.Not.Null.And.Not.Empty);
        Assert.That(flow.surfaceId, Is.Not.Null.And.Not.Empty);
        float previous = -1;
        foreach (var command in flow.commands)
        {
            Assert.That(command.atSeconds, Is.GreaterThan(previous).And.LessThan(flow.durationSeconds - 2));
            Assert.That(!String.IsNullOrEmpty(command.logicalEventName) || !String.IsNullOrEmpty(command.interactionId), Is.True);
            Assert.That(command.expectedStepId, Is.Not.Null.And.Not.Empty);
            Assert.That(command.expectedStateId, Is.Not.Null.And.Not.Empty);
            Assert.That(command.expectedTimelineId, Is.Not.Null.And.Not.Empty);
            Assert.That(command.expectedCueId, Is.Not.Null.And.Not.Empty);
            previous = command.atSeconds;
        }
    }
    private static string Required(string name)
    {
        string value = Environment.GetEnvironmentVariable(name);
        if (String.IsNullOrEmpty(value)) throw new InvalidOperationException("Required showcase environment is absent: " + name);
        return value;
    }
}

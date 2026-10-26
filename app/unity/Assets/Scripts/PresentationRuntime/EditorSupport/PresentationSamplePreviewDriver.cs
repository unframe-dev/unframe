#if UNITY_EDITOR
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Cysharp.Net.Http;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Unframe.Unity.PresentationRuntime.Editor
{
    public sealed class PresentationSamplePreviewDriver : MonoBehaviour
    {
        [NonSerialized] private PresentationSampleConnectionSettings settings;
        private CancellationTokenSource lifetime;
        private PresentationRuntimeHost host;
        private PresentationEncodedAssetCache cache;
        private PresentationPreviewCamera framing;
        private bool resumed, framed, commandPending, stopped;
        private Task command = Task.CompletedTask;
        private PresentationConnectionStage stage;
        private readonly Rect controls = new Rect(12, 12, 420, 182);
        public PresentationBakedRuntime Runtime { get; private set; }
        public Camera PreviewCamera { get; private set; }
        public Task Running { get; private set; }
        public string ErrorCode { get; private set; }
        public PresentationConnectionStage ConnectionStage => Running == null ? PresentationConnectionStage.NotConfigured
            : Running.IsCompleted ? (ErrorCode == null ? PresentationConnectionStage.Stopped : PresentationConnectionStage.Failed)
            : stage == PresentationConnectionStage.Connecting ? stage
            : !Runtime.DownloadReady || !Runtime.ResidentReady ? PresentationConnectionStage.LoadingAssets
            : Runtime.SessionReady ? PresentationConnectionStage.Ready : PresentationConnectionStage.Synchronizing;

        public void StartPreview(PresentationSampleConnectionSettings connectionSettings)
        {
            if (lifetime != null || connectionSettings == null) throw new InvalidOperationException("sample-preview-already-started");
            settings = connectionSettings;
            lifetime = new CancellationTokenSource();
            try
            {
                Runtime = gameObject.AddComponent<PresentationBakedRuntime>();
                if (!PresentationCalibrationMath.TryFromWorldOrigin(Pose.identity, transform, out var pose, out _))
                    throw new InvalidOperationException("sample-preview-origin-invalid");
                var calibration = new PresentationCalibrationState();
                if (!calibration.TrySet(pose, out _)) throw new InvalidOperationException("sample-preview-origin-invalid");
                Runtime.ConfigureCalibration(calibration, transform);
                PreviewCamera = new GameObject("Local Sample Camera").AddComponent<Camera>();
                PreviewCamera.transform.SetParent(transform);
                PreviewCamera.clearFlags = CameraClearFlags.SolidColor;
                PreviewCamera.backgroundColor = new Color(0.025f, 0.025f, 0.035f);
                PreviewCamera.nearClipPlane = 0.01f;
                PreviewCamera.farClipPlane = 20000;
                framing = PreviewCamera.gameObject.AddComponent<PresentationPreviewCamera>();
                // The shared preview camera reads legacy Input; this Editor client uses Input System.
                framing.enabled = false;
                framing.Frame(null);
                string stateDirectory = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Library", "UnframeLocalSample");
                Directory.CreateDirectory(stateDirectory);
                cache = new PresentationEncodedAssetCache(Path.Combine(stateDirectory, "cache"));
                host = new PresentationRuntimeHost(Path.Combine(stateDirectory, "sessions.json"), cache);
                Running = RunAsync();
            }
            catch (Exception)
            {
                settings.ClearCredential();
                stopped = true;
                lifetime.Cancel();
                lifetime.Dispose();
                host?.Dispose();
                cache?.Dispose();
                if (Runtime != null)
                {
                    Runtime.enabled = false;
                    ReleaseObject(Runtime);
                }
                if (PreviewCamera != null) ReleaseObject(PreviewCamera.gameObject);
                Running = Task.CompletedTask;
                throw new InvalidOperationException("sample-preview-start-failed");
            }
        }

        private static void ReleaseObject(UnityEngine.Object value)
        {
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }

        private async Task RunAsync()
        {
            try
            {
                if (settings.ExpiresAt <= DateTimeOffset.UtcNow)
                    throw new PresentationConnectionException("sample-connection-expired");
                var connection = new PresentationControlPlaneConnection(settings.Origin, settings.SessionId,
                    token =>
                    {
                        token.ThrowIfCancellationRequested();
                        if (settings.ExpiresAt <= DateTimeOffset.UtcNow) throw new InvalidOperationException("sample-connection-expired");
                        return Task.FromResult(settings.Credential);
                    }, host,
                    () => new YetAnotherHttpHandler { RootCertificates = settings.RootCertificates, Http2Only = false },
                    () => new YetAnotherHttpHandler { RootCertificates = settings.RootCertificates, Http2Only = true },
                    value => stage = value);
                await connection.RunAsync(Runtime, lifetime.Token);
            }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
            catch (Exception exception) { ErrorCode = PresentationConnectionErrors.FromException(exception); }
            finally
            {
                settings.ClearCredential();
                host?.Dispose();
                cache?.Dispose();
            }
        }

        private void Update()
        {
            if (Runtime == null || Running == null || Running.IsCompleted) return;
            if (!resumed && Runtime.CanSendRuntimeControl && !commandPending)
            {
                resumed = true;
                command = SendAsync(QuestPresentationInput.CreateControl(RuntimeControlKind.Resume, Runtime.PresentationOriginVersion, Runtime.InputSynchronization.CommandEpoch));
            }
            if (!framed && Runtime.SessionReady && Runtime.PresentationSpace.GetComponentsInChildren<Renderer>().Length > 0)
            {
                framing.Frame(Runtime.PresentationSpace);
                framed = true;
            }
            Mouse mouse = Mouse.current;
            if (mouse == null || !mouse.leftButton.wasPressedThisFrame || commandPending || !Runtime.CanSendInput) return;
            Vector2 position = mouse.position.ReadValue();
            if (controls.Contains(new Vector2(position.x, Screen.height - position.y))) return;
            if (Runtime.TryPickInteraction(PreviewCamera.ScreenPointToRay(position), out string surface, out string interaction))
                command = SendAsync(QuestPresentationInput.CreateSurfaceInteraction(surface, interaction, Runtime.PresentationOriginVersion, Runtime.InputSynchronization.Context, Runtime.InputSynchronization.CommandEpoch));
        }

        private async Task SendAsync(ControlClientItem command)
        {
            commandPending = true;
            try { await Runtime.SendAsync(command, lifetime.Token); }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
            catch (Exception exception) { ErrorCode = PresentationConnectionErrors.FromException(exception); }
            finally { commandPending = false; }
        }

        private void OnGUI()
        {
            GUILayout.BeginArea(controls, GUI.skin.box);
            GUILayout.Label("Local Sample — Editor coordinates (no device calibration)");
            GUILayout.Label("Connection: " + ConnectionStage + "   Assets: " + (Runtime?.DownloadReady == true ? "ready" : "pending"));
            GUILayout.Label("Sync: " + (Runtime?.SessionReady == true ? "ready" : "pending") + "   Playback: " + Runtime?.PlaybackStatus);
            GUILayout.Label("Command: " + (Runtime?.LastCommandOutcomeCode ?? "none"));
            if (ErrorCode != null) GUILayout.Label("Error: " + ErrorCode);
            GUILayout.BeginHorizontal();
            GUI.enabled = Runtime != null && Runtime.CanSendRuntimeControl && !commandPending && Running?.IsCompleted == false;
            if (GUILayout.Button("Resume")) command = SendAsync(QuestPresentationInput.CreateControl(RuntimeControlKind.Resume, Runtime.PresentationOriginVersion, Runtime.InputSynchronization.CommandEpoch));
            if (GUILayout.Button("Pause")) command = SendAsync(QuestPresentationInput.CreateControl(RuntimeControlKind.Pause, Runtime.PresentationOriginVersion, Runtime.InputSynchronization.CommandEpoch));
            if (GUILayout.Button("End")) command = SendAsync(QuestPresentationInput.CreateControl(RuntimeControlKind.End, Runtime.PresentationOriginVersion, Runtime.InputSynchronization.CommandEpoch));
            GUI.enabled = Runtime?.SessionReady == true;
            if (GUILayout.Button("Frame")) framing.Frame(Runtime.PresentationSpace);
            GUI.enabled = true;
            if (GUILayout.Button("Exit")) UnityEditor.EditorApplication.isPlaying = false;
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        public async Task StopAsync()
        {
            if (lifetime == null) return;
            if (!stopped)
            {
                stopped = true;
                lifetime.Cancel();
            }
            settings?.ClearCredential();
            if (Running != null) await Running;
            await command;
            lifetime.Dispose();
        }

        private async void OnDisable()
        {
            try { await StopAsync(); }
            catch (Exception) { ErrorCode = "sample-preview-stop-failed"; }
        }
    }
}

#endif

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using Unframe.Preview;
using Unframe.Realtime;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationPreviewAssetData
    {
        public PresentationPreviewAssetData(byte[] bytes, string mediaType) { Bytes = bytes; MediaType = mediaType; }
        public byte[] Bytes { get; }
        public string MediaType { get; }
    }

    /// <summary>
    /// Prepares hidden scenes and replaces the visible scene only on an explicit matching Commit.
    /// Construct and call on the Unity main thread with its synchronization context; asset providers may do I/O asynchronously.
    /// </summary>
    public sealed class PresentationPreviewTransaction : IDisposable
    {
        private sealed class Scene : IDisposable
        {
            internal readonly PresentationLocalPreviewInput Input;
            internal readonly GameObject Root;
            internal readonly PresentationNodeHierarchy Hierarchy = new PresentationNodeHierarchy();
            internal readonly PresentationTextureResidency Textures = new PresentationTextureResidency();
            internal PresentationBakedSurfaceRenderer Renderer;
            internal readonly PresentationNativeSurfaceRenderer Native = new PresentationNativeSurfaceRenderer();
            internal readonly PresentationRuntimeAssetFiles Files = new PresentationRuntimeAssetFiles();
            internal readonly PresentationVideoResidency Videos;
            internal readonly PresentationModelResidency Models = new PresentationModelResidency();
            internal readonly PresentationPlaybackPlayer Playback = new PresentationPlaybackPlayer();
            internal readonly PresentationEffectPlayer Effects = new PresentationEffectPlayer();
            internal RuntimeClockSnapshot Clock;
            internal double ClockReceivedAt;
            internal ulong Sequence;
            internal bool Prepared;
            internal bool Faulted;
            private bool disposed;

            internal Scene(PresentationLocalPreviewInput input, Transform parent, Func<IPresentationVideoDecoder> createDecoder)
            {
                Input = input;
                Videos = new PresentationVideoResidency(createDecoder);
                Videos.Limits.MaxEncodedBytes = ulong.MaxValue;
                Videos.Limits.MaxDecodedFrameBytes = ulong.MaxValue;
                Models.Limits.MaxEncodedBytes = ulong.MaxValue;
                Root = new GameObject("Preview " + input.RequestId);
                Root.SetActive(false);
                Root.transform.SetParent(parent, false);
            }
            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                if (Root != null) Root.SetActive(false);
                Effects.Dispose();
                Playback.Clear();
                Renderer?.Dispose();
                Native.Dispose();
                Files.Dispose();
                Models.Dispose();
                Videos.Dispose();
                Hierarchy.Clear();
                Textures.Dispose();
                PresentationTextureResidency.Destroy(Root);
            }
        }

        private readonly Transform root;
        private readonly Func<IPresentationVideoDecoder> createDecoder;
        private readonly int mainThread;
        private Scene current;
        private Scene candidate;
        private CancellationTokenSource cancellation;
        private Task previousPreparation = Task.CompletedTask;
        private long generation;
        private string latestRequestId;
        private readonly HashSet<string> requests = new HashSet<string>(StringComparer.Ordinal);
        private bool disposed;
        private string playbackRequestId;

        public PresentationPreviewTransaction(Transform root, Func<IPresentationVideoDecoder> createDecoder = null)
        {
            if (root == null) throw new ArgumentNullException(nameof(root));
            this.root = root;
            this.createDecoder = createDecoder;
            mainThread = Thread.CurrentThread.ManagedThreadId;
        }
        public bool PlaybackRejected { get; private set; }
        public bool PlaybackFaulted { get { return current?.Faulted == true; } }
        public string PlaybackRequestId { get { return playbackRequestId; } }
        public ulong PlaybackSequence { get { return current?.Sequence ?? 0; } }
        public string LoadedRequestId { get { return current?.Input.RequestId; } }
        public string LoadedBuildIdentity { get { return current?.Input.BuildIdentity; } }
        public string PreparedRequestId { get { return candidate?.Prepared == true ? candidate.Input.RequestId : null; } }
        public ulong ResidentGpuBytes { get { return current?.Textures.ResidentGpuBytes ?? 0; } }

        public Task<string> PrepareAsync(LocalPreviewEnvelope envelope,
            Func<string, string, CancellationToken, Task<PresentationPreviewAssetData>> assetProvider, CancellationToken token,
            Action<string> progress = null)
        {
            CheckAccess();
            Invalidate();
            if (!PresentationLocalPreviewAdapter.TryCreate(envelope, out PresentationLocalPreviewInput input, out string error))
                return Task.FromException<string>(new InvalidOperationException(error));
            if (assetProvider == null) throw new ArgumentNullException(nameof(assetProvider));
            if (!requests.Add(input.RequestId)) return Task.FromException<string>(new InvalidOperationException("preview.request-id-reused"));
            long expectedGeneration = generation;
            latestRequestId = input.RequestId;
            var lifetime = CancellationTokenSource.CreateLinkedTokenSource(token);
            cancellation = lifetime;
            Task prior = previousPreparation;
            var completed = new TaskCompletionSource<bool>();
            previousPreparation = completed.Task;
            return PrepareCoreAsync(input, assetProvider, lifetime, expectedGeneration, prior, completed, progress);
        }

        private async Task<string> PrepareCoreAsync(PresentationLocalPreviewInput input,
            Func<string, string, CancellationToken, Task<PresentationPreviewAssetData>> assetProvider,
            CancellationTokenSource lifetime, long expectedGeneration, Task prior, TaskCompletionSource<bool> completed,
            Action<string> progress)
        {
            Scene next = null;
            CancellationToken token = lifetime.Token;
            try
            {
                progress?.Invoke("waiting");
                // Finish the cancelled load before allocating the next candidate's CPU or GPU resources.
                await prior;
                if (Application.isPlaying) await Task.Yield();
                CheckLatest(expectedGeneration, token);
                next = new Scene(input, root, createDecoder);
                candidate = next;
                progress?.Invoke("texture-assets");
                foreach (TextureResidencyBinding binding in input.TextureBindings)
                {
                    CheckLatest(expectedGeneration, token);
                    if (next.Textures.TryRetain(binding, out _)) continue;
                    var asset = await assetProvider(input.RequestId, input.References[binding.AssetId], token);
                    CheckLatest(expectedGeneration, token);
                    if (asset == null || asset.MediaType != input.Assets[binding.AssetId].MediaType)
                        throw new InvalidOperationException("preview.asset-load-invalid");
                    if (!next.Textures.TryLoad(binding, input.Assets[binding.AssetId], asset.Bytes, out string textureError))
                        throw new InvalidOperationException(textureError);
                }
                CheckLatest(expectedGeneration, token);
                progress?.Invoke("hierarchy");
                if (!next.Hierarchy.TryReplace(input, next.Root.transform, out string error)) throw new InvalidOperationException(error);
                var modelBudget = new PresentationModelTextureBudget
                {
                    Limits = PresentationLocalPreviewAdapter.PreviewTextureLimits(),
                    UsedBindings = input.TexturePlan.MaximumResidentTextureBindings,
                };
                var loadedModels = new HashSet<string>();
                progress?.Invoke("models");
                foreach (var node in input.Catalog.Nodes)
                {
                    if (node.NodeCase != Unframe.Presentation.ProjectedNodeDefinition.NodeOneofCase.Model || !loadedModels.Add(node.Model.ModelAssetId)) continue;
                    ModelResidencyBinding model = null;
                    foreach (var binding in input.ModelBindings) if (binding.AssetId == node.Model.ModelAssetId) { model = binding; break; }
                    if (model == null) throw new InvalidOperationException("preview.model-residency-absent");
                    var asset = await assetProvider(input.RequestId, input.References[model.AssetId], token);
                    CheckLatest(expectedGeneration, token);
                    if (asset == null || asset.MediaType != "model/gltf-binary") throw new InvalidOperationException("preview.model-media-type-invalid");
                    await next.Models.LoadAsync(model, input.Assets[model.AssetId], asset.Bytes, token, modelBudget);
                    CheckLatest(expectedGeneration, token);
                }
                progress?.Invoke("model-instances");
                await next.Models.InstantiateAsync(input, next.Hierarchy, token);
                CheckLatest(expectedGeneration, token);
                progress?.Invoke("surfaces");
                next.Renderer = new PresentationBakedSurfaceRenderer();
                if (!next.Renderer.TryBuild(input, next.Hierarchy, out error)) throw new InvalidOperationException(error);
                progress?.Invoke("fonts");
                if (input.NativeUiResidency != null)
                    foreach (string fontId in input.NativeUiResidency.FontAssetIds)
                    {
                        var asset = await assetProvider(input.RequestId, input.References[fontId], token);
                        CheckLatest(expectedGeneration, token);
                        if (asset == null || asset.MediaType != input.Assets[fontId].MediaType) throw new InvalidOperationException("preview.font-media-type-invalid");
                        next.Files.Add(input.Assets[fontId], asset.Bytes);
                    }
                progress?.Invoke("native-ui");
                if (!next.Native.TryBuild(input, next.Hierarchy, next.Files.Paths, out error)) throw new InvalidOperationException(error);
                next.Playback.Models = next.Models;
                progress?.Invoke("videos");
                await next.Videos.BuildAsync(input, next.Hierarchy, async (id, videoToken) => await assetProvider(input.RequestId, input.References[id], videoToken), token);
                CheckLatest(expectedGeneration, token);
                next.Playback.Videos = next.Videos;
                progress?.Invoke("playback");
                if (!next.Playback.TryRefresh(input, next.Hierarchy, (double time, out string refreshError) => Refresh(next, time, out refreshError), 0, out error)) throw new InvalidOperationException(error);
                next.Playback.Models = next.Models;
                next.Prepared = true;
                progress?.Invoke("prepared");
                return input.RequestId;
            }
            catch
            {
                if (ReferenceEquals(candidate, next)) candidate = null;
                next?.Dispose();
                throw;
            }
            finally
            {
                if (ReferenceEquals(cancellation, lifetime)) cancellation = null;
                lifetime.Dispose();
                completed.TrySetResult(true);
            }
        }

        public string Commit(string requestId)
        {
            CheckAccess();
            if (requestId != latestRequestId || candidate == null || !candidate.Prepared || candidate.Input.RequestId != requestId)
                throw new InvalidOperationException("preview.prepared-request-mismatch");
            if (!candidate.Textures.IsReady(candidate.Input.TextureBindings)) throw new InvalidOperationException("asset_residency_lost");
            Scene old = current;
            Scene next = candidate;
            if (old?.Root != null) old.Root.SetActive(false);
            next.Root.SetActive(true);
            current = next;
            playbackRequestId = next.Input.RequestId;
            candidate = null;
            latestRequestId = null;
            old?.Dispose();
            return next.Input.BuildIdentity;
        }

        public bool TryPlayback(LocalPreviewPlaybackState state, double now, out string error)
        {
            return TryApplyPlayback(state, now, false, out error);
        }

        public bool TryRestore(LocalPreviewPlaybackState state, double now, out string error)
        {
            return TryApplyPlayback(state, now, true, out error);
        }

        private bool TryApplyPlayback(LocalPreviewPlaybackState state, double now, bool restoring, out string error)
        {
            CheckAccess();
            PlaybackRejected = true;
            error = "preview.playback-request-mismatch";
            if (current == null || state == null || state.RequestId != playbackRequestId) return false;
            error = "preview.playback-sequence-stale";
            if (state.Sequence == 0 || state.Sequence <= current.Sequence) return false;
            error = "preview.playback-recovery-required";
            if (current.Faulted && !restoring) return false;
            error = "preview.playback-restore-must-pause";
            if (restoring && (state.Clock == null || state.Clock.StatusCase != RuntimeClockSnapshot.StatusOneofCase.Paused)) return false;
            try
            {
                error = "asset_residency_lost";
                if (current.Root == null || !current.Textures.IsReady(current.Input.TextureBindings))
                {
                    PlaybackRejected = false;
                    StopPlayback();
                    return false;
                }
                if (!PresentationPreviewPlaybackValidation.TryApply(current.Input, state, out error)) return false;
                PlaybackRejected = false;
                // The delivery sequence stays consumed even when rendering only partially applies the snapshot.
                current.Sequence = state.Sequence;
                if (current.Clock?.StatusCase != state.Clock.StatusCase)
                    current.Input.InvalidateTrackedPoses();
                current.Clock = state.Clock.Clone();
                current.ClockReceivedAt = now;
                if (restoring) { current.Playback.Clear(); current.Effects.Clear(); }
                bool running = current.Clock.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running;
                if (!current.Playback.TryRefresh(current.Input, current.Hierarchy, (double time, out string refreshError) => Refresh(current, time, out refreshError),
                    current.Clock.RuntimeTimeMs, out error, running)
                    || !current.Effects.TryUpdate(current.Input, current.Input.EffectRuns, current.Hierarchy, current.Clock.RuntimeTimeMs, out error, running))
                {
                    if (error == "video-user-activation-required")
                    {
                        PlaybackRejected = true;
                        current.Videos.Pause();
                        return false;
                    }
                    StopPlayback();
                    return false;
                }
                current.Faulted = false;
                current.Root.SetActive(true);
                return true;
            }
            catch (Exception)
            {
                PlaybackRejected = false;
                StopPlayback();
                error = restoring ? "preview.playback-restore-failed" : "preview.playback-apply-failed";
                return false;
            }
        }

        public bool TryUpdate(double now, out string error)
        {
            CheckAccess();
            error = null;
            if (current == null || playbackRequestId == null || current.Faulted) return true;
            try
            {
                double time = PresentationPlaybackPlayer.SampleRuntimeTimeMs(current.Clock, current.ClockReceivedAt, now);
                bool running = current.Clock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running;
                if (current.Playback.TryUpdate(current.Input, current.Hierarchy, (double sampledTime, out string refreshError) => Refresh(current, sampledTime, out refreshError), time, out error, running)
                    && current.Effects.TryUpdate(current.Input, current.Input.EffectRuns, current.Hierarchy, time, out error, running)) return true;
                if (error == "video-user-activation-required")
                {
                    current.Videos.Pause();
                    return false;
                }
            }
            catch (Exception) { error = "preview.playback-update-failed"; }
            StopPlayback();
            return false;
        }

        private static bool Refresh(Scene scene, double time, out string error)
        {
            error = "asset_residency_lost";
            if (!scene.Files.IsReady) return false;
            return scene.Renderer.TryRefresh(scene.Input, scene.Textures, time, out error)
                && scene.Native.TryRefresh(scene.Input, time, out error);
        }

        public bool TryApplySpatial(PresentationPreviewSpatialState state, out string error)
        {
            CheckAccess();
            error = "preview.spatial-request-mismatch";
            if (state == null || current == null || current.Faulted || playbackRequestId != state.RequestId || current.Sequence != state.Sequence) return false;
            current.Input.SetPresenterPose(state.PresenterPosition, state.PresenterRotation);
            new PresentationNodeStateApplier().ApplyAnchors(current.Input, current.Hierarchy);
            error = null;
            return true;
        }

        public bool TryPickInteraction(Ray ray, out string surfaceId, out string interactionId)
        {
            CheckAccess();
            surfaceId = interactionId = null;
            if (current == null || current.Faulted || playbackRequestId == null || current.Clock?.StatusCase != RuntimeClockSnapshot.StatusOneofCase.Running) return false;
            bool picked = current.Renderer.TryPickInteraction(ray, current.Input, current.Textures, out string selected, out string interaction, out float nearest);
            bool nativePicked = current.Native.TryPickInteraction(ray, current.Input, out string nativeSurface, out string nativeInteraction, out float nativeDistance);
            if (IsNearer(nativeSurface, nativeDistance, selected, nearest))
            { picked = nativePicked; selected = nativeSurface; interaction = nativeInteraction; nearest = nativeDistance; }
            bool videoPicked = current.Videos.TryPickInteraction(ray, current.Input, out string videoSurface, out string videoInteraction, out float videoDistance);
            if (IsNearer(videoSurface, videoDistance, selected, nearest))
            { picked = videoPicked; selected = videoSurface; interaction = videoInteraction; }
            if (!picked) return false;
            surfaceId = selected; interactionId = interaction;
            return true;
        }
        private static bool IsNearer(string candidate, float distance, string selected, float nearest) =>
            candidate != null && (distance < nearest || distance == nearest && (selected == null || StringComparer.Ordinal.Compare(candidate, selected) < 0));

        private void StopPlayback()
        {
            current.Faulted = true;
            current.Effects.Clear();
            current.Videos.Pause();
            if (current.Root != null) current.Root.SetActive(false);
        }

        public bool Discard(string requestId)
        {
            CheckAccess();
            if (requestId == null || requestId != latestRequestId) return false;
            Invalidate();
            return true;
        }

        public void Invalidate()
        {
            CheckAccess();
            generation++;
            current?.Videos.Pause();
            current?.Effects.Clear();
            playbackRequestId = null;
            latestRequestId = null;
            cancellation?.Cancel();
            cancellation = null;
            if (candidate?.Prepared == true) candidate.Dispose();
            candidate = null;
        }

        private void CheckLatest(long expectedGeneration, CancellationToken token)
        {
            CheckAccess();
            token.ThrowIfCancellationRequested();
            if (generation != expectedGeneration) throw new OperationCanceledException("preview.request-stale");
        }
        private void CheckAccess()
        {
            if (Thread.CurrentThread.ManagedThreadId != mainThread) throw new InvalidOperationException("Preview transactions require the Unity main thread.");
            if (disposed) throw new ObjectDisposedException(nameof(PresentationPreviewTransaction));
        }
        public void Dispose()
        {
            if (disposed) return;
            CheckAccess();
            Invalidate();
            current?.Dispose();
            current = null;
            disposed = true;
        }
    }
}

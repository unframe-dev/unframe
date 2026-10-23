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
            internal readonly PresentationVideoResidency Videos;
            internal readonly PresentationModelResidency Models = new PresentationModelResidency();
            internal readonly PresentationPlaybackPlayer Playback = new PresentationPlaybackPlayer();
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
                Root = new GameObject("Preview " + input.RequestId);
                Root.SetActive(false);
                Root.transform.SetParent(parent, false);
            }
            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                if (Root != null) Root.SetActive(false);
                Playback.Clear();
                Renderer?.Dispose();
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
            Func<string, string, CancellationToken, Task<PresentationPreviewAssetData>> assetProvider, CancellationToken token)
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
            return PrepareCoreAsync(input, assetProvider, lifetime, expectedGeneration, prior, completed);
        }

        private async Task<string> PrepareCoreAsync(PresentationLocalPreviewInput input,
            Func<string, string, CancellationToken, Task<PresentationPreviewAssetData>> assetProvider,
            CancellationTokenSource lifetime, long expectedGeneration, Task prior, TaskCompletionSource<bool> completed)
        {
            Scene next = null;
            CancellationToken token = lifetime.Token;
            try
            {
                // Finish the cancelled load before allocating the next candidate's CPU or GPU resources.
                await prior;
                if (Application.isPlaying) await Task.Yield();
                CheckLatest(expectedGeneration, token);
                IEnumerable<TextureResidencyBinding> oldBindings = current?.Input.TextureBindings ?? Array.Empty<TextureResidencyBinding>();
                if (!PresentationPreviewAdmission.TryAdmit(oldBindings, input.TextureBindings, out string error))
                    throw new InvalidOperationException(error);
                next = new Scene(input, root, createDecoder);
                candidate = next;
                foreach (TextureResidencyBinding binding in input.TextureBindings)
                {
                    CheckLatest(expectedGeneration, token);
                    bool resident = current != null && current.Textures.TryGet(binding.Checksum, out _);
                    if (resident)
                    {
                        if (!next.Textures.TryRetain(binding, out error)) throw new InvalidOperationException(error);
                        continue;
                    }
                    PresentationPreviewAssetData asset = await assetProvider(input.RequestId, input.References[binding.AssetId], token);
                    CheckLatest(expectedGeneration, token);
                    if (asset == null || asset.MediaType != input.Assets[binding.AssetId].MediaType
                        || !next.Textures.TryLoad(binding, input.Assets[binding.AssetId], asset.Bytes, out error))
                        throw new InvalidOperationException("preview.asset-load-invalid");
                    asset = null;
                }
                CheckLatest(expectedGeneration, token);
                if (!next.Textures.IsReady(input.TextureBindings)) throw new InvalidOperationException("asset_residency_lost");
                if (!next.Hierarchy.TryReplace(input, next.Root.transform, out error)) throw new InvalidOperationException(error);
                var modelBudget = new PresentationModelTextureBudget { Limits = PresentationLocalPreviewAdapter.PreviewTextureLimits("local-web-preview"), UsedGpuBytes = next.Textures.ResidentGpuBytes };
                foreach (var binding in input.TextureBindings) modelBudget.UsedBindings++;
                var loadedModels = new HashSet<string>();
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
                await next.Models.InstantiateAsync(input, next.Hierarchy, token);
                CheckLatest(expectedGeneration, token);
                next.Renderer = new PresentationBakedSurfaceRenderer();
                if (!next.Renderer.TryBuild(input, next.Hierarchy, out error)) throw new InvalidOperationException(error);
                next.Playback.Models = next.Models;
                await next.Videos.BuildAsync(input, next.Hierarchy, async (id, videoToken) => await assetProvider(input.RequestId, input.References[id], videoToken), token);
                CheckLatest(expectedGeneration, token);
                next.Playback.Videos = next.Videos;
                if (!next.Playback.TryRefresh(input, next.Hierarchy, next.Renderer, next.Textures, 0, out error)) throw new InvalidOperationException(error);
                next.Playback.Models = next.Models;
                next.Prepared = true;
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
                current.Clock = state.Clock.Clone();
                current.ClockReceivedAt = now;
                if (restoring) current.Playback.Clear();
                if (!current.Playback.TryRefresh(current.Input, current.Hierarchy, current.Renderer, current.Textures,
                    current.Clock.RuntimeTimeMs, out error, current.Clock.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running))
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
                if (current.Playback.TryUpdate(current.Input, current.Hierarchy, current.Renderer, current.Textures, time, out error,
                    current.Clock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running)) return true;
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

        private void StopPlayback()
        {
            current.Faulted = true;
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

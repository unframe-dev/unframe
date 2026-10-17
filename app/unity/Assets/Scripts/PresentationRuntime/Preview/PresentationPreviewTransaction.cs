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
            internal readonly PresentationPlaybackPlayer Playback = new PresentationPlaybackPlayer();
            internal RuntimeClockSnapshot Clock;
            internal double ClockReceivedAt;
            internal ulong Sequence;
            internal bool Prepared;
            private bool disposed;

            internal Scene(PresentationLocalPreviewInput input, Transform parent)
            {
                Input = input;
                Root = new GameObject("Preview " + input.RequestId);
                Root.SetActive(false);
                Root.transform.SetParent(parent, false);
            }
            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                Root.SetActive(false);
                Playback.Clear();
                Renderer?.Dispose();
                Hierarchy.Clear();
                Textures.Dispose();
                PresentationTextureResidency.Destroy(Root);
            }
        }

        private readonly Transform root;
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

        public PresentationPreviewTransaction(Transform root)
        {
            if (root == null) throw new ArgumentNullException(nameof(root));
            this.root = root;
            mainThread = Thread.CurrentThread.ManagedThreadId;
        }
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
                next = new Scene(input, root);
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
                next.Renderer = new PresentationBakedSurfaceRenderer();
                if (!next.Renderer.TryBuild(input, next.Hierarchy, out error)) throw new InvalidOperationException(error);
                if (!next.Playback.TryRefresh(input, next.Hierarchy, next.Renderer, next.Textures, 0, out error)) throw new InvalidOperationException(error);
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
            if (old != null) old.Root.SetActive(false);
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
            CheckAccess();
            error = "preview.playback-request-mismatch";
            if (current == null || state == null || state.RequestId != playbackRequestId) return false;
            error = "preview.playback-sequence-stale";
            if (state.Sequence == 0 || state.Sequence <= current.Sequence) return false;
            error = "asset_residency_lost";
            if (!current.Textures.IsReady(current.Input.TextureBindings)) return false;
            if (!PresentationPreviewPlaybackValidation.TryApply(current.Input, state, out error)) return false;
            current.Sequence = state.Sequence;
            current.Clock = state.Clock.Clone();
            current.ClockReceivedAt = now;
            return current.Playback.TryRefresh(current.Input, current.Hierarchy, current.Renderer, current.Textures,
                current.Clock.RuntimeTimeMs, out error);
        }

        public bool TryUpdate(double now, out string error)
        {
            CheckAccess();
            error = null;
            if (current == null || playbackRequestId == null) return true;
            double time = PresentationPlaybackPlayer.SampleRuntimeTimeMs(current.Clock, current.ClockReceivedAt, now);
            return current.Playback.TryUpdate(current.Input, current.Hierarchy, current.Renderer, current.Textures, time, out error);
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
            playbackRequestId = null;
            latestRequestId = null;
            cancellation?.Cancel();
            cancellation = null;
            candidate?.Dispose();
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

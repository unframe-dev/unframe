using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationTexturePreloader : IDisposable
    {
        private readonly TextureResidencyPlan plan;
        private readonly PresentationTextureResidency textures;
        private readonly Func<TextureResidencyBinding, CancellationToken, Task<byte[]>> prepare;
        private readonly HashSet<string> completed = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> attempted = new HashSet<string>(StringComparer.Ordinal);
        private readonly int ownerThread = Thread.CurrentThread.ManagedThreadId;
        private string currentGroup;
        private CancellationTokenSource cancellation;
        private Task work = Task.CompletedTask;
        private bool disposed;
        private int uploadFrame = -1;
        private bool exhausted;
        private Dictionary<string, TextureResidencyBinding> future = new Dictionary<string, TextureResidencyBinding>(StringComparer.Ordinal);

        public PresentationTexturePreloader(TextureResidencyPlan plan, PresentationTextureResidency textures,
            Func<TextureResidencyBinding, CancellationToken, Task<byte[]>> prepare)
        { this.plan = plan; this.textures = textures; this.prepare = prepare; }

        private Dictionary<string, TextureResidencyBinding> BuildFuture()
        {
            var future = new Dictionary<string, TextureResidencyBinding>(StringComparer.Ordinal);
            foreach (var window in plan.GroupWindows)
            {
                if (window.GroupId == currentGroup || completed.Contains(window.GroupId)) continue;
                foreach (var binding in PresentationTextureWindow.Select(plan, window.GroupId)) future[binding.Checksum] = binding;
            }
            return future;
        }

        public void Activate(string groupId)
        {
            if (disposed) throw new ObjectDisposedException(nameof(PresentationTexturePreloader));
            if (currentGroup == groupId) return;
            var required = PresentationTextureWindow.Select(plan, groupId);
            cancellation?.Cancel();
            if (currentGroup != null) completed.Add(currentGroup);
            currentGroup = groupId;
            attempted.Clear();
            exhausted = false;
            future = BuildFuture();
            var keep = new HashSet<string>(future.Keys, StringComparer.Ordinal);
            keep.UnionWith(PresentationTextureWindow.Checksums(required));
            textures.RetainOnly(keep);
        }

        public bool PrepareForeground(string groupId, IList<TextureResidencyBinding> required, TextureLimits limits, ulong gpu, ulong bindings)
        {
            if (currentGroup != groupId) cancellation?.Cancel();
            if (!work.IsCompleted && !textures.IsReady(required)) return false;
            var union = new List<TextureResidencyBinding>(textures.Bindings); union.AddRange(required);
            if (!PresentationTextureWindow.Fits(union, limits, gpu, bindings) && currentGroup != null)
            {
                var keep = new HashSet<string>(PresentationTextureWindow.Checksums(required), StringComparer.Ordinal);
                keep.UnionWith(PresentationTextureWindow.Checksums(PresentationTextureWindow.Select(plan, currentGroup)));
                textures.RetainOnly(keep);
            }
            return true;
        }

        public Task WarmNextAsync(TextureLimits limits, ulong residentGpu, ulong residentBindings, ulong residentCpu)
        {
            if (disposed || exhausted || currentGroup == null || !work.IsCompleted
                || Application.isPlaying && (uploadFrame == Time.frameCount || PresentationTextureResidency.GpuReleaseFrame == Time.frameCount)) return work;
            foreach (var binding in future.Values)
            {
                if (textures.TryGet(binding.Checksum, out _) || attempted.Contains(binding.Checksum)) continue;
                if (limits == null || residentCpu > limits.MaxSerialLoadCpuBytes
                    || binding.PeakLoadCpuBytes > limits.MaxSerialLoadCpuBytes - residentCpu) continue;
                var union = new List<TextureResidencyBinding>(textures.Bindings) { binding };
                if (!PresentationTextureWindow.Fits(union, limits, residentGpu, residentBindings)) continue;
                attempted.Add(binding.Checksum);
                var source = new CancellationTokenSource(); cancellation = source;
                work = WarmOneAsync(binding, source, limits, residentGpu, residentBindings);
                return work;
            }
            exhausted = true;
            return Task.CompletedTask;
        }

        private async Task WarmOneAsync(TextureResidencyBinding binding, CancellationTokenSource source,
            TextureLimits limits, ulong residentGpu, ulong residentBindings)
        {
            CancellationToken token = source.Token;
            try
            {
                // Yield to display the current view before spending time on another upload.
                await Task.Yield();
                token.ThrowIfCancellationRequested();
                byte[] rgba = await prepare(binding, token);
                token.ThrowIfCancellationRequested();
                if (disposed || Thread.CurrentThread.ManagedThreadId != ownerThread) return;
                if (Application.isPlaying && PresentationTextureResidency.GpuReleaseFrame == Time.frameCount)
                { attempted.Remove(binding.Checksum); return; }
                var union = new List<TextureResidencyBinding>(textures.Bindings) { binding };
                if (future.ContainsKey(binding.Checksum) && PresentationTextureWindow.Fits(union, limits, residentGpu, residentBindings))
                {
                    if (textures.TryUpload(binding, rgba, out _)) uploadFrame = Time.frameCount;
                }
            }
            catch (Exception) { /* Speculative failures must not invalidate the displayed presentation. */ }
            finally
            {
                if (ReferenceEquals(cancellation, source)) cancellation = null;
                source.Dispose();
            }
        }

        public Task StopAsync()
        {
            Dispose();
            return work;
        }

        public void Dispose()
        {
            disposed = true;
            cancellation?.Cancel();
        }
    }
}

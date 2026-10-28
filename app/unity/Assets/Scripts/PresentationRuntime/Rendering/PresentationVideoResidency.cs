using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.Rendering;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationVideoResidency : IDisposable
    {
        private sealed class Resource
        {
            internal VideoArtifact Metadata;
            internal byte[] Bytes;
            internal string File, Url;
        }
        private sealed class Source
        {
            internal VideoArtifact Artifact;
            internal Resource Resource;
        }
        private sealed class Attempt : IDisposable
        {
            internal readonly CancellationTokenSource Cancellation;
            internal readonly Source Source;
            internal IPresentationVideoDecoder Decoder;
            internal string Url;
            internal Task Task;
            private bool disposed;
            internal Attempt(Source source, CancellationToken token) { Source = source; Cancellation = CancellationTokenSource.CreateLinkedTokenSource(token); }
            public void Dispose()
            {
                if (disposed) return; disposed = true; Cancellation.Cancel(); Decoder?.Dispose();
#if UNITY_WEBGL && !UNITY_EDITOR
                if (Url != null) UnframeVideoRevokeUrl(Url);
#endif
                Cancellation.Dispose();
            }
        }
        private sealed class Entry
        {
            internal string HostNodeId, SurfaceId, Error;
            internal DeliveredRenderSurface Surface;
            internal readonly Dictionary<string, Source> Sources = new Dictionary<string, Source>();
            internal Source Selected;
            internal Attempt Attempt;
            internal GameObject Object;
            internal Material Material;
            internal Mesh Mesh;
            internal UnityEngine.Vector2[] Uvs;
            internal double Width, Height;
        }
        private readonly List<Entry> entries = new List<Entry>();
        private readonly List<SortingGroup> sortingGroups = new List<SortingGroup>();
        private readonly Dictionary<string, Resource> resources = new Dictionary<string, Resource>();
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private readonly Func<IPresentationVideoDecoder> createDecoder;
        private Task queue = Task.CompletedTask;
        private bool disposed;
        public PresentationVideoResidency(Func<IPresentationVideoDecoder> createDecoder = null) { this.createDecoder = createDecoder ?? (() => new PresentationUnityVideoDecoder()); }
        public VideoLimits Limits { get; set; } = new VideoLimits
        {
            MaxWidth = 1920,
            MaxHeight = 1080,
            MaxPixels = 2073600,
            MaxConcurrentDecoders = 2,
            MaxEncodedBytes = 67108864,
            MaxDecodedFrameBytes = 16777216
        };
        public bool IsPreparing { get { foreach (var entry in entries) if (entry.Attempt?.Task != null && !entry.Attempt.Task.IsCompleted) return true; return false; } }
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern string UnframeVideoCreateUrl(byte[] bytes, int length);
        [DllImport("__Internal")] private static extern void UnframeVideoRevokeUrl(string url);
#endif
        public async Task BuildAsync(IPresentationRenderView view, PresentationNodeHierarchy hierarchy,
            Func<string, CancellationToken, Task<PresentationPreviewAssetData>> provider, CancellationToken token)
        {
            var order = new PresentationSurfaceOrder(view);
            ulong encodedTotal = 0;
            foreach (var surface in view.RenderSurfaces)
            {
                if (surface.RendererKind != RendererKind.Video) continue;
                if (disposed) throw new ObjectDisposedException(nameof(PresentationVideoResidency));
                if (Limits == null || !view.TryGetSurface(surface.SemanticSurfaceId, out var semantic)
                    || !hierarchy.Registry.TryGet(semantic.HostNodeId, out var host)) throw new InvalidOperationException("video-artifact-invalid");
                var entry = new Entry { Surface = surface, SurfaceId = surface.SemanticSurfaceId, HostNodeId = semantic.HostNodeId }; entries.Add(entry);
                foreach (var delivered in surface.Artifacts)
                {
                    VideoArtifact artifact = delivered.Video;
                    if (artifact?.PixelSize == null || artifact.Codec != VideoCodec.H264 || artifact.HasAlpha || artifact.DurationMs == 0
                        || artifact.PixelSize.Width == 0 || artifact.PixelSize.Width > Limits.MaxWidth || artifact.PixelSize.Height == 0 || artifact.PixelSize.Height > Limits.MaxHeight
                        || checked(artifact.PixelSize.Width * artifact.PixelSize.Height) > Limits.MaxPixels) throw new InvalidOperationException("video-budget-exceeded");
                    if (!resources.TryGetValue(artifact.Checksum, out Resource resource))
                    {
                        encodedTotal = checked(encodedTotal + artifact.EncodedSizeBytes);
                        if (encodedTotal > Limits.MaxEncodedBytes) throw new InvalidOperationException("video-budget-exceeded");
                        var downloaded = await provider(artifact.VideoAssetId, token); token.ThrowIfCancellationRequested();
                        if (downloaded?.Bytes == null || downloaded.MediaType != "video/mp4" || (ulong)downloaded.Bytes.Length != artifact.EncodedSizeBytes) throw new InvalidOperationException("video-asset-invalid");
                        byte[] bytes = (byte[])downloaded.Bytes.Clone();
                        using (var hash = SHA256.Create()) if (artifact.Checksum != "sha256:" + BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant()) throw new InvalidOperationException("video-checksum-invalid");
                        if (!PresentationVideoPreflight.TryValidate(bytes, artifact, out string error)) throw new InvalidOperationException(error);
                        resource = new Resource { Metadata = artifact.Clone() }; resources.Add(artifact.Checksum, resource);
#if UNITY_WEBGL && !UNITY_EDITOR
                        resource.Bytes = bytes;
#else
                        resource.File = Path.Combine(Application.temporaryCachePath, "unframe-video-" + Guid.NewGuid().ToString("N") + ".mp4");
                        File.WriteAllBytes(resource.File, bytes); resource.Url = new Uri(resource.File).AbsoluteUri;
#endif
                    }
                    else if (resource.Metadata.EncodedSizeBytes != artifact.EncodedSizeBytes || !resource.Metadata.PixelSize.Equals(artifact.PixelSize)
                        || resource.Metadata.DurationMs != artifact.DurationMs || resource.Metadata.HasAudio != artifact.HasAudio) throw new InvalidOperationException("video-metadata-mismatch");
                    entry.Sources.Add(artifact.ArtifactId, new Source { Artifact = artifact.Clone(), Resource = resource });
                }
                if (host.GetComponent<SortingGroup>() == null) sortingGroups.Add(host.AddComponent<SortingGroup>());
                entry.Object = PresentationBakedSurfaceRenderer.CreateQuad(); entry.Object.name = surface.RenderSurfaceId;
                entry.Object.GetComponent<MeshRenderer>().sortingOrder = order.Resolve(surface);
                entry.Object.transform.SetParent(host.transform, false);
                var bounds = surface.LogicalBounds; double sx = semantic.PhysicalSizeMeters.X / semantic.LogicalSize.X, sy = semantic.PhysicalSizeMeters.Y / semantic.LogicalSize.Y;
                if (semantic.Fit == SurfaceFit.Contain) sx = sy = Math.Min(sx, sy); if (semantic.Fit == SurfaceFit.Cover) sx = sy = Math.Max(sx, sy);
                entry.Width = bounds.Width * sx; entry.Height = bounds.Height * sy;
                entry.Object.transform.localPosition = new UnityEngine.Vector3((float)((bounds.X + bounds.Width / 2 - semantic.LogicalSize.X / 2) * sx),
                    (float)((semantic.LogicalSize.Y / 2 - bounds.Y - bounds.Height / 2) * sy), 0);
                entry.Mesh = entry.Object.GetComponent<MeshFilter>().sharedMesh; entry.Object.GetComponent<MeshFilter>().sharedMesh = entry.Mesh; entry.Uvs = entry.Mesh.uv;
                entry.Material = new Material(Resources.Load<Shader>("BakedSurface")); entry.Object.GetComponent<MeshRenderer>().sharedMaterial = entry.Material;
                entry.Object.GetComponent<MeshRenderer>().enabled = false;
            }
            await PrepareVisibleAsync(view, token);
        }
        private static Source Desired(Entry entry, IPresentationRenderView view)
        {
            if (!view.TryGetNodeState(entry.HostNodeId, out _) || !view.TryGetSurfaceState(entry.SurfaceId, out var state)) return null;
            foreach (var binding in entry.Surface.StateBindings)
                if (binding.StateId == state.StateId) return binding.Artifact == null ? null : entry.Sources[binding.Artifact.ArtifactId];
            throw new InvalidOperationException("video-state-binding-absent");
        }
        public bool IsReady(IPresentationRenderView view)
        {
            if (disposed) return false;
            foreach (var entry in entries)
            {
                Source desired = Desired(entry, view);
                if (desired != null && (!ReferenceEquals(desired, entry.Selected) || entry.Error != null || entry.Attempt?.Task?.IsCompleted != true || entry.Attempt?.Decoder?.IsPrepared != true)) return false;
            }
            return true;
        }
        private static void ReleaseDecoder(Entry entry)
        {
            entry.Attempt?.Dispose(); entry.Attempt = null; entry.Error = null;
            if (entry.Object != null) entry.Object.GetComponent<MeshRenderer>().enabled = false;
        }
        private bool Reconcile(IPresentationRenderView view, out string error)
        {
            error = null; ulong count = 0, frames = 0;
            foreach (var entry in entries)
            {
                Source desired = Desired(entry, view);
                if (!ReferenceEquals(desired, entry.Selected)) { ReleaseDecoder(entry); entry.Selected = desired; }
                if (desired == null) continue;
                count++; frames = checked(frames + desired.Artifact.PixelSize.Width * desired.Artifact.PixelSize.Height * 4);
            }
            if (count != 0 && (Limits == null || count > Limits.MaxConcurrentDecoders || frames > Limits.MaxDecodedFrameBytes)) { error = "video-budget-exceeded"; return false; }
            foreach (var entry in entries)
            {
                if (entry.Selected == null || entry.Attempt != null) continue;
                var artifact = entry.Selected.Artifact;
                if (!PresentationVideoLayout.TryCalculate(artifact.PixelSize.Width, artifact.PixelSize.Height, entry.Width, entry.Height, artifact.Fit, out var size, out var uv))
                { error = "video-fit-invalid"; return false; }
                entry.Object.transform.localScale = new UnityEngine.Vector3(size.x, size.y, 1);
                var coordinates = new UnityEngine.Vector2[entry.Uvs.Length];
                for (int i = 0; i < coordinates.Length; i++) coordinates[i] = new UnityEngine.Vector2(uv.x + entry.Uvs[i].x * uv.width, uv.y + entry.Uvs[i].y * uv.height);
                entry.Mesh.uv = coordinates;
                var attempt = new Attempt(entry.Selected, lifetime.Token); entry.Attempt = attempt;
                Task prior = queue; attempt.Task = PrepareEntryAsync(entry, attempt, prior); queue = attempt.Task;
            }
            return true;
        }
        private async Task PrepareEntryAsync(Entry entry, Attempt attempt, Task prior)
        {
            CancellationToken token = attempt.Cancellation.Token;
            try
            {
                await prior; token.ThrowIfCancellationRequested(); if (Application.isPlaying) await Task.Yield(); token.ThrowIfCancellationRequested();
                attempt.Decoder = createDecoder();
#if UNITY_WEBGL && !UNITY_EDITOR
                byte[] bytes = attempt.Source.Resource.Bytes; attempt.Url = UnframeVideoCreateUrl(bytes, bytes.Length);
#else
                attempt.Url = attempt.Source.Resource.Url;
#endif
                await attempt.Decoder.PrepareAsync(attempt.Source.Artifact, attempt.Url, token);
                token.ThrowIfCancellationRequested(); if (disposed || !ReferenceEquals(entry.Attempt, attempt)) throw new OperationCanceledException();
                entry.Material.SetTexture("_FromTex", attempt.Decoder.Texture); entry.Material.SetTexture("_ToTex", attempt.Decoder.Texture);
                var visible = entry.Object.GetComponent<MeshRenderer>().sharedMaterial;
                visible.SetTexture("_FromTex", attempt.Decoder.Texture); visible.SetTexture("_ToTex", attempt.Decoder.Texture);
            }
            catch (OperationCanceledException)
            {
                if (!token.IsCancellationRequested && !disposed && ReferenceEquals(entry.Attempt, attempt)) entry.Error = "video-decoder-prepare-cancelled";
                attempt.Dispose();
            }
            catch (Exception exception)
            {
                bool cancelled = token.IsCancellationRequested; attempt.Dispose(); if (!cancelled && !disposed && ReferenceEquals(entry.Attempt, attempt))
                    entry.Error = exception is InvalidOperationException ? exception.Message : "video-decoder-prepare-failed";
            }
        }
        public async Task PrepareVisibleAsync(IPresentationRenderView view, CancellationToken token)
        {
            while (true)
            {
                token.ThrowIfCancellationRequested(); if (disposed) throw new OperationCanceledException();
                if (!Reconcile(view, out string error)) throw new InvalidOperationException(error);
                foreach (var entry in entries) if (entry.Selected != null && entry.Error != null) throw new InvalidOperationException(entry.Error);
                if (IsReady(view)) return;
                await Task.Yield();
            }
        }
        public bool TryUpdate(IPresentationRenderView view, double time, out string error, bool runtimeClockRunning = false)
        {
            if (!Reconcile(view, out error)) return false;
            foreach (var entry in entries)
            {
                if (entry.Selected == null) continue;
                if (entry.Error != null) { error = entry.Error; return false; }
                if (entry.Attempt?.Task?.IsCompleted != true || entry.Attempt?.Decoder?.IsPrepared != true) continue;
                view.TryGetNodeState(entry.HostNodeId, out var node); entry.Object.GetComponent<MeshRenderer>().enabled = node.Active && node.Visible;
                bool playing = false; double position = 0;
                if (view.TryGetMediaState(entry.SurfaceId, out var state))
                {
                    if (state.Stopped != null) position = state.Stopped.HeldPositionMs;
                    else if (state.Active != null) { position = PresentationPlaybackPlayer.ClockPosition(state.Active.Playback, time); playing = runtimeClockRunning && state.Active.Playback.ClockCase == PlaybackClock.ClockOneofCase.Playing; }
                }
                var artifact = entry.Selected.Artifact; position = artifact.Loop ? position % artifact.DurationMs : Math.Min(position, artifact.DurationMs);
                if (!entry.Attempt.Decoder.TryApply(playing, position / 1000d, out error)) return false;
            }
            return true;
        }
        public bool TryPickInteraction(Ray ray, IPresentationRenderView view,
            out string surfaceId, out string interactionId, out float surfaceDistance)
        {
            surfaceId = interactionId = null;
            surfaceDistance = float.PositiveInfinity;
            PresentationNormalizedPoint point = default;
            foreach (Entry entry in entries)
            {
                if (entry.Object == null || !entry.Object.activeInHierarchy || !entry.Object.GetComponent<MeshRenderer>().enabled
                    || entry.Attempt?.Decoder?.IsPrepared != true || entry.Selected == null
                    || !view.TryGetNodeState(entry.HostNodeId, out var node) || !node.Active || !node.Visible || node.Opacity <= 0
                    || !view.TryGetSurface(entry.SurfaceId, out var semantic) || !ReferenceEquals(Desired(entry, view), entry.Selected)) continue;
                if (!PresentationSurfacePicking.TryIntersect(ray, entry.Object.transform, entry.Surface.LogicalBounds,
                    semantic.LogicalSize.X, semantic.LogicalSize.Y, out _, out float distance)) continue;
                // Contain changes the visible quad size, while interaction bounds remain in semantic surface coordinates.
                var transform = entry.Object.transform;
                Matrix4x4 semanticQuad = transform.parent.localToWorldMatrix * Matrix4x4.TRS(transform.localPosition,
                    transform.localRotation, new UnityEngine.Vector3((float)entry.Width, (float)entry.Height, 1));
                if (!PresentationSurfacePicking.TryIntersect(ray, semanticQuad, entry.Surface.LogicalBounds,
                    semantic.LogicalSize.X, semantic.LogicalSize.Y, out var candidate, out _)
                    || distance > surfaceDistance || distance == surfaceDistance && surfaceId != null
                        && StringComparer.Ordinal.Compare(entry.SurfaceId, surfaceId) >= 0) continue;
                surfaceId = entry.SurfaceId; surfaceDistance = distance; point = candidate;
            }
            if (surfaceId == null) return false;
            foreach (ProjectedSemanticSurface semantic in view.SemanticSurfaces)
                if (semantic.SemanticSurfaceId == surfaceId && view.TryGetSurfaceState(surfaceId, out var state))
                    return PresentationSurfacePicking.TryResolve(semantic, state.StateId, point, out interactionId);
            return false;
        }
        public void Pause()
        {
            foreach (var entry in entries) entry.Attempt?.Decoder?.Pause();
        }
        public void Dispose()
        {
            if (disposed) return; disposed = true; lifetime.Cancel();
            foreach (var entry in entries)
            {
                ReleaseDecoder(entry); PresentationTextureResidency.Destroy(entry.Mesh); PresentationTextureResidency.Destroy(entry.Object); PresentationTextureResidency.Destroy(entry.Material);
            }
            foreach (var resource in resources.Values) if (resource.File != null && File.Exists(resource.File)) File.Delete(resource.File);
            foreach (SortingGroup group in sortingGroups) PresentationTextureResidency.Destroy(group);
            sortingGroups.Clear();
            entries.Clear(); resources.Clear(); lifetime.Dispose();
        }
    }
}

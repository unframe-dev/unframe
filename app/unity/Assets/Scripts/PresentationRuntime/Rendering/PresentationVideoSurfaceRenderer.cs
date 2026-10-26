using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.Video;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationVideoSurfaceRenderer : IDisposable
    {
        private sealed class Partition
        {
            internal DeliveredRenderSurface Definition;
            internal string HostId;
            internal GameObject Root;
            internal MeshRenderer Renderer;
            internal readonly Dictionary<string, Player> Players = new Dictionary<string, Player>();
        }
        private sealed class Player
        {
            internal VideoArtifact Artifact;
            internal VideoPlayer Video;
            internal RenderTexture Texture;
            internal string Error;
        }
        private readonly List<Partition> partitions = new List<Partition>();
        private Material material;

        public bool IsReady
        {
            get
            {
                foreach (Partition partition in partitions)
                {
                    if (partition.Root == null || partition.Renderer == null) return false;
                    foreach (Player player in partition.Players.Values)
                        if (player.Video == null || !player.Video.isPrepared || player.Texture == null || !player.Texture.IsCreated() || player.Error != null) return false;
                }
                return true;
            }
        }

        public async Task BuildAsync(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy,
            IReadOnlyDictionary<string, string> assetPaths, CancellationToken token)
        {
            Clear();
            try
            {
                Shader shader = Resources.Load<Shader>("PresentationMaterials/PresentationUnlit");
                if (shader == null) throw new InvalidOperationException("video-surface-shader-absent");
                material = new Material(shader);
                foreach (DeliveredRenderSurface surface in store.RenderSurfaces)
                {
                    if (surface.RendererKind != RendererKind.Video) continue;
                    if (!store.TryGetSurface(surface.SemanticSurfaceId, out ProjectedSurfaceDefinition semantic)
                        || !hierarchy.Registry.TryGet(semantic.HostNodeId, out GameObject host)) throw new InvalidOperationException("video-host-absent");
                    var partition = new Partition { Definition = surface, HostId = semantic.HostNodeId };
                    partitions.Add(partition);
                    partition.Root = GameObject.CreatePrimitive(PrimitiveType.Quad);
                    partition.Root.name = surface.RenderSurfaceId;
                    PresentationTextureResidency.Destroy(partition.Root.GetComponent<Collider>());
                    partition.Root.transform.SetParent(host.transform, false);
                    double scaleX = semantic.PhysicalSizeMeters.X / semantic.LogicalSize.X;
                    double scaleY = semantic.PhysicalSizeMeters.Y / semantic.LogicalSize.Y;
                    if (semantic.Fit == SurfaceFit.Contain) scaleX = scaleY = Math.Min(scaleX, scaleY);
                    if (semantic.Fit == SurfaceFit.Cover) scaleX = scaleY = Math.Max(scaleX, scaleY);
                    LogicalBounds bounds = surface.LogicalBounds;
                    partition.Root.transform.localScale = new UnityEngine.Vector3((float)(bounds.Width * scaleX), (float)(bounds.Height * scaleY), 1);
                    partition.Root.transform.localPosition = new UnityEngine.Vector3((float)((bounds.X + bounds.Width / 2 - semantic.LogicalSize.X / 2) * scaleX),
                        (float)((semantic.LogicalSize.Y / 2 - bounds.Y - bounds.Height / 2) * scaleY), -(float)surface.Layer * 0.0001f);
                    partition.Renderer = partition.Root.GetComponent<MeshRenderer>();
                    partition.Renderer.sharedMaterial = material;
                    partition.Renderer.enabled = false;
                    foreach (DeliveredArtifact delivered in surface.Artifacts)
                    {
                        VideoArtifact artifact = delivered.Video;
                        if (!assetPaths.TryGetValue(artifact.VideoAssetId, out string path) || !System.IO.File.Exists(path)) throw new InvalidOperationException("video-asset-absent");
                        var child = new GameObject(artifact.ArtifactId);
                        child.transform.SetParent(partition.Root.transform, false);
                        var player = new Player { Artifact = artifact, Video = child.AddComponent<VideoPlayer>() };
                        partition.Players.Add(artifact.ArtifactId, player);
                        player.Texture = new RenderTexture((int)artifact.PixelSize.Width, (int)artifact.PixelSize.Height, 0, RenderTextureFormat.ARGB32);
                        player.Texture.Create();
                        player.Video.playOnAwake = false;
                        player.Video.source = VideoSource.Url;
                        player.Video.url = new Uri(path).AbsoluteUri;
                        player.Video.renderMode = VideoRenderMode.RenderTexture;
                        player.Video.targetTexture = player.Texture;
                        player.Video.isLooping = artifact.Loop;
                        player.Video.skipOnDrop = true;
                        player.Video.audioOutputMode = artifact.HasAudio ? VideoAudioOutputMode.Direct : VideoAudioOutputMode.None;
                        player.Video.errorReceived += (_, message) => player.Error = message;
                        bool firstFrame = false;
                        player.Video.sendFrameReadyEvents = true;
                        VideoPlayer.FrameReadyEventHandler frameReady = (_, frame) => firstFrame = true;
                        player.Video.frameReady += frameReady;
                        player.Video.Prepare();
                        double deadline = Time.realtimeSinceStartupAsDouble + 30;
                        while (!player.Video.isPrepared)
                        {
                            token.ThrowIfCancellationRequested();
                            if (player.Error != null) throw new InvalidOperationException("video-prepare-failed: " + player.Error);
                            if (Time.realtimeSinceStartupAsDouble > deadline) throw new InvalidOperationException("video-prepare-timeout");
                            await Task.Yield();
                        }
                        double frameToleranceMs = player.Video.frameRate > 0 ? 1000 / player.Video.frameRate : 50;
                        if (player.Video.width != artifact.PixelSize.Width || player.Video.height != artifact.PixelSize.Height
                            || Math.Abs(player.Video.length * 1000 - artifact.DurationMs) > Math.Max(1, frameToleranceMs)
                            || (player.Video.audioTrackCount > 0) != artifact.HasAudio)
                            throw new InvalidOperationException("video-decoded-metadata-mismatch");
                        for (ushort track = 0; track < player.Video.audioTrackCount; track++) player.Video.SetDirectAudioMute(track, true);
                        player.Video.Play();
                        deadline = Time.realtimeSinceStartupAsDouble + 30;
                        while (!firstFrame)
                        {
                            token.ThrowIfCancellationRequested();
                            if (player.Error != null) throw new InvalidOperationException("video-first-frame-failed: " + player.Error);
                            if (Time.realtimeSinceStartupAsDouble > deadline) throw new InvalidOperationException("video-first-frame-timeout");
                            await Task.Yield();
                        }
                        player.Video.Pause();
                        player.Video.frameReady -= frameReady;
                        player.Video.sendFrameReadyEvents = false;
                        if (artifact.HasAudio)
                            for (ushort track = 0; track < player.Video.audioTrackCount; track++)
                            {
                                player.Video.EnableAudioTrack(track, true);
                                player.Video.SetDirectAudioVolume(track, 1);
                                player.Video.SetDirectAudioMute(track, false);
                            }
                    }
                }
            }
            catch { Clear(); throw; }
        }

        public bool TryRefresh(PresentationRuntimeDataStore store, double runtimeTimeMs, out string error)
        {
            foreach (Partition partition in partitions)
            {
                string artifactId = null;
                if (store.TryGetSurfaceState(partition.Definition.SemanticSurfaceId, out SurfaceRuntimeState surfaceState))
                    foreach (DeliveredStateBinding binding in partition.Definition.StateBindings)
                        if (binding.StateId == surfaceState.StateId && binding.BindingCase == DeliveredStateBinding.BindingOneofCase.Artifact) artifactId = binding.Artifact.ArtifactId;
                bool visible = store.TryGetNodeState(partition.HostId, out NodeRuntimeState node) && node.Active && node.Visible;
                partition.Renderer.enabled = visible && artifactId != null;
                foreach (var entry in partition.Players)
                {
                    Player player = entry.Value;
                    if (player.Error != null) { Disable(); error = "video-playback-failed: " + player.Error; return false; }
                    if (entry.Key != artifactId || !visible) { player.Video.Pause(); continue; }
                    if (!store.TryGetMediaState(partition.Definition.SemanticSurfaceId, out MediaRuntimeState state))
                    { Disable(); error = "video-runtime-state-absent"; return false; }
                    PlaybackClock playback = state.StateCase == MediaRuntimeState.StateOneofCase.Active ? state.Active.Playback
                        : new PlaybackClock { Paused = new PausedClock { PositionMs = state.Stopped.HeldPositionMs } };
                    double position = SamplePositionMs(playback, runtimeTimeMs, player.Artifact.DurationMs, player.Artifact.Loop) / 1000;
                    if (Math.Abs(player.Video.time - position) > 0.15) player.Video.time = position;
                    bool running = playback.ClockCase == PlaybackClock.ClockOneofCase.Playing
                        && store.RuntimeClock?.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running;
                    if (running && !player.Video.isPlaying) player.Video.Play();
                    else if (!running && player.Video.isPlaying) player.Video.Pause();
                    var properties = new MaterialPropertyBlock();
                    properties.SetTexture("_BaseMap", player.Texture);
                    partition.Renderer.SetPropertyBlock(properties);
                }
            }
            error = null;
            return true;
        }

        public static double SamplePositionMs(PlaybackClock clock, double runtimeTimeMs, double durationMs, bool loop)
        {
            double position = clock.ClockCase == PlaybackClock.ClockOneofCase.Playing
                ? clock.Playing.PositionAtReferenceMs + Math.Max(0, runtimeTimeMs - clock.Playing.ReferenceRuntimeTimeMs) : clock.Paused.PositionMs;
            return loop && durationMs > 0 ? Math.Max(0, position) % durationMs : Math.Max(0, Math.Min(position, durationMs));
        }

        public void Disable()
        {
            foreach (Partition partition in partitions)
            {
                if (partition.Renderer != null) partition.Renderer.enabled = false;
                foreach (Player player in partition.Players.Values) if (player.Video != null) player.Video.Pause();
            }
        }
        private void Clear()
        {
            foreach (Partition partition in partitions)
            {
                foreach (Player player in partition.Players.Values)
                {
                    if (player.Video != null) { player.Video.Stop(); player.Video.targetTexture = null; }
                    if (player.Texture != null) { player.Texture.Release(); PresentationTextureResidency.Destroy(player.Texture); }
                }
                PresentationTextureResidency.Destroy(partition.Root);
            }
            partitions.Clear();
            PresentationTextureResidency.Destroy(material);
            material = null;
        }
        public void Dispose() { Clear(); }
    }
}

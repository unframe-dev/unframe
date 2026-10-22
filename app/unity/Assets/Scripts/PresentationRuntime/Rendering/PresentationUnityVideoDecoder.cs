using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using UnityEngine;
using UnityEngine.Video;

namespace Unframe.Unity.PresentationRuntime
{
    public interface IPresentationVideoDecoder : IDisposable
    {
        Texture Texture { get; }
        bool IsPrepared { get; }
        Task PrepareAsync(VideoArtifact artifact, string url, CancellationToken token);
        bool TryApply(bool playing, double seconds, out string error);
        void Pause();
    }
    public sealed class PresentationUnityVideoDecoder : IPresentationVideoDecoder
    {
        private GameObject root;
        private VideoPlayer player;
        private RenderTexture texture;
        private string url, failure;
        private bool disposed, playing, seekPending;
        private double seekRequestedAt;
        public Texture Texture => texture;
        public bool IsPrepared => !disposed && player != null && player.isPrepared;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern void UnframeVideoObserve(string url);
        [DllImport("__Internal")] private static extern int UnframeVideoPlayStatus(string url);
        [DllImport("__Internal")] private static extern void UnframeVideoSetRequested(string url, int playing);
#endif
        public async Task PrepareAsync(VideoArtifact artifact, string uri, CancellationToken token)
        {
            if (disposed) throw new ObjectDisposedException(nameof(PresentationUnityVideoDecoder));
            url = uri;
            texture = new RenderTexture((int)artifact.PixelSize.Width, (int)artifact.PixelSize.Height, 0, RenderTextureFormat.ARGB32); texture.Create();
            root = new GameObject("Video decoder " + artifact.ArtifactId) { hideFlags = HideFlags.HideAndDontSave };
            player = root.AddComponent<VideoPlayer>(); player.playOnAwake = false; player.source = VideoSource.Url;
            player.renderMode = VideoRenderMode.RenderTexture; player.targetTexture = texture;
            player.audioOutputMode = VideoAudioOutputMode.Direct; player.isLooping = artifact.Loop; player.url = url;
            player.errorReceived += (_, error) => failure = "video-decoder-error: " + error;
            player.seekCompleted += _ => seekPending = false;
            player.Prepare(); double deadline = Time.realtimeSinceStartupAsDouble + 30;
            while (!IsPrepared)
            {
                token.ThrowIfCancellationRequested(); if (disposed) throw new OperationCanceledException();
                if (failure != null) throw new InvalidOperationException(failure);
                if (Time.realtimeSinceStartupAsDouble > deadline) throw new InvalidOperationException("video-prepare-timeout");
                await Task.Yield();
            }
            token.ThrowIfCancellationRequested();
            if (player.width != artifact.PixelSize.Width || player.height != artifact.PixelSize.Height || artifact.HasAudio != (player.audioTrackCount > 0))
                throw new InvalidOperationException("video-decoded-metadata-mismatch");
#if UNITY_WEBGL && !UNITY_EDITOR
            UnframeVideoObserve(url);
#endif
        }
        public bool TryApply(bool shouldPlay, double seconds, out string error)
        {
            error = failure;
            if (disposed || !IsPrepared || failure != null) { error = error ?? "video-decoder-not-prepared"; return false; }
#if UNITY_WEBGL && !UNITY_EDITOR
            if (shouldPlay && UnframeVideoPlayStatus(url) == 2)
            { player.Pause(); playing = false; UnframeVideoSetRequested(url, 0); error = "video-user-activation-required"; return false; }
            UnframeVideoSetRequested(url, shouldPlay ? 1 : 0);
#endif
            if (!shouldPlay && playing) Pause();
            double now = Time.realtimeSinceStartupAsDouble;
            if (seekPending && now - seekRequestedAt > 10) { error = "video-seek-timeout"; return false; }
            double tolerance = 2d / Math.Max(1, player.frameRate);
            if (!seekPending && Math.Abs(player.time - seconds) > tolerance)
            { seekPending = true; seekRequestedAt = now; player.time = seconds; }
            if (shouldPlay && !playing) { player.Play(); playing = true; }
            return true;
        }
        public void Pause()
        {
            if (disposed) return;
            if (player != null) player.Pause();
            playing = false;
#if UNITY_WEBGL && !UNITY_EDITOR
            if (url != null) UnframeVideoSetRequested(url, 0);
#endif
        }
        public void Dispose()
        {
            if (disposed) return; disposed = true;
            if (player != null) { player.Stop(); player.targetTexture = null; player.url = ""; }
            PresentationTextureResidency.Destroy(root);
            if (texture != null) { texture.Release(); PresentationTextureResidency.Destroy(texture); }
        }
    }
}

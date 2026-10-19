using System;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Video;

public sealed class VideoSpike : MonoBehaviour
{
    [DllImport("__Internal")] private static extern void SpikeEvent(string json);
    private VideoPlayer player;
    private RenderTexture target;
    private float nextReport;
    [Serializable]
    private sealed class Observation
    {
        public string kind;
        public string detail;
        public double time;
        public bool prepared;
        public bool playing;
        public int audioTracks;
        public long frame;
        public int pixelHash;
    }
    private void Start()
    {
        target = new RenderTexture(320, 180, 0);
        player = gameObject.AddComponent<VideoPlayer>();
        player.playOnAwake = false;
        player.source = VideoSource.Url;
        player.renderMode = VideoRenderMode.RenderTexture;
        player.targetTexture = target;
        player.audioOutputMode = VideoAudioOutputMode.Direct;
        player.prepareCompleted += p => Emit("prepared");
        player.started += p => Emit("started");
        player.seekCompleted += p => Emit("seekCompleted");
        player.loopPointReached += p => Emit("ended");
        player.errorReceived += (p, e) => Emit("error", e);
        Emit("ready", Application.unityVersion);
    }
    public void Load(string url) { player.url = url; player.Prepare(); }
    public void Play(string unused) { player.Play(); Emit("playRequested"); }
    public void Pause(string unused) { player.Pause(); Emit("paused"); }
    public void Seek(string seconds) { player.time = double.Parse(seconds, System.Globalization.CultureInfo.InvariantCulture); }
    public void Dispose(string unused)
    {
        player.Stop();
        player.targetTexture = null;
        player.url = "";
        Destroy(player);
        target.Release();
        Destroy(target);
        Emit("disposed");
        player = null;
        target = null;
    }
    private void Update()
    {
        if (player != null && Time.realtimeSinceStartup >= nextReport)
        {
            nextReport = Time.realtimeSinceStartup + .25f;
            Emit("sample");
        }
    }
    private void OnGUI() { if (target != null) GUI.DrawTexture(new Rect(0, 0, 640, 360), target); }
    private void Emit(string kind, string detail = "")
    {
        int hash = 0;
        if (target != null && target.IsCreated() && player != null && player.isPrepared)
        {
            var previous = RenderTexture.active;
            RenderTexture.active = target;
            var pixels = new Texture2D(320, 180, TextureFormat.RGB24, false);
            pixels.ReadPixels(new Rect(0, 0, 320, 180), 0, 0);
            pixels.Apply();
            foreach (byte b in pixels.GetRawTextureData<byte>()) hash = unchecked(hash * 31 + b);
            Destroy(pixels);
            RenderTexture.active = previous;
        }
        SpikeEvent(JsonUtility.ToJson(new Observation
        {
            kind = kind,
            detail = detail,
            time = player != null ? player.time : 0,
            prepared = player != null && player.isPrepared,
            playing = player != null && player.isPlaying,
            audioTracks = player != null ? player.audioTrackCount : 0,
            frame = player != null ? player.frame : -1,
            pixelHash = hash
        }));
    }
}

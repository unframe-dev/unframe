using System;
using System.IO;
using System.Text;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;

static class VideoPreflightChecks
{
    internal static void Run()
    {
        var artifact = new VideoArtifact { Codec = VideoCodec.H264, PixelSize = new PixelSize { Width = 320, Height = 180 }, HasAudio = true, DurationMs = 2000 };
        byte[] tail = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "VideoAudioTail.bytes"));
        Check(tail, artifact, true, "one second video with two second audio");
        artifact.DurationMs = 1000;
        Check(tail, artifact, false, "video track duration cannot replace movie duration");
        artifact.DurationMs = 2000;
        byte[] invalid = (byte[])tail.Clone();
        int movie = Tag(invalid, "mvhd");
        Write(invalid, movie + 20, 1000);
        Check(invalid, artifact, false, "forged movie duration");
        invalid = (byte[])tail.Clone();
        Write(invalid, Tag(invalid, "tkhd") + 24, 3000);
        Check(invalid, artifact, false, "track cannot exceed movie duration");
        invalid = (byte[])tail.Clone();
        Write(invalid, Tag(invalid, "elst") + 12, 999);
        Check(invalid, artifact, false, "edit duration must match track duration");
        invalid = (byte[])tail.Clone();
        Write(invalid, Tag(invalid, "elst") + 8, uint.MaxValue);
        Check(invalid, artifact, false, "unbounded edit count");
        invalid = (byte[])tail.Clone();
        Write(invalid, Tag(invalid, "tkhd") - 4, uint.MaxValue);
        Check(invalid, artifact, false, "track box outside parent");
        artifact.HasAudio = false; artifact.DurationMs = 1000;
        Check(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "VideoSilent.bytes")), artifact, true, "video without audio");
        artifact.HasAudio = true; artifact.DurationMs = 1000;
        Check(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "VideoShortAudio.bytes")), artifact, true, "one second video with half second audio");
        artifact.DurationMs = 6000;
        Check(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Video.bytes")), artifact, true, "existing video fixture");
    }
    private static void Check(byte[] bytes, VideoArtifact artifact, bool expected, string label)
    {
        bool actual = PresentationVideoPreflight.TryValidate(bytes, artifact, out string error);
        if (actual != expected) throw new Exception(label + ": " + actual + " " + error);
    }
    private static int Tag(byte[] bytes, string tag)
    {
        byte[] target = Encoding.ASCII.GetBytes(tag);
        for (int i = 0; i <= bytes.Length - 4; i++)
            if (bytes[i] == target[0] && bytes[i + 1] == target[1] && bytes[i + 2] == target[2] && bytes[i + 3] == target[3]) return i;
        throw new Exception("Missing " + tag);
    }
    private static void Write(byte[] bytes, int offset, uint value)
    {
        for (int i = 3; i >= 0; i--) { bytes[offset + i] = (byte)value; value >>= 8; }
    }
}

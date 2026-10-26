using System;
using System.Text;
using NUnit.Framework;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationModelRenderingEditModeTests
{
    [TestCase("https://example.com/mesh.bin")]
    [TestCase("../texture.png")]
    [TestCase("data:application/octet-stream;base64,AAAA")]
    public void BinaryModel_RejectsResourcesOutsideBinaryChunk(string uri)
    {
        var bytes = Binary("{\"asset\":{\"version\":\"2.0\"},\"buffers\":[{\"uri\":\"" + uri + "\",\"byteLength\":4}]}");
        Assert.That(PresentationModelRenderer.IsSelfContainedBinary(bytes), Is.False);
    }

    [Test]
    public void BinaryModel_AcceptsEmbeddedBufferAndImage()
    {
        Assert.That(PresentationModelRenderer.IsSelfContainedBinary(Binary("{\"asset\":{\"version\":\"2.0\"},\"buffers\":[{\"byteLength\":4}],\"images\":[{\"bufferView\":0,\"mimeType\":\"image/png\"}]}")), Is.True);
    }

    [Test]
    public void ClipClock_UsesSpeedLoopAndPausedPosition()
    {
        var playback = new ClipPlayback { Speed = 2, Loop = true, Playback = new PlaybackClock { Playing = new PlayingClock { PositionAtReferenceMs = 100, ReferenceRuntimeTimeMs = 1000 } } };
        Assert.That(PresentationModelRenderer.SamplePositionMs(playback, 1800, 1000), Is.EqualTo(700));
        playback.Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 300 } };
        Assert.That(PresentationModelRenderer.SamplePositionMs(playback, 9000, 1000), Is.EqualTo(300));
        playback.Loop = false;
        playback.Playback = new PlaybackClock { Playing = new PlayingClock() };
        Assert.That(PresentationModelRenderer.SamplePositionMs(playback, 9000, 1000), Is.EqualTo(1000));
    }

    private static byte[] Binary(string json)
    {
        byte[] encoded = Encoding.UTF8.GetBytes(json.PadRight((json.Length + 3) / 4 * 4));
        byte[] bytes = new byte[20 + encoded.Length];
        Array.Copy(BitConverter.GetBytes(0x46546c67u), 0, bytes, 0, 4);
        Array.Copy(BitConverter.GetBytes(2u), 0, bytes, 4, 4);
        Array.Copy(BitConverter.GetBytes((uint)bytes.Length), 0, bytes, 8, 4);
        Array.Copy(BitConverter.GetBytes((uint)encoded.Length), 0, bytes, 12, 4);
        Array.Copy(BitConverter.GetBytes(0x4e4f534au), 0, bytes, 16, 4);
        Array.Copy(encoded, 0, bytes, 20, encoded.Length);
        return bytes;
    }
}

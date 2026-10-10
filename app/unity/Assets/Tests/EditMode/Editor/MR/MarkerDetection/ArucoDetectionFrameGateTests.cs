using NUnit.Framework;
using UnityEngine;

public sealed class ArucoDetectionFrameGateTests
{
    [TestCase(1280, 960)]
    [TestCase(1920, 1080)]
    [TestCase(2560, 1920)]
    public void DetectionPreservesTheCapturedResolution(int width, int height)
    {
        Assert.That(ArucoCameraMarkerDetection.DetectionResolution(width, height),
            Is.EqualTo(new Vector2Int(width, height)));
    }

    [Test]
    public void AllowsOneReadbackAtATimeAndLimitsRequestsToFivePerSecond()
    {
        var gate = new ArucoDetectionFrameGate();
        Assert.That(gate.TryBegin(1, 0, out int generation), Is.True);
        Assert.That(gate.TryBegin(2, 1, out _), Is.False);
        Assert.That(gate.Complete(generation), Is.True);
        Assert.That(gate.TryBegin(1, 1, out _), Is.False);
        Assert.That(gate.TryBegin(2, 0.05, out _), Is.False);
        Assert.That(gate.TryBegin(2, 0.11, out _), Is.False);
        Assert.That(gate.TryBegin(2, 0.21, out _), Is.True);
    }

    [Test]
    public void RestartDiscardsOldReadbackWithoutReusingItsBuffersUntilCompletion()
    {
        var gate = new ArucoDetectionFrameGate();
        Assert.That(gate.TryBegin(500, 1, out int generation), Is.True);
        gate.Invalidate();
        Assert.That(gate.TryBegin(1, 2, out _), Is.False);
        Assert.That(gate.Complete(generation), Is.False);
        Assert.That(gate.TryBegin(1, 2, out generation), Is.True);
        Assert.That(gate.Complete(generation), Is.True);
    }

    [Test]
    public void OverlayMapsImageTopLeftAndBottomRightToTheAspectFittedPanel()
    {
        var resolution = new Vector2Int(1280, 960);
        var rect = new Rect(-400, -300, 800, 600);
        Assert.That(ArucoMarkerOverlay.PixelToPanel(Vector2.zero, resolution, rect), Is.EqualTo(new Vector2(-400, 300)));
        Assert.That(ArucoMarkerOverlay.PixelToPanel(new Vector2(1280, 960), resolution, rect), Is.EqualTo(new Vector2(400, -300)));
        Assert.That(ArucoMarkerOverlay.PixelToPanel(new Vector2(640, 480), resolution, rect), Is.EqualTo(Vector2.zero));
    }
}

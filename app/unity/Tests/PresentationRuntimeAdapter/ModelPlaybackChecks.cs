using System;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

internal static class ModelPlaybackChecks
{
    internal static void Run()
    {
        var clip = new ClipPlayback
        {
            Speed = double.MaxValue,
            Loop = true,
            Playback = new PlaybackClock { Playing = new PlayingClock { PositionAtReferenceMs = 0, ReferenceRuntimeTimeMs = 0 } }
        };
        Check(PresentationModelPlaybackMath.PositionMilliseconds(clip, 1000, 2), 736, "loop overflow");
        Check(PresentationModelPlaybackMath.PositionMilliseconds(clip, 1000, 2.5), 920, "fractional renderer clock");
        clip.Playback.Playing.PositionAtReferenceMs = 400;
        Check(PresentationModelPlaybackMath.PositionMilliseconds(clip, 1000, 2), 136, "reference position");
        clip.Playback = new PlaybackClock { Paused = new PausedClock { PositionMs = 736 } };
        Check(PresentationModelPlaybackMath.PositionMilliseconds(clip, 1000, 100), 736, "paused position");
        clip.Playback = new PlaybackClock { Playing = new PlayingClock() };
        clip.Speed = 0.5;
        Check(PresentationModelPlaybackMath.PositionMilliseconds(clip, 1000, 1250), 625, "fractional speed");
        clip.Speed = 1001;
        Check(PresentationModelPlaybackMath.PositionMilliseconds(clip, 1000, 0.5), 500.5, "fractional elapsed time");
        clip.Loop = false;
        clip.Speed = double.MaxValue;
        Check(PresentationModelPlaybackMath.PositionMilliseconds(clip, 1000, 2), 1000, "finite clip endpoint");
    }

    private static void Check(double actual, double expected, string label)
    {
        if (actual != expected) throw new InvalidOperationException(label + ": expected " + expected + ", got " + actual);
    }
}

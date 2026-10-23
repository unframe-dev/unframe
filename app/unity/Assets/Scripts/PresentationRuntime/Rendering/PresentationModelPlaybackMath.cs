using System;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationModelPlaybackMath
    {
        internal static double PositionMilliseconds(ClipPlayback clip, double duration, double time)
        {
            double position = clip.Playback.ClockCase == PlaybackClock.ClockOneofCase.Playing
                ? clip.Playback.Playing.PositionAtReferenceMs + Math.Max(0, time - clip.Playback.Playing.ReferenceRuntimeTimeMs) * clip.Speed
                : clip.Playback.ClockCase == PlaybackClock.ClockOneofCase.Paused ? clip.Playback.Paused.PositionMs : 0;
            if (clip.Loop && duration > 0 && double.IsPositiveInfinity(position))
            {
                double elapsed = Math.Max(0, time - clip.Playback.Playing.ReferenceRuntimeTimeMs);
                double whole = Math.Floor(elapsed), fraction = elapsed - whole;
                // Renderer time can be fractional; speed reduction is valid only for the integer part.
                position = (clip.Playback.Playing.PositionAtReferenceMs % duration
                    + (whole * (clip.Speed % duration)) % duration
                    + (fraction * clip.Speed) % duration) % duration;
            }
            return duration > 0 ? clip.Loop ? position % duration : Math.Min(duration, position) : position;
        }
    }
}

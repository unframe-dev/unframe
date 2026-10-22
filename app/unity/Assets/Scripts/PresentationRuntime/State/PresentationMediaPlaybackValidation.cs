using System;
using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationMediaPlaybackValidation
    {
        internal static bool ValidClock(PlaybackClock clock, ulong time)
        {
            return clock != null && (clock.ClockCase == PlaybackClock.ClockOneofCase.Paused && Finite(clock.Paused.PositionMs)
                || clock.ClockCase == PlaybackClock.ClockOneofCase.Playing && Finite(clock.Playing.PositionAtReferenceMs) && clock.Playing.ReferenceRuntimeTimeMs <= time);
        }
        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value) && value >= 0;
        internal static bool ValidModelRun(ProjectedRuntimeCatalog catalog, ModelClipRunSnapshot run, ulong time)
        {
            if (run.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single) return Clip(catalog, run.ModelNodeId, run.Single, time);
            return run.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Crossfade && run.Crossfade.DurationMs > 0
                && PresentationDeliveryCatalog.IsSupportedEasing(run.Crossfade.Easing) && ValidClock(run.Crossfade.TransitionClock, time)
                && Clip(catalog, run.ModelNodeId, run.Crossfade.From, time) && Clip(catalog, run.ModelNodeId, run.Crossfade.To, time)
                && (!run.Crossfade.FromIsHeld || run.Crossfade.From.Playback.ClockCase == PlaybackClock.ClockOneofCase.Paused);
        }
        private static bool Clip(ProjectedRuntimeCatalog catalog, string node, ClipPlayback clip, ulong time)
            => clip != null && Finite(clip.Speed) && clip.Speed > 0 && HasClip(catalog, node, clip.ClipId, 0) && ValidClock(clip.Playback, time);
        private static bool HasClip(ProjectedRuntimeCatalog catalog, string node, string id, double position)
        { foreach (var clip in catalog.ModelClips) if (clip.ModelNodeId == node && clip.ClipId == id) return Finite(position) && position <= clip.DurationMs; return false; }
        internal static bool TryValidate(ProjectedRuntimeCatalog catalog, IEnumerable<MediaRuntimeState> mediaStates,
            IEnumerable<ModelClipRuntimeState> clipStates, IEnumerable<RuntimeRunSnapshot> runs, ulong time, out string error)
        {
            error = "preview.media-state-invalid";
            var mediaRuns = new Dictionary<string, RuntimeRunSnapshot>(); var modelRuns = new Dictionary<string, RuntimeRunSnapshot>();
            foreach (var run in runs)
            {
                if (run.RunCase == RuntimeRunSnapshot.RunOneofCase.Media) { if (mediaRuns.ContainsKey(run.Media.SurfaceId)) return false; mediaRuns.Add(run.Media.SurfaceId, run); }
                if (run.RunCase == RuntimeRunSnapshot.RunOneofCase.ModelClip) { if (modelRuns.ContainsKey(run.ModelClip.ModelNodeId)) return false; modelRuns.Add(run.ModelClip.ModelNodeId, run); }
            }
            var seen = new HashSet<string>();
            foreach (var state in mediaStates)
            {
                bool surface = false; foreach (var s in catalog.Surfaces) if (s.SurfaceId == state.SurfaceId) surface = true;
                if (!surface || !seen.Add(state.SurfaceId)) return false;
                bool active = mediaRuns.TryGetValue(state.SurfaceId, out var run);
                if (active != (state.StateCase == MediaRuntimeState.StateOneofCase.Active)) return false;
                if (active ? !state.Active.RunId.Equals(run.RunId) || !state.Active.Playback.Equals(run.Media.Playback) || !ValidClock(state.Active.Playback, time)
                    : state.StateCase != MediaRuntimeState.StateOneofCase.Stopped || !Finite(state.Stopped.HeldPositionMs)) return false;
                mediaRuns.Remove(state.SurfaceId);
            }
            seen.Clear();
            foreach (var state in clipStates)
            {
                bool model = false; foreach (var n in catalog.Nodes) if (n.NodeId == state.ModelNodeId && n.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model) model = true;
                if (!model || !seen.Add(state.ModelNodeId)) return false;
                bool active = modelRuns.TryGetValue(state.ModelNodeId, out var run);
                if (active != (state.StateCase == ModelClipRuntimeState.StateOneofCase.Active)) return false;
                if (active) { if (!state.Active.RunId.Equals(run.RunId) || !ValidModelRun(catalog, run.ModelClip, time)) return false; }
                else if (state.StateCase == ModelClipRuntimeState.StateOneofCase.HeldClip)
                { if (!HasClip(catalog, state.ModelNodeId, state.HeldClip.ClipId, state.HeldClip.PositionMs)) return false; }
                else if (state.StateCase == ModelClipRuntimeState.StateOneofCase.HeldBlend)
                {
                    var b = state.HeldBlend; if (b.From == null || b.To == null || !HasClip(catalog, state.ModelNodeId, b.From.ClipId, b.From.PositionMs)
                    || !HasClip(catalog, state.ModelNodeId, b.To.ClipId, b.To.PositionMs) || !Finite(b.ToWeight) || b.ToWeight > 1) return false;
                }
                else if (state.StateCase != ModelClipRuntimeState.StateOneofCase.DefaultPose) return false;
                modelRuns.Remove(state.ModelNodeId);
            }
            if (mediaRuns.Count != 0 || modelRuns.Count != 0) return false;
            error = null; return true;
        }
    }
}

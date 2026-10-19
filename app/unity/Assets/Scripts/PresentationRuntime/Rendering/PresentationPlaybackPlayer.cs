using System;
using System.Collections.Generic;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationPlaybackPlayer
    {
        public PresentationVideoResidency Videos { get; set; }
        public PresentationModelResidency Models { get; set; }
        private readonly PresentationNodeStateApplier states = new PresentationNodeStateApplier();
        private readonly PresentationTimelinePlayer timelines = new PresentationTimelinePlayer();
        private readonly Dictionary<string, string> runs = new Dictionary<string, string>();

        public bool TryRefresh(IPresentationRenderView view, PresentationNodeHierarchy hierarchy,
            PresentationBakedSurfaceRenderer renderer, PresentationTextureResidency textures, double runtimeTimeMs, out string error, bool runtimeClockRunning = false)
        {
            states.Apply(view, hierarchy);
            var present = new HashSet<string>();
            foreach (RuntimeRunSnapshot run in view.ActiveRuns)
            {
                if (run.RunCase != RuntimeRunSnapshot.RunOneofCase.Timeline) continue;
                string id = run.Timeline.TimelineId;
                string key = run.RunId.AssignmentEpoch + ":" + run.RunId.RunSequence;
                present.Add(id);
                if (runs.TryGetValue(id, out string existing) && existing == key) continue;
                Unframe.Presentation.ProjectedTimelineDefinition definition = null;
                foreach (var candidate in view.Catalog.Timelines)
                    if (candidate.TimelineId == id) { definition = candidate; break; }
                if (definition == null) { error = "active timeline definition is absent"; return false; }
                if (!timelines.TryStart(definition, hierarchy, run.StartedAtRuntimeTimeMs / 1000d, out error)) return false;
                runs[id] = key;
            }
            foreach (string id in new List<string>(runs.Keys))
            {
                if (present.Contains(id)) continue;
                timelines.Stop(id);
                runs.Remove(id);
            }
            return TryUpdate(view, hierarchy, renderer, textures, runtimeTimeMs, out error, runtimeClockRunning);
        }

        public bool TryUpdate(IPresentationRenderView view, PresentationNodeHierarchy hierarchy,
            PresentationBakedSurfaceRenderer renderer, PresentationTextureResidency textures, double runtimeTimeMs, out string error, bool runtimeClockRunning = false)
        {
            states.ApplyAnchors(view, hierarchy);
            if (!renderer.TryRefresh(view, textures, runtimeTimeMs, out error)) return false;
            timelines.Update(runtimeTimeMs / 1000d, retainTerminalPose: true);
            if (!TryUpdateModels(view, runtimeTimeMs, out error)) return false;
            if (Videos != null && !Videos.TryUpdate(view, runtimeTimeMs, out error, runtimeClockRunning)) return false;
            return true;
        }
        private bool TryUpdateModels(IPresentationRenderView view, double time, out string error)
        {
            error = null; if (Models == null) return true;
            foreach (var node in view.Catalog.Nodes)
            {
                if (node.NodeCase != Unframe.Presentation.ProjectedNodeDefinition.NodeOneofCase.Model) continue;
                if (!view.TryGetModelClipState(node.NodeId, out var state) || state.StateCase == ModelClipRuntimeState.StateOneofCase.DefaultPose)
                { Models.ResetPose(node.NodeId); continue; }
                if (state.StateCase == ModelClipRuntimeState.StateOneofCase.HeldClip)
                { if (!Models.TrySample(node.NodeId, state.HeldClip.ClipId, state.HeldClip.PositionMs / 1000d, null, 0, 1, out error)) return false; }
                else if (state.StateCase == ModelClipRuntimeState.StateOneofCase.HeldBlend)
                { var b = state.HeldBlend; if (!Models.TrySample(node.NodeId, b.To.ClipId, b.To.PositionMs / 1000d, b.From.ClipId, b.From.PositionMs / 1000d, (float)b.ToWeight, out error)) return false; }
                else if (state.StateCase == ModelClipRuntimeState.StateOneofCase.Active)
                {
                    RuntimeRunSnapshot run = null;
                    foreach (var candidate in view.ActiveRuns) if (candidate.RunId.Equals(state.Active.RunId) && candidate.RunCase == RuntimeRunSnapshot.RunOneofCase.ModelClip) { run = candidate; break; }
                    if (run == null) { error = "model-active-run-absent"; return false; }
                    var clip = run.ModelClip;
                    if (clip.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single)
                    { if (!Models.TrySample(node.NodeId, clip.Single.ClipId, ClipTime(view, node.NodeId, clip.Single, time), null, 0, 1, out error)) return false; }
                    else
                    {
                        var fade = clip.Crossfade;
                        float weight = fade.DurationMs == 0 ? 1 : (float)System.Math.Min(1, ClockPosition(fade.TransitionClock, time) / fade.DurationMs);
                        weight = Ease(weight, fade.Easing);
                        if (!Models.TrySample(node.NodeId, fade.To.ClipId, ClipTime(view, node.NodeId, fade.To, time), fade.From.ClipId,
                            fade.FromIsHeld ? ClockPosition(fade.From.Playback, time) / 1000d : ClipTime(view, node.NodeId, fade.From, time), weight, out error)) return false;
                    }
                }
            }
            return true;
        }
        public static double ClockPosition(PlaybackClock clock, double time)
        {
            if (clock == null) return 0;
            return clock.ClockCase == PlaybackClock.ClockOneofCase.Paused ? clock.Paused.PositionMs
                : clock.ClockCase == PlaybackClock.ClockOneofCase.Playing ? clock.Playing.PositionAtReferenceMs + System.Math.Max(0, time - clock.Playing.ReferenceRuntimeTimeMs) : 0;
        }
        private static double ClipTime(IPresentationRenderView view, string node, ClipPlayback clip, double time)
        {
            double position = clip.Playback.ClockCase == PlaybackClock.ClockOneofCase.Playing
                ? clip.Playback.Playing.PositionAtReferenceMs + System.Math.Max(0, time - clip.Playback.Playing.ReferenceRuntimeTimeMs) * clip.Speed
                : ClockPosition(clip.Playback, time);
            double duration = 0; foreach (var c in view.Catalog.ModelClips) if (c.ModelNodeId == node && c.ClipId == clip.ClipId) duration = c.DurationMs;
            return (duration > 0 ? clip.Loop ? position % duration : System.Math.Min(duration, position) : position) / 1000d;
        }
        private static float Ease(float p, Unframe.Presentation.Easing easing)
        {
            switch (easing)
            {
                case Unframe.Presentation.Easing.CubicIn: return p * p * p;
                case Unframe.Presentation.Easing.CubicOut: return 1 - UnityEngine.Mathf.Pow(1 - p, 3);
                case Unframe.Presentation.Easing.CubicInOut: return p < .5f ? 4 * p * p * p : 1 - UnityEngine.Mathf.Pow(-2 * p + 2, 3) / 2;
                default: return p;
            }
        }
        public static double SampleRuntimeTimeMs(RuntimeClockSnapshot clock, double receivedAt, double now)
        {
            if (clock == null) return 0;
            return clock.RuntimeTimeMs + (clock.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running
                ? Math.Max(0, now - receivedAt) * 1000d : 0d);
        }
        public void Clear() { timelines.Clear(); runs.Clear(); }
    }
}

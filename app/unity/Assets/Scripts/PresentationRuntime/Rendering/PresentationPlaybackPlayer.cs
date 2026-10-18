using System;
using System.Collections.Generic;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationPlaybackPlayer
    {
        private readonly PresentationNodeStateApplier states = new PresentationNodeStateApplier();
        private readonly PresentationTimelinePlayer timelines = new PresentationTimelinePlayer();
        private readonly Dictionary<string, string> runs = new Dictionary<string, string>();

        public bool TryRefresh(IPresentationRenderView view, PresentationNodeHierarchy hierarchy,
            PresentationBakedSurfaceRenderer renderer, PresentationTextureResidency textures, double runtimeTimeMs, out string error)
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
            return TryUpdate(view, hierarchy, renderer, textures, runtimeTimeMs, out error);
        }

        public bool TryUpdate(IPresentationRenderView view, PresentationNodeHierarchy hierarchy,
            PresentationBakedSurfaceRenderer renderer, PresentationTextureResidency textures, double runtimeTimeMs, out string error)
        {
            states.ApplyAnchors(view, hierarchy);
            if (!renderer.TryRefresh(view, textures, runtimeTimeMs, out error)) return false;
            timelines.Update(runtimeTimeMs / 1000d, retainTerminalPose: true);
            return true;
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

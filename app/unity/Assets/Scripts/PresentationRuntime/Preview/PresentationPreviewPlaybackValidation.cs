using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Preview;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationPreviewPlaybackValidation
    {
        internal static bool TryApply(PresentationLocalPreviewInput input, LocalPreviewPlaybackState source, out string error)
        {
            error = "preview.playback-state-invalid";
            if (!PresentationDeliveryCatalog.IsId(source.CurrentGroupId) || source.Clock == null
                || source.Clock.StatusCase == RuntimeClockSnapshot.StatusOneofCase.None) return false;
            LocalPreviewPlaybackState state = source.Clone();
            var nodes = new Dictionary<string, NodeRuntimeState>();
            var surfaces = new Dictionary<string, SurfaceRuntimeState>();
            var definitions = new Dictionary<string, ProjectedNodeDefinition>();
            string group = state.CurrentGroupId;
            foreach (var node in input.Catalog.Nodes) definitions.Add(node.NodeId, node);
            foreach (NodeRuntimeState node in state.NodeStates)
            {
                if (!definitions.TryGetValue(node.NodeId, out var definition) || nodes.ContainsKey(node.NodeId)
                    || !PresentationLocalPreviewAdapter.ValidState(node) || !Owned(definition.Owner, group)) return false;
                nodes.Add(node.NodeId, node);
            }
            foreach (SurfaceRuntimeState surface in state.SurfaceStates)
            {
                if (!input.TryGetSurface(surface.SurfaceId, out var definition) || surfaces.ContainsKey(surface.SurfaceId)
                    || !definition.ReachableStateIds.Contains(surface.StateId) || !Owned(definition.Owner, group)) return false;
                surfaces.Add(surface.SurfaceId, surface);
            }
            foreach (var node in definitions.Values)
                if (Owned(node.Owner, group) != nodes.ContainsKey(node.NodeId)
                    || nodes.ContainsKey(node.NodeId) && node.Parent.ParentCase == SpatialParent.ParentOneofCase.Node
                        && !nodes.ContainsKey(node.Parent.Node.NodeId)) return false;
            foreach (var surface in input.Catalog.Surfaces)
                if (Owned(surface.Owner, group) != surfaces.ContainsKey(surface.SurfaceId)) return false;
            var runIds = new HashSet<string>();
            var timelines = new HashSet<string>();
            var transitions = new Dictionary<string, RuntimeRunSnapshot>();
            var properties = new HashSet<string>();
            foreach (RuntimeRunSnapshot run in state.ActiveRuns)
            {
                if (run.RunId == null || run.RunId.AssignmentEpoch == 0 || run.RunId.RunSequence == 0
                    || !runIds.Add(run.RunId.AssignmentEpoch + ":" + run.RunId.RunSequence)
                    || run.StartedAtRuntimeTimeMs > state.Clock.RuntimeTimeMs || run.Cause == null
                    || !PresentationDeliveryCatalog.IsId(run.Cause.CueId)
                    || run.Completion != RunCompletion.Blocking && run.Completion != RunCompletion.NonBlocking
                    || run.Owner == null || run.Owner.ScopeCase != RuntimeRunOwner.ScopeOneofCase.Presentation
                        && (run.Owner.ScopeCase != RuntimeRunOwner.ScopeOneofCase.Group || run.Owner.Group.GroupId != group
                            || run.Owner.Group.GroupEntryEpoch == 0)) return false;
                if (run.RunCase == RuntimeRunSnapshot.RunOneofCase.Timeline)
                {
                    ProjectedTimelineDefinition definition = null;
                    foreach (var timeline in input.Catalog.Timelines)
                        if (timeline.TimelineId == run.Timeline.TimelineId) { definition = timeline; break; }
                    if (definition == null || !timelines.Add(definition.TimelineId) || !Owned(definition.Owner, group)
                        || !OwnerMatches(definition.Owner, run.Owner)) return false;
                    foreach (var track in definition.Tracks)
                        if (!nodes.ContainsKey(track.Target.NodeId) || !properties.Add(track.Target.NodeId + ":" + track.Target.Property)) return false;
                }
                else if (run.RunCase == RuntimeRunSnapshot.RunOneofCase.SurfaceTransition)
                {
                    var transition = run.SurfaceTransition;
                    if (!input.TryGetSurface(transition.SurfaceId, out var definition) || transition.DurationMs == 0
                        || !PresentationDeliveryCatalog.IsSupportedEasing(transition.Easing)
                        || !definition.ReachableStateIds.Contains(transition.FromStateId)
                        || !definition.ReachableStateIds.Contains(transition.ToStateId)
                        || transition.FromStateId == transition.ToStateId || transitions.ContainsKey(transition.SurfaceId)
                        || !OwnerMatches(definition.Owner, run.Owner)) return false;
                    transitions.Add(transition.SurfaceId, run);
                }
                else return false;
            }
            foreach (var surface in surfaces.Values)
            {
                bool hasRun = transitions.TryGetValue(surface.SurfaceId, out var run);
                if (hasRun != (surface.TransitionRunId != null)
                    || hasRun && (!run.RunId.Equals(surface.TransitionRunId) || run.SurfaceTransition.ToStateId != surface.StateId)) return false;
                transitions.Remove(surface.SurfaceId);
            }
            if (transitions.Count != 0) return false;
            input.ReplacePlayback(nodes, surfaces, new List<RuntimeRunSnapshot>(state.ActiveRuns));
            error = null;
            return true;
        }
        private static bool OwnerMatches(ResourceOwner resource, RuntimeRunOwner run)
        {
            return resource.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation
                ? run.ScopeCase == RuntimeRunOwner.ScopeOneofCase.Presentation
                : run.ScopeCase == RuntimeRunOwner.ScopeOneofCase.Group && resource.Group.GroupId == run.Group.GroupId;
        }
        private static bool Owned(ResourceOwner owner, string group)
        {
            return owner.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation
                || owner.ScopeCase == ResourceOwner.ScopeOneofCase.Group && owner.Group.GroupId == group;
        }
    }
}

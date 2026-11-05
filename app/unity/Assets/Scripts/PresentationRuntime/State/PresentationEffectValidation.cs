using System;
using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationEffectValidation
    {
        internal static bool Validate(IEnumerable<EffectRunSnapshot> runs, ProjectedRuntimeCatalog catalog,
            ulong time, string group, ulong groupEntryEpoch, ulong assignmentEpoch)
        {
            var nodes = new Dictionary<string, ProjectedNodeDefinition>();
            foreach (var node in catalog.Nodes) nodes.Add(node.NodeId, node);
            var ids = new HashSet<string>();
            foreach (var run in runs)
            {
                var config = run.Configuration;
                if (run.RunId == null || run.RunId.AssignmentEpoch == 0 || run.RunId.RunSequence == 0
                    || assignmentEpoch != 0 && run.RunId.AssignmentEpoch != assignmentEpoch
                    || !ids.Add(run.RunId.AssignmentEpoch + ":" + run.RunId.RunSequence)
                    || !nodes.TryGetValue(run.NodeId, out var node)
                    || !PresentationDeliveryCatalog.IsId(run.EffectId) || run.Cause == null || run.Owner == null
                    || !(run.Owner.ScopeCase == RuntimeRunOwner.ScopeOneofCase.Presentation
                        || run.Owner.ScopeCase == RuntimeRunOwner.ScopeOneofCase.Group && run.Owner.Group.GroupId == group
                            && run.Owner.Group.GroupEntryEpoch != 0
                            && (groupEntryEpoch == 0 || run.Owner.Group.GroupEntryEpoch == groupEntryEpoch))
                    || node.Owner.ScopeCase == ResourceOwner.ScopeOneofCase.Group
                        && (node.Owner.Group.GroupId != group || run.Owner.ScopeCase != RuntimeRunOwner.ScopeOneofCase.Group)
                    || run.StartedAtRuntimeTimeMs > time || config == null || config.Color == null
                    || config.Kind < EffectKind.Wave || config.Kind > EffectKind.Dissolve
                    || !Positive(config.Size) || !Positive(config.Speed) || config.DurationMs == 0
                    || !Unit(config.Color.Red) || !Unit(config.Color.Green) || !Unit(config.Color.Blue) || !Unit(config.Color.Alpha)
                    || double.IsNaN(config.WaveCycles) || config.WaveCycles < 0 || config.WaveCycles > 6
                    || config.Kind == EffectKind.HandGlow && config.Hand != EffectHand.Left && config.Hand != EffectHand.Right
                    || run.Status != EffectRunStatus.Active && run.Status != EffectRunStatus.Retained
                    || run.Status == EffectRunStatus.Retained && config.Kind != EffectKind.Wave) return false;
            }
            return ids.Count <= 32;
        }
        private static bool Positive(double value) => !double.IsNaN(value) && !double.IsInfinity(value) && value > 0 && value <= float.MaxValue;
        private static bool Unit(double value) => !double.IsNaN(value) && value >= 0 && value <= 1;
    }
}

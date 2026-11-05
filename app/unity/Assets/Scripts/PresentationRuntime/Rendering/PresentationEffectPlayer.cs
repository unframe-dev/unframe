using System;
using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.VisualEffects;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationEffectPlayer : IDisposable
    {
        private sealed class Entry
        {
            internal EffectRunSnapshot Snapshot;
            internal GameObject Target;
            internal readonly List<EffectHandle> Handles = new List<EffectHandle>();
            internal bool Unsupported;
            internal ulong PoseSequence;
            internal double PoseTime = -1;
        }
        private readonly VisualEffectPlayer player = new VisualEffectPlayer(int.MaxValue);
        private readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>();
        public int Count => entries.Count;

        public bool TryUpdate(IPresentationRenderView store, IEnumerable<EffectRunSnapshot> effectRuns, PresentationNodeHierarchy hierarchy, double runtimeMs, out string error)
        {
            error = null;
            try
            {
                var runs = new List<EffectRunSnapshot>(effectRuns);
                var present = new HashSet<string>();
                foreach (var run in runs) present.Add(Key(run));
                foreach (var id in new List<string>(entries.Keys))
                    if (!present.Contains(id)) Remove(id);
                foreach (var run in runs)
                {
                    string id = Key(run);
                    if (!entries.TryGetValue(id, out var entry))
                    {
                        if (hierarchy.Registry == null || !hierarchy.Registry.TryGet(run.NodeId, out GameObject node))
                            throw new InvalidOperationException("effect-node-absent");
                        entry = new Entry { Snapshot = run.Clone(), Target = node };
                        // Register before allocation so a failed mesh can release earlier allocations.
                        entries.Add(id, entry);
                        try { Start(run, id, node, entry); }
                        catch (Exception exception) when (exception is ArgumentException || exception is InvalidOperationException)
                        {
                            foreach (var handle in entry.Handles) handle.Cancel();
                            entry.Handles.Clear();
                            entry.Unsupported = true;
                        }
                    }
                    if (entry.Snapshot.NodeId != run.NodeId || !entry.Snapshot.Configuration.Equals(run.Configuration)
                        || entry.Snapshot.StartedAtRuntimeTimeMs != run.StartedAtRuntimeTimeMs || entry.Snapshot.Seed != run.Seed)
                        throw new InvalidOperationException("effect-run-identity-changed");
                    if (!entry.Unsupported && run.Configuration.Kind == EffectKind.Wave)
                        player.SetWaveOpacity(id, entry.Target.GetComponent<PresentationVisualOpacity>()?.Opacity ?? 1f);
                    if (!entry.Unsupported && run.Configuration.Kind == EffectKind.HandGlow)
                        UpdateHand(store, hierarchy, run, entry, runtimeMs);
                }
                player.Evaluate(runtimeMs);
                return true;
            }
            catch (Exception exception) when (exception is ArgumentException || exception is InvalidOperationException)
            {
                error = exception.Message;
                Clear();
                return false;
            }
        }

        private void Start(EffectRunSnapshot run, string id, GameObject node, Entry entry)
        {
            if (run.Configuration.Kind == EffectKind.Wave)
                entry.Handles.Add(player.PlayWave(Options(run, id), node.transform));
            else if (run.Configuration.Kind == EffectKind.HandGlow)
                entry.Handles.Add(player.BeginHandGlow(Options(run, id), node.transform));
            else
            {
                var meshes = node.GetComponentsInChildren<MeshRenderer>(true);
                // A partially dissolved model would leave its unsupported skinned geometry visible.
                if (meshes.Length == 0 || node.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length > 0)
                    throw new InvalidOperationException("effect-dissolve-static-mesh-required");
                var shader = Resources.Load<Shader>("VisualEffects/VisualDissolve");
                for (int i = 0; i < meshes.Length; i++)
                    entry.Handles.Add(player.PlayDissolve(Options(run, id + ":" + i), meshes[i], shader, true));
            }
        }

        private void UpdateHand(IPresentationRenderView store, PresentationNodeHierarchy hierarchy,
            EffectRunSnapshot run, Entry entry, double runtimeMs)
        {
            if (runtimeMs < run.StartedAtRuntimeTimeMs || runtimeMs <= entry.PoseTime) return;
            AnchorTarget target = run.Configuration.Hand == EffectHand.Left ? AnchorTarget.LeftHand : AnchorTarget.RightHand;
            foreach (var node in store.Catalog.Nodes)
            {
                if (node.Parent?.PresenterAnchor?.Target != target
                    || !store.TryGetAnchorSample(node.NodeId, out var sample) || sample.Position == null
                    || sample.TrackingFrameSequence <= entry.PoseSequence
                    || !hierarchy.Registry.TryGetAnchorParent(node.NodeId, out var anchor)) continue;
                player.UpdatePose(Key(run), anchor.transform.position, runtimeMs);
                entry.PoseSequence = sample.TrackingFrameSequence;
                entry.PoseTime = runtimeMs;
                return;
            }
        }

        private static EffectOptions Options(EffectRunSnapshot run, string id)
        {
            var config = run.Configuration;
            var color = config.Color;
            return new EffectOptions(id, (float)config.Size,
                new Color((float)color.Red, (float)color.Green, (float)color.Blue, (float)color.Alpha),
                (float)config.Speed, config.DurationMs, run.Seed, run.StartedAtRuntimeTimeMs, (float)config.WaveCycles);
        }
        private static string Key(EffectRunSnapshot run) => run.RunId.AssignmentEpoch + ":" + run.RunId.RunSequence;
        private void Remove(string id)
        {
            foreach (var handle in entries[id].Handles) handle.Cancel();
            entries.Remove(id);
        }
        public void Clear()
        {
            foreach (var id in new List<string>(entries.Keys)) Remove(id);
        }
        public void Dispose() { Clear(); player.Dispose(); }
    }
}

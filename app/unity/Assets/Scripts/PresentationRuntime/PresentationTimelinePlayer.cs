using System;
using System.Collections.Generic;
using Unframe.Presentation.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Evaluates Delivery timeline tracks after their matching reliable event is received.
    /// </summary>
    public sealed class PresentationTimelinePlayer
    {
        private sealed class ActiveTimeline
        {
            public string TimelineId;
            public ulong DurationMs;
            public double StartedAtSeconds;
            public List<ActiveTrack> Tracks;
            public bool IsPresetFadeIn;
            public bool IsPresetFadeOut;
            public List<GameObject> PresetTargets;
        }

        private sealed class ActiveTrack
        {
            public GameObject Target;
            public TimelineProperty Property;
            public IList<TimelineKeyframe> Keyframes;
        }

        private readonly List<ActiveTimeline> active = new List<ActiveTimeline>();

        public int ActiveCount { get { return active.Count; } }

        public bool TryStart(ProjectedTimelineDefinition timeline, PresentationNodeHierarchy hierarchy, double startedAtSeconds, out string error)
        {
            if (timeline == null || String.IsNullOrEmpty(timeline.TimelineId) || timeline.DurationMs == 0 || hierarchy == null || hierarchy.Registry == null)
            {
                error = "timeline definition or generated hierarchy is missing.";
                return false;
            }

            ActiveTimeline next = new ActiveTimeline
            {
                TimelineId = timeline.TimelineId,
                DurationMs = timeline.DurationMs,
                StartedAtSeconds = startedAtSeconds,
                Tracks = new List<ActiveTrack>(),
                IsPresetFadeIn = PresentationAnimationPresetIds.IsFadeIn(timeline.TimelineId),
                IsPresetFadeOut = PresentationAnimationPresetIds.IsBuiltIn(timeline.TimelineId) && !PresentationAnimationPresetIds.IsFadeIn(timeline.TimelineId),
                PresetTargets = new List<GameObject>(),
            };
            foreach (ProjectedTimelineTrack track in timeline.Tracks)
            {
                if (!TryCreateTrack(track, hierarchy.Registry, out ActiveTrack activeTrack, out error))
                {
                    return false;
                }

                next.Tracks.Add(activeTrack);
                if ((next.IsPresetFadeIn || next.IsPresetFadeOut) && !next.PresetTargets.Contains(activeTrack.Target))
                {
                    next.PresetTargets.Add(activeTrack.Target);
                }
            }

            Stop(timeline.TimelineId);
            if (next.IsPresetFadeIn || next.IsPresetFadeOut)
            {
                foreach (GameObject target in next.PresetTargets)
                {
                    SetTargetVisible(target, true);
                }
            }

            active.Add(next);
            Evaluate(next, 0);
            error = null;
            return true;
        }

        public void Update(double nowSeconds)
        {
            for (int index = active.Count - 1; index >= 0; index--)
            {
                ActiveTimeline timeline = active[index];
                double elapsedMs = Math.Max(0d, nowSeconds - timeline.StartedAtSeconds) * 1000d;
                Evaluate(timeline, elapsedMs);
                if (elapsedMs >= timeline.DurationMs)
                {
                    if (timeline.IsPresetFadeOut)
                    {
                        foreach (GameObject target in timeline.PresetTargets)
                        {
                            SetTargetVisible(target, false);
                        }
                    }

                    active.RemoveAt(index);
                }
            }
        }

        public void Stop(string timelineId)
        {
            for (int index = active.Count - 1; index >= 0; index--)
            {
                if (active[index].TimelineId == timelineId)
                {
                    active.RemoveAt(index);
                }
            }
        }

        public void Complete(string timelineId)
        {
            for (int index = active.Count - 1; index >= 0; index--)
            {
                ActiveTimeline timeline = active[index];
                if (timeline.TimelineId != timelineId)
                {
                    continue;
                }

                Evaluate(timeline, timeline.DurationMs);
                if (timeline.IsPresetFadeOut)
                {
                    foreach (GameObject target in timeline.PresetTargets)
                    {
                        SetTargetVisible(target, false);
                    }
                }

                active.RemoveAt(index);
            }
        }

        public void Clear()
        {
            active.Clear();
        }

        private static bool TryCreateTrack(ProjectedTimelineTrack track, PresentationNodeRegistry registry, out ActiveTrack result, out string error)
        {
            result = null;
            if (track == null || track.Target == null || track.Keyframes.Count == 0 || !registry.TryGet(track.Target.NodeId, out GameObject target))
            {
                error = "timeline track is incomplete or references an unknown node.";
                return false;
            }

            foreach (TimelineKeyframe keyframe in track.Keyframes)
            {
                if (!HasExpectedValue(track.Target.Property, keyframe))
                {
                    error = "timeline track value does not match its property.";
                    return false;
                }
            }

            result = new ActiveTrack { Target = target, Property = track.Target.Property, Keyframes = track.Keyframes };
            error = null;
            return true;
        }

        private static bool HasExpectedValue(TimelineProperty property, TimelineKeyframe keyframe)
        {
            if (keyframe == null)
            {
                return false;
            }

            return property == TimelineProperty.Opacity && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Number
                || (property == TimelineProperty.TransformPosition || property == TimelineProperty.TransformScale) && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Vector3
                || property == TimelineProperty.TransformRotation && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Quaternion;
        }

        private static void SetTargetVisible(GameObject target, bool visible)
        {
            if (target == null)
            {
                return;
            }

            target.SetActive(true);
            foreach (Renderer renderer in target.GetComponentsInChildren<Renderer>(true))
            {
                renderer.enabled = visible;
            }
        }

        private static void Evaluate(ActiveTimeline timeline, double elapsedMs)
        {
            foreach (ActiveTrack track in timeline.Tracks)
            {
                TimelineKeyframe before = track.Keyframes[0];
                TimelineKeyframe after = before;
                for (int index = 1; index < track.Keyframes.Count; index++)
                {
                    after = track.Keyframes[index];
                    if (elapsedMs <= after.TimeMs)
                    {
                        break;
                    }

                    before = after;
                }

                float progress = after.TimeMs == before.TimeMs ? 1f : Mathf.Clamp01((float)((elapsedMs - before.TimeMs) / (after.TimeMs - before.TimeMs)));
                progress = ApplyEasing(progress, before.HasEasingToNext ? before.EasingToNext : Easing.Linear);
                ApplyValue(track, before, after, progress);
            }
        }

        private static float ApplyEasing(float progress, Easing easing)
        {
            switch (easing)
            {
                case Easing.CubicIn: return progress * progress * progress;
                case Easing.CubicOut: return 1f - Mathf.Pow(1f - progress, 3f);
                case Easing.CubicInOut: return progress < 0.5f ? 4f * progress * progress * progress : 1f - Mathf.Pow(-2f * progress + 2f, 3f) / 2f;
                default: return progress;
            }
        }

        private static void ApplyValue(ActiveTrack track, TimelineKeyframe before, TimelineKeyframe after, float progress)
        {
            switch (track.Property)
            {
                case TimelineProperty.Opacity:
                    PresentationVisualOpacity.Apply(track.Target, Mathf.Lerp((float)before.Number.Value, (float)after.Number.Value, progress));
                    break;
                case TimelineProperty.TransformPosition:
                    track.Target.transform.localPosition = UnityEngine.Vector3.Lerp(ToUnityVector(before.Vector3.Value), ToUnityVector(after.Vector3.Value), progress);
                    break;
                case TimelineProperty.TransformScale:
                    track.Target.transform.localScale = UnityEngine.Vector3.Lerp(ToUnityVector(before.Vector3.Value), ToUnityVector(after.Vector3.Value), progress);
                    break;
                case TimelineProperty.TransformRotation:
                    track.Target.transform.localRotation = UnityEngine.Quaternion.Slerp(ToUnityQuaternion(before.Quaternion.Value), ToUnityQuaternion(after.Quaternion.Value), progress);
                    break;
            }
        }

        private static UnityEngine.Vector3 ToUnityVector(Unframe.Presentation.V2.Vector3 value)
        {
            return new UnityEngine.Vector3((float)value.X, (float)value.Y, (float)value.Z);
        }

        private static UnityEngine.Quaternion ToUnityQuaternion(Unframe.Presentation.V2.Quaternion value)
        {
            return new UnityEngine.Quaternion((float)value.X, (float)value.Y, (float)value.Z, (float)value.W);
        }
    }
}

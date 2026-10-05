using System;
using Unframe.Presentation.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationAnimationPresetTimelineFactory
    {
        private const float FadeTravelDistance = 0.12f;
        private const float SlideFadeTravelDistance = 0.7f;

        public static bool TryCreate(string timelineId, string nodeId, UnityEngine.Vector3 restingPosition, ulong durationMs, out ProjectedTimelineDefinition timeline, out string error)
        {
            timeline = null;
            if (!PresentationAnimationPresetIds.IsBuiltIn(timelineId) || String.IsNullOrWhiteSpace(nodeId) || durationMs == 0)
            {
                error = "a known preset id, target node id, and nonzero duration are required.";
                return false;
            }

            bool appearing = PresentationAnimationPresetIds.IsFadeIn(timelineId);
            bool sliding = PresentationAnimationPresetIds.IsSlideFade(timelineId);
            float travelDistance = sliding ? SlideFadeTravelDistance : FadeTravelDistance;
            return TryCreate(timelineId, nodeId, restingPosition, durationMs, appearing, GetDirection(timelineId), travelDistance, out timeline, out error);
        }

        public static bool TryCreateCustom(string timelineId, string nodeId, UnityEngine.Vector3 restingPosition, ulong durationMs, bool appearing, PresentationAnimationDirection direction, float travelDistance, out ProjectedTimelineDefinition timeline, out string error)
        {
            if (PresentationAnimationPresetIds.IsBuiltIn(timelineId))
            {
                timeline = null;
                error = "custom animation preset id must not replace a built-in id.";
                return false;
            }

            return TryCreate(timelineId, nodeId, restingPosition, durationMs, appearing, GetDirection(direction), travelDistance, out timeline, out error);
        }

        private static bool TryCreate(string timelineId, string nodeId, UnityEngine.Vector3 restingPosition, ulong durationMs, bool appearing, UnityEngine.Vector3 direction, float travelDistance, out ProjectedTimelineDefinition timeline, out string error)
        {
            timeline = null;
            if (String.IsNullOrWhiteSpace(timelineId) || String.IsNullOrWhiteSpace(nodeId) || durationMs == 0 || Single.IsNaN(travelDistance) || Single.IsInfinity(travelDistance) || travelDistance < 0f)
            {
                error = "a preset id, target node id, nonzero duration, and nonnegative travel distance are required.";
                return false;
            }

            UnityEngine.Vector3 offsetPosition = restingPosition + direction * travelDistance;
            UnityEngine.Vector3 fromPosition = appearing ? restingPosition - direction * travelDistance : restingPosition;
            UnityEngine.Vector3 toPosition = appearing ? restingPosition : offsetPosition;
            float fromOpacity = appearing ? 0f : 1f;
            float toOpacity = appearing ? 1f : 0f;

            timeline = new ProjectedTimelineDefinition
            {
                TimelineId = timelineId,
                DurationMs = durationMs,
                Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() },
            };
            timeline.Tracks.Add(CreateOpacityTrack(nodeId, durationMs, fromOpacity, toOpacity, appearing));
            timeline.Tracks.Add(CreatePositionTrack(nodeId, durationMs, fromPosition, toPosition, appearing));
            error = null;
            return true;
        }

        private static UnityEngine.Vector3 GetDirection(string timelineId)
        {
            if (timelineId.EndsWith("-up", StringComparison.Ordinal)) return UnityEngine.Vector3.up;
            if (timelineId.EndsWith("-down", StringComparison.Ordinal)) return UnityEngine.Vector3.down;
            if (timelineId.EndsWith("-left", StringComparison.Ordinal)) return UnityEngine.Vector3.left;
            return UnityEngine.Vector3.right;
        }

        private static UnityEngine.Vector3 GetDirection(PresentationAnimationDirection direction)
        {
            switch (direction)
            {
                case PresentationAnimationDirection.Up: return UnityEngine.Vector3.up;
                case PresentationAnimationDirection.Down: return UnityEngine.Vector3.down;
                case PresentationAnimationDirection.Left: return UnityEngine.Vector3.left;
                default: return UnityEngine.Vector3.right;
            }
        }

        private static ProjectedTimelineTrack CreateOpacityTrack(string nodeId, ulong durationMs, float from, float to, bool appearing)
        {
            ProjectedTimelineTrack track = new ProjectedTimelineTrack
            {
                Target = new TimelineTrackTarget { NodeId = nodeId, Property = TimelineProperty.Opacity },
            };
            track.Keyframes.Add(new TimelineKeyframe
            {
                TimeMs = 0,
                Number = new NumberKeyframeValue { Value = from },
                EasingToNext = appearing ? Easing.CubicOut : Easing.CubicIn,
            });
            track.Keyframes.Add(new TimelineKeyframe
            {
                TimeMs = durationMs,
                Number = new NumberKeyframeValue { Value = to },
            });
            return track;
        }

        private static ProjectedTimelineTrack CreatePositionTrack(string nodeId, ulong durationMs, UnityEngine.Vector3 from, UnityEngine.Vector3 to, bool appearing)
        {
            ProjectedTimelineTrack track = new ProjectedTimelineTrack
            {
                Target = new TimelineTrackTarget { NodeId = nodeId, Property = TimelineProperty.TransformPosition },
            };
            track.Keyframes.Add(new TimelineKeyframe
            {
                TimeMs = 0,
                Vector3 = new Vector3KeyframeValue { Value = ToContractVector(from) },
                EasingToNext = appearing ? Easing.CubicOut : Easing.CubicIn,
            });
            track.Keyframes.Add(new TimelineKeyframe
            {
                TimeMs = durationMs,
                Vector3 = new Vector3KeyframeValue { Value = ToContractVector(to) },
            });
            return track;
        }

        private static Unframe.Presentation.V2.Vector3 ToContractVector(UnityEngine.Vector3 value)
        {
            return new Unframe.Presentation.V2.Vector3 { X = value.x, Y = value.y, Z = value.z };
        }
    }
}

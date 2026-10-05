using System;
using System.Collections.Generic;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public enum PresentationAnimationDirection
    {
        Up,
        Down,
        Left,
        Right,
    }

    [Serializable]
    public sealed class PresentationAnimationPresetDefinition
    {
        [SerializeField] private string timelineId;
        [SerializeField] private string displayName;
        [SerializeField] private bool appears;
        [SerializeField] private PresentationAnimationDirection direction;
        [SerializeField, Min(0f)] private float travelDistance = 0.7f;

        public string TimelineId { get { return timelineId; } }
        public string DisplayName { get { return displayName; } }
        public bool Appears { get { return appears; } }
        public PresentationAnimationDirection Direction { get { return direction; } }
        public float TravelDistance { get { return travelDistance; } }
    }

    [CreateAssetMenu(menuName = "Unframe/Presentation Animation Preset Library", fileName = "PresentationAnimationPresetLibrary")]
    public sealed class PresentationAnimationPresetLibrary : ScriptableObject
    {
        [SerializeField] private List<PresentationAnimationPresetDefinition> additionalPresets = new List<PresentationAnimationPresetDefinition>();

        public bool Contains(string timelineId)
        {
            if (PresentationAnimationPresetIds.IsBuiltIn(timelineId))
            {
                return true;
            }

            foreach (PresentationAnimationPresetDefinition preset in additionalPresets)
            {
                if (preset != null && preset.TimelineId == timelineId)
                {
                    return true;
                }
            }

            return false;
        }

        public bool TryCreateTimeline(string timelineId, string nodeId, UnityEngine.Vector3 restingPosition, ulong durationMs, out Unframe.Presentation.V2.ProjectedTimelineDefinition timeline, out string error)
        {
            if (PresentationAnimationPresetIds.IsBuiltIn(timelineId))
            {
                return PresentationAnimationPresetTimelineFactory.TryCreate(timelineId, nodeId, restingPosition, durationMs, out timeline, out error);
            }

            foreach (PresentationAnimationPresetDefinition preset in additionalPresets)
            {
                if (preset != null && preset.TimelineId == timelineId)
                {
                    return PresentationAnimationPresetTimelineFactory.TryCreateCustom(
                        timelineId,
                        nodeId,
                        restingPosition,
                        durationMs,
                        preset.Appears,
                        preset.Direction,
                        preset.TravelDistance,
                        out timeline,
                        out error);
                }
            }

            timeline = null;
            error = "animation preset id is not registered in this library.";
            return false;
        }
    }
}

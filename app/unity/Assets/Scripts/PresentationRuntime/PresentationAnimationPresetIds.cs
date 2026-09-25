using System;
using System.Collections.Generic;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationAnimationPresetIds
    {
        public const string FadeInUp = "preset:fade-in-up";
        public const string FadeInDown = "preset:fade-in-down";
        public const string FadeInLeft = "preset:fade-in-left";
        public const string FadeInRight = "preset:fade-in-right";
        public const string FadeOutUp = "preset:fade-out-up";
        public const string FadeOutDown = "preset:fade-out-down";
        public const string FadeOutLeft = "preset:fade-out-left";
        public const string FadeOutRight = "preset:fade-out-right";
        public const string SlideFadeInUp = "preset:slide-fade-in-up";
        public const string SlideFadeInDown = "preset:slide-fade-in-down";
        public const string SlideFadeInLeft = "preset:slide-fade-in-left";
        public const string SlideFadeInRight = "preset:slide-fade-in-right";
        public const string SlideFadeOutUp = "preset:slide-fade-out-up";
        public const string SlideFadeOutDown = "preset:slide-fade-out-down";
        public const string SlideFadeOutLeft = "preset:slide-fade-out-left";
        public const string SlideFadeOutRight = "preset:slide-fade-out-right";

        private static readonly string[] BuiltInIds =
        {
            FadeInUp, FadeInDown, FadeInLeft, FadeInRight,
            FadeOutUp, FadeOutDown, FadeOutLeft, FadeOutRight,
            SlideFadeInUp, SlideFadeInDown, SlideFadeInLeft, SlideFadeInRight,
            SlideFadeOutUp, SlideFadeOutDown, SlideFadeOutLeft, SlideFadeOutRight,
        };

        public static IReadOnlyList<string> All { get { return BuiltInIds; } }

        public static bool IsBuiltIn(string timelineId)
        {
            return !String.IsNullOrEmpty(timelineId) && Array.IndexOf(BuiltInIds, timelineId) >= 0;
        }

        public static bool IsFadeIn(string timelineId)
        {
            return !String.IsNullOrEmpty(timelineId)
                && (timelineId.StartsWith("preset:fade-in-", StringComparison.Ordinal)
                    || timelineId.StartsWith("preset:slide-fade-in-", StringComparison.Ordinal));
        }

        public static bool IsSlideFade(string timelineId)
        {
            return !String.IsNullOrEmpty(timelineId)
                && timelineId.StartsWith("preset:slide-fade-", StringComparison.Ordinal);
        }
    }
}

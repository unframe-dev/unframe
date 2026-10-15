namespace Unframe.Unity.PresentationRuntime
{
    public readonly struct PresentationProgressGuidance
    {
        public string Title { get; }
        public string Instruction { get; }
        public ArmMotionPreset? MotionPreset { get; }

        private PresentationProgressGuidance(string title, string instruction, ArmMotionPreset? motionPreset = null)
        {
            Title = title;
            Instruction = instruction;
            MotionPreset = motionPreset;
        }

        public static PresentationProgressGuidance Create(PresentationUiState state, int appliedEvents,
            int totalEvents, bool canAdvance, bool isAnimating, ArmMotionPreset? upcomingPreset,
            ArmMotionPhase phase, bool waitingForRelease)
        {
            if (isAnimating)
                return new PresentationProgressGuidance("Playing", "Wait a moment");
            if (totalEvents > 0 && appliedEvents >= totalEvents)
                return new PresentationProgressGuidance("Complete", "You reached the end");
            if (state.Role == PresentationUiRole.Audience)
                return new PresentationProgressGuidance("Watching", "Presenter controls the next step");
            if (!canAdvance || !state.CanControlPresentation)
                return new PresentationProgressGuidance("Waiting", "Wait until the presentation is ready");
            if (waitingForRelease)
                return new PresentationProgressGuidance("Release trigger", "Then try the next move");
            if (!upcomingPreset.HasValue)
                return new PresentationProgressGuidance("Next slide", "Press A or Next");
            if (phase == ArmMotionPhase.WaitingTracking)
                return new PresentationProgressGuidance("Track your controllers", "Keep them in view, then try again");

            ArmMotionPreset preset = upcomingPreset.Value;
            bool bothHands = preset == ArmMotionPreset.SpreadHands || preset == ArmMotionPreset.CloseHands;
            bool moving = phase == ArmMotionPhase.Ready || phase == ArmMotionPhase.Moving;
            string instruction = moving
                ? bothHands ? "Move both hands, then release" : "Move now, then release"
                : bothHands ? "Hold a trigger, move both hands, then release" : "Hold trigger, move, then release";
            return new PresentationProgressGuidance(MotionTitle(preset), instruction, preset);
        }

        private static string MotionTitle(ArmMotionPreset preset)
        {
            switch (preset)
            {
                case ArmMotionPreset.SwipeLeft: return "Swipe left";
                case ArmMotionPreset.SwipeRight: return "Swipe right";
                case ArmMotionPreset.SwipeDown: return "Swipe down";
                case ArmMotionPreset.SwipeUp: return "Swipe up";
                case ArmMotionPreset.PushForward: return "Push forward";
                case ArmMotionPreset.PullBackward: return "Pull back";
                case ArmMotionPreset.SpreadHands: return "Spread hands";
                case ArmMotionPreset.CloseHands: return "Bring hands together";
                default: throw new System.ArgumentOutOfRangeException(nameof(preset));
            }
        }
    }
}

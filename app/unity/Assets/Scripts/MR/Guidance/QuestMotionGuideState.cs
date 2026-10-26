using System;
using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestMotionGuideState
    {
        private readonly List<ProjectedMotionGuideDefinition> candidates = new List<ProjectedMotionGuideDefinition>();
        public IReadOnlyList<ProjectedMotionGuideDefinition> Candidates => candidates;

        public void Refresh(ProjectedRuntimeCatalog catalog, ProgressionRuntimeState progression, bool presenter,
            bool calibrated, bool running, bool headTracked, bool leftTracked, bool rightTracked, bool menuVisible)
        {
            candidates.Clear();
            if (!presenter || !calibrated || !running || !headTracked || menuVisible || catalog == null
                || progression == null || progression.PhaseCase != ProgressionRuntimeState.PhaseOneofCase.Stable) return;
            foreach (ProjectedMotionGuideDefinition guide in catalog.MotionGuides)
            {
                int preset = (int)guide.Preset;
                int hand = (int)guide.Hand;
                bool supported = preset >= 1 && preset <= 8 && hand >= 1 && hand <= 4
                    && ((preset >= 7) == (hand == 4));
                bool tracked = hand == 1 ? leftTracked || rightTracked : hand == 2 ? leftTracked : hand == 3 ? rightTracked : leftTracked && rightTracked;
                if (supported && tracked && guide.GroupId == progression.CurrentGroupId && guide.StepId == progression.CurrentStepId
                    && !String.IsNullOrEmpty(guide.CueId) && guide.MinimumDistanceMeters > 0 && !Double.IsInfinity(guide.MinimumDistanceMeters)
                    && guide.WindowMs > 0) candidates.Add(guide);
            }
        }
    }
}

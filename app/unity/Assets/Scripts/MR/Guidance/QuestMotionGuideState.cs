using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestMotionGuideState
    {
        private readonly List<GestureKind> candidates = new List<GestureKind>();
        private readonly List<PresenterRecognitionZone> zones = new List<PresenterRecognitionZone>();
        public IReadOnlyList<GestureKind> Candidates => candidates;
        public IReadOnlyList<PresenterRecognitionZone> Zones => zones;
        public bool ShowAdvance { get; private set; }

        public void Refresh(PresenterRecognitionCatalog catalog, ProgressionRuntimeState progression, bool presenter,
            bool calibrated, bool running, bool headTracked, bool leftTracked, bool rightTracked, bool menuVisible, bool canAdvance)
        {
            candidates.Clear();
            zones.Clear();
            ShowAdvance = false;
            if (!presenter || !calibrated || !running || !headTracked || menuVisible
                || progression?.PhaseCase != ProgressionRuntimeState.PhaseOneofCase.Stable) return;
            if (catalog != null) zones.AddRange(catalog.Zones);
            ShowAdvance = canAdvance && zones.Count == 0;
            if (catalog == null) return;
            foreach (GestureKind gesture in catalog.Gestures)
            {
                bool both = gesture == GestureKind.SpreadHands || gesture == GestureKind.CloseHands;
                if (gesture >= GestureKind.SwipeLeft && gesture <= GestureKind.Circle
                    && (both ? leftTracked && rightTracked : leftTracked || rightTracked)
                    && !candidates.Contains(gesture)) candidates.Add(gesture);
            }
        }
    }
}

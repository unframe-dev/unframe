using System.Collections.Generic;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestTrackingSendSchedule
    {
        private const double NormalIntervalSeconds = 0.1;
        // Realtime admits at most 90 TrackingFrames in a rolling second.
        private const int MaximumFramesPerSecond = 90;
        private readonly Queue<double> sentAt = new Queue<double>();
        private double lastSentAt = double.NegativeInfinity;
        private bool positionRequested;

        public void RequestPositionSample() => positionRequested = true;
        public void DiscardRequests() => positionRequested = false;

        public bool TryBeginFrame(double now, bool ready, bool sending)
        {
            bool requested = positionRequested;
            positionRequested = false;
            if (!ready || sending || now - lastSentAt < 1d / MaximumFramesPerSecond) return false;
            if (!requested && now - lastSentAt < NormalIntervalSeconds) return false;
            while (sentAt.Count > 0 && sentAt.Peek() <= now - 1) sentAt.Dequeue();
            if (sentAt.Count >= MaximumFramesPerSecond) return false;
            sentAt.Enqueue(now);
            lastSentAt = now;
            return true;
        }
    }
}

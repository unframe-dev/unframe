using System;
using System.Diagnostics;
using Unframe.Realtime.V2;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestPresentationButtonEdges
    {
        private bool leftTrigger;
        private bool rightTrigger;
        private bool primary;

        public void Sample(bool nextLeftTrigger, bool nextRightTrigger, bool nextPrimary, bool ready,
            out bool leftRay, out bool rightRay, out bool logical)
        {
            leftRay = ready && nextLeftTrigger && !leftTrigger;
            rightRay = ready && nextRightTrigger && !rightTrigger;
            logical = ready && nextPrimary && !primary;
            leftTrigger = nextLeftTrigger;
            rightTrigger = nextRightTrigger;
            primary = nextPrimary;
        }
    }

    public static class QuestPresentationInput
    {
        private static ulong CapturedAtMs() { return (ulong)(Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency * 1000); }

        public static ControlClientItem CreateLogical(string logicalEventName, ulong presentationOriginVersion)
        {
            if (String.IsNullOrWhiteSpace(logicalEventName) || presentationOriginVersion == 0)
                throw new ArgumentException("A logical event and current presentation origin are required.");
            return new ControlClientItem
            {
                LogicalInput = new LogicalInputCommand
                {
                    ClientEventId = Guid.NewGuid().ToString("N"),
                    LogicalEventName = logicalEventName,
                    PresentationOriginVersion = presentationOriginVersion,
                    CapturedAtClientMonotonicMs = CapturedAtMs(),
                },
            };
        }

        public static ControlClientItem CreateSurfaceInteraction(string surfaceId, string interactionId, ulong presentationOriginVersion)
        {
            if (String.IsNullOrWhiteSpace(surfaceId) || String.IsNullOrWhiteSpace(interactionId) || presentationOriginVersion == 0)
                throw new ArgumentException("A picked surface, interaction, and current origin are required.");
            return new ControlClientItem
            {
                SurfaceInteraction = new SurfaceInteractionCommand
                {
                    ClientEventId = Guid.NewGuid().ToString("N"),
                    SurfaceId = surfaceId,
                    InteractionId = interactionId,
                    PresentationOriginVersion = presentationOriginVersion,
                    CapturedAtClientMonotonicMs = CapturedAtMs(),
                },
            };
        }
    }
}

using System;
using System.Diagnostics;
using Unframe.Realtime;
using Unframe.Presentation;

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

        public static ControlClientItem CreateLogical(string logicalEventName, ulong presentationOriginVersion, InputContext context, ulong commandEpoch)
        {
            if (String.IsNullOrWhiteSpace(logicalEventName))
                throw new ArgumentException("A logical event is required.");
            return new ControlClientItem
            {
                LogicalInput = new LogicalInputCommand
                {
                    ClientEventId = EventId(commandEpoch),
                    CommandEpoch = commandEpoch,
                    InputContext = context?.Clone() ?? throw new ArgumentNullException(nameof(context)),
                    LogicalEventName = logicalEventName,
                    PresentationOriginVersion = presentationOriginVersion,
                    CapturedAtClientMonotonicMs = CapturedAtMs(),
                },
            };
        }

        public static ControlClientItem CreateSurfaceInteraction(string surfaceId, string interactionId, ulong presentationOriginVersion, InputContext context, ulong commandEpoch)
        {
            if (String.IsNullOrWhiteSpace(surfaceId) || String.IsNullOrWhiteSpace(interactionId))
                throw new ArgumentException("A picked surface and interaction are required.");
            return new ControlClientItem
            {
                SurfaceInteraction = new SurfaceInteractionCommand
                {
                    ClientEventId = EventId(commandEpoch),
                    CommandEpoch = commandEpoch,
                    InputContext = context?.Clone() ?? throw new ArgumentNullException(nameof(context)),
                    SurfaceId = surfaceId,
                    InteractionId = interactionId,
                    PresentationOriginVersion = presentationOriginVersion,
                    CapturedAtClientMonotonicMs = CapturedAtMs(),
                },
            };
        }
        private static string EventId(ulong epoch)
        {
            if (epoch == 0) throw new ArgumentException("A synchronized command epoch is required.");
            return epoch.ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + Guid.NewGuid().ToString("D");
        }

        public static ControlClientItem CreateRecognition(PresenterRecognitionResult result, ulong origin, ulong epoch)
        {
            if (result?.Context == null) throw new ArgumentException("Recognition requires captured context.");
            string id = EventId(epoch);
            if (result.Gesture != GestureKind.Unspecified)
                return new ControlClientItem
                {
                    GestureInput = new GestureInputCommand
                    {
                        ClientEventId = id,
                        CommandEpoch = epoch,
                        InputContext = result.Context.Clone(),
                        Gesture = result.Gesture,
                        PresentationOriginVersion = origin,
                        CapturedAtClientMonotonicMs = CapturedAtMs()
                    }
                };
            return new ControlClientItem
            {
                ZoneInput = new ZoneInputCommand
                {
                    ClientEventId = id,
                    CommandEpoch = epoch,
                    InputContext = result.Context.Clone(),
                    ZoneId = result.ZoneId,
                    Edge = result.Edge,
                    PresentationOriginVersion = origin,
                    CapturedAtClientMonotonicMs = CapturedAtMs()
                }
            };
        }

        public static ControlClientItem CreateControl(RuntimeControlKind kind, ulong origin, ulong epoch, string groupId = null, string stepId = null)
        {
            if (kind < RuntimeControlKind.Pause || kind > RuntimeControlKind.Recalibrate
                || kind == RuntimeControlKind.SelectStep && (String.IsNullOrEmpty(groupId) || String.IsNullOrEmpty(stepId))
                || kind != RuntimeControlKind.SelectStep && (groupId != null || stepId != null)) throw new ArgumentException("Invalid runtime control.");
            return new ControlClientItem
            {
                RuntimeControl = new RuntimeControlCommand
                {
                    ClientEventId = EventId(epoch),
                    CommandEpoch = epoch,
                    PresentationOriginVersion = origin,
                    Kind = kind,
                    StepSelection = kind == RuntimeControlKind.SelectStep ? new StepSelection { GroupId = groupId, StepId = stepId } : null
                }
            };
        }
    }
}

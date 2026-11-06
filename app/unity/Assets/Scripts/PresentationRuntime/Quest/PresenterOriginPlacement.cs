using System;
using System.Threading;
using Unframe.Realtime;
using UnityEngine;
using ProtoVector3 = Unframe.Presentation.Vector3;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresenterOriginPlacement
    {
        private Pose marker;
        private Pose head;
        private bool captured;
        private bool completed;
        private bool explicitPlacement;
        private string sessionId;
        private ControlClientItem command;
        private CancellationTokenSource commandLifetime;
        public CancellationToken CommandCancellation => commandLifetime?.Token ?? new CancellationToken(true);
        public bool IsConfirmed => completed;
        public bool IsPending => !completed;

        public bool BeginSession(string id)
        {
            if (sessionId == id) return false;
            bool replacingSession = sessionId != null;
            if (replacingSession) captured = false;
            sessionId = id;
            explicitPlacement = false;
            completed = false;
            ClearCommand();
            return replacingSession;
        }

        public void RequestPlacement()
        {
            captured = false;
            completed = false;
            explicitPlacement = true;
            ClearCommand();
        }

        public void InvalidateCapture()
        {
            if (!completed && command != null) explicitPlacement = true;
            captured = false;
            ClearCommand();
        }

        public void Capture(Pose worldFromMarker, Pose worldFromHead)
        {
            if (captured || completed) return;
            marker = worldFromMarker;
            head = worldFromHead;
            captured = true;
        }

        public ControlClientItem Prepare(PresentationOrigin origin, ulong epoch, ProtoVector3 placementReferencePoint)
        {
            if (completed || !captured || origin == null || epoch == 0) return null;
            if (command != null) return command.Clone();
            if (!explicitPlacement && origin.Version > 0)
            {
                completed = true;
                return null;
            }
            if (!PresentationCalibrationMath.TryPresenterOrigin(marker, head, origin.Pose, placementReferencePoint, out var pose))
                throw new InvalidOperationException("presenter-placement-invalid");
            command = QuestPresentationInput.CreatePresentationOrigin(pose, origin.Version, epoch);
            commandLifetime = new CancellationTokenSource();
            return command.Clone();
        }

        public bool Confirm(CommandOutcome outcome, ulong appliedSequence, ulong originVersion, ulong commandEpoch, bool synchronized)
        {
            if (outcome == null || command?.PresentationOrigin.ClientEventId != outcome.ClientEventId
                || outcome.ResultCase != CommandOutcome.ResultOneofCase.Accepted
                || appliedSequence < outcome.Accepted.ReliableSequence
                || originVersion <= command.PresentationOrigin.ExpectedPresentationOriginVersion
                || commandEpoch < command.PresentationOrigin.CommandEpoch || !synchronized) return false;
            completed = true;
            ClearCommand(false);
            explicitPlacement = false;
            return true;
        }

        private void ClearCommand(bool cancel = true)
        {
            command = null;
            CancellationTokenSource previous = commandLifetime;
            commandLifetime = null;
            if (previous == null) return;
            if (cancel) previous.Cancel();
            previous.Dispose();
        }

        public bool Reject(string commandId)
        {
            if (command?.PresentationOrigin.ClientEventId != commandId) return false;
            ClearCommand();
            captured = false;
            completed = false;
            explicitPlacement = true;
            return true;
        }
    }
}

using System;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresenterInputSynchronizationState
    {
        private PresenterInputSynchronization current;
        private bool acknowledged;
        public bool Ready => acknowledged && current?.Phase == InputSynchronizationPhase.Ready;
        public ulong CommandEpoch => current?.CommandEpoch ?? 0;
        public InputContext Context => Ready ? current.InputContext.Clone() : null;
        public PresenterRecognitionCatalog Catalog => Ready ? current.RecognitionCatalog.Clone() : null;
        public ulong Revision => current?.SynchronizationRevision ?? 0;
        public event Action Invalidated;

        public bool Receive(PresenterInputSynchronization value)
        {
            if (value == null || value.Reason == InputSynchronizationReason.Unspecified || !Enum.IsDefined(typeof(InputSynchronizationReason), value.Reason)
                || value.SynchronizationRevision == 0 || value.CommandEpoch == 0
                || value.InputContext == null || value.InputContext.InputEpoch == 0
                || value.InputContext.GroupEntryEpoch == 0 || value.InputContext.StepEntryEpoch == 0
                || String.IsNullOrEmpty(value.InputContext.GroupId) || String.IsNullOrEmpty(value.InputContext.StepId)
                || !ValidCatalog(value.RecognitionCatalog) || value.CalculateSize() > 4096
                || value.Phase != InputSynchronizationPhase.Required && value.Phase != InputSynchronizationPhase.Ready
                || value.HasNextCommandEpoch && (value.Phase != InputSynchronizationPhase.Required
                    || value.CommandEpoch == ulong.MaxValue || value.NextCommandEpoch != value.CommandEpoch + 1)) return false;
            if (current != null)
            {
                if (value.SynchronizationRevision < current.SynchronizationRevision) return false;
                if (value.SynchronizationRevision == current.SynchronizationRevision)
                {
                    if (current.Equals(value)) return true;
                    if (current.Phase != InputSynchronizationPhase.Required || value.Phase != InputSynchronizationPhase.Ready
                        || !acknowledged || current.Reason != value.Reason || !current.InputContext.Equals(value.InputContext)
                        || !current.RecognitionCatalog.Equals(value.RecognitionCatalog)
                        || value.CommandEpoch != (current.HasNextCommandEpoch ? current.NextCommandEpoch : current.CommandEpoch)
                        || value.ReliableSequence != current.ReliableSequence) return false;
                    current = value.Clone();
                    return true;
                }
                if (value.CommandEpoch < current.CommandEpoch) return false;
            }
            if (value.Phase != InputSynchronizationPhase.Required) return false;
            current = value.Clone();
            acknowledged = false;
            Invalidated?.Invoke();
            return true;
        }

        public InputSynchronizationAck TryCreateAck(ulong appliedSequence)
        {
            if (current == null || current.Phase != InputSynchronizationPhase.Required || appliedSequence < current.ReliableSequence) return null;
            acknowledged = true;
            return new InputSynchronizationAck
            {
                SynchronizationRevision = current.SynchronizationRevision,
                InputContext = current.InputContext.Clone(),
                CommandEpoch = current.HasNextCommandEpoch ? current.NextCommandEpoch : current.CommandEpoch,
                AppliedReliableSequence = appliedSequence,
                PendingCommandsDiscarded = true,
            };
        }

        private static bool ValidCatalog(PresenterRecognitionCatalog catalog)
        {
            if (catalog == null) return false;
            GestureKind previous = GestureKind.Unspecified;
            foreach (GestureKind gesture in catalog.Gestures)
            {
                if (gesture <= previous || gesture > GestureKind.CloseHands) return false;
                previous = gesture;
            }
            string prior = null;
            foreach (PresenterRecognitionZone zone in catalog.Zones)
            {
                if (!PresentationDeliveryCatalog.IsId(zone.ZoneId) || prior != null && StringComparer.Ordinal.Compare(prior, zone.ZoneId) >= 0
                    || zone.Center == null || !PresentationDeliveryCatalog.IsCanonicalFinite(zone.Center.X)
                    || !PresentationDeliveryCatalog.IsCanonicalFinite(zone.Center.Y) || !PresentationDeliveryCatalog.IsCanonicalFinite(zone.Center.Z)) return false;
                prior = zone.ZoneId;
            }
            return true;
        }

        public void Suspend() { acknowledged = false; Invalidated?.Invoke(); }

        public void Disconnect()
        {
            current = null;
            acknowledged = false;
            Invalidated?.Invoke();
        }
    }
}

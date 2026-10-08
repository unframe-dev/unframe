using System;
using ProtoPose = Unframe.Presentation.Pose;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationCalibrationState
    {
        private ProtoPose calibration;
        public bool IsValid => calibration != null;
        public ulong Revision { get; private set; }
        public string Reason { get; private set; } = "not-calibrated";
        public event Action Changed;
        public ProtoPose PresentationFromQuestLocal => calibration?.Clone();

        public bool TrySet(ProtoPose pose, out string error)
        {
            error = null;
            if (!IsCanonical(pose))
            {
                error = "calibration-pose-invalid";
                return false;
            }
            if (calibration != null && calibration.Equals(pose)) return true;
            if (Revision == ulong.MaxValue)
            {
                error = "calibration-revision-exhausted";
                return false;
            }
            calibration = pose.Clone();
            Reason = null;
            Revision++;
            Changed?.Invoke();
            return true;
        }

        public void Invalidate(string reason)
        {
            if (String.IsNullOrWhiteSpace(reason)) throw new ArgumentException("An invalidation reason is required.", nameof(reason));
            if (calibration == null && Reason == reason) return;
            if (Revision == ulong.MaxValue) throw new InvalidOperationException("calibration-revision-exhausted");
            calibration = null;
            Reason = reason;
            Revision++;
            Changed?.Invoke();
        }

        internal static bool IsCanonical(ProtoPose pose)
        {
            return pose?.Position != null && PresentationDeliveryCatalog.IsCanonicalFinite(pose.Position.X)
                && PresentationDeliveryCatalog.IsCanonicalFinite(pose.Position.Y)
                && PresentationDeliveryCatalog.IsCanonicalFinite(pose.Position.Z)
                && PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(pose.Rotation);
        }
    }
}

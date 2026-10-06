using System;
using System.Collections.Generic;
using System.Diagnostics;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.XR;
using ProtoPose = Unframe.Presentation.Pose;
using ProtoQuaternion = Unframe.Presentation.Quaternion;
using ProtoVector3 = Unframe.Presentation.Vector3;

namespace Unframe.Unity.PresentationRuntime
{
    public interface IQuestBodyPoseSource
    {
        bool TryGetQuestLocalPose(out UnityEngine.Vector3 position, out UnityEngine.Quaternion rotation);
    }

    public readonly struct QuestPoseSample
    {
        public readonly TrackedTarget Target;
        public readonly UnityEngine.Vector3 Position;
        public readonly UnityEngine.Quaternion Rotation;
        public readonly bool Available;

        public QuestPoseSample(TrackedTarget target, UnityEngine.Vector3 position, UnityEngine.Quaternion rotation, bool available = true)
        {
            Target = target;
            Position = position;
            Rotation = rotation;
            Available = available;
        }

        public static QuestPoseSample Unavailable(TrackedTarget target)
        {
            return new QuestPoseSample(target, UnityEngine.Vector3.zero, UnityEngine.Quaternion.identity, false);
        }
    }

    public static class QuestPresentationTracking
    {
        public static TrackingFrame CreateFrame(ProtoPose presentationFromQuestLocal, params QuestPoseSample[] samples)
        {
            if (presentationFromQuestLocal?.Position == null || presentationFromQuestLocal.Rotation == null
                || samples == null || samples.Length > 4) throw new ArgumentException("Tracking requires calibration and at most four targets.");
            TrackingFrame frame = new TrackingFrame
            {
                CapturedAtClientMonotonicMs = (ulong)(Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency * 1000),
                PresentationFromQuestLocal = presentationFromQuestLocal.Clone(),
            };
            HashSet<TrackedTarget> targets = new HashSet<TrackedTarget>();
            foreach (QuestPoseSample sample in samples)
            {
                if (sample.Target < TrackedTarget.Head || sample.Target > TrackedTarget.Body || !targets.Add(sample.Target))
                    throw new ArgumentException("Tracking targets must be unique and known.");
                frame.Samples.Add(new TrackedPoseSample
                {
                    Target = sample.Target,
                    QuestLocalPose = sample.Available ? ToCanonicalPose(sample.Position, sample.Rotation)
                        : ToCanonicalPose(UnityEngine.Vector3.zero, UnityEngine.Quaternion.identity),
                    PositionAvailable = sample.Available,
                    RotationAvailable = sample.Available,
                });
            }
            return frame;
        }

        public static bool TrySample(XRNode node, TrackedTarget target, out QuestPoseSample sample)
        {
            InputDevice device = InputDevices.GetDeviceAtXRNode(node);
            if (device.isValid && device.TryGetFeatureValue(CommonUsages.isTracked, out bool tracked) && tracked
                && device.TryGetFeatureValue(CommonUsages.trackingState, out InputTrackingState trackingState)
                && (trackingState & (InputTrackingState.Position | InputTrackingState.Rotation)) == (InputTrackingState.Position | InputTrackingState.Rotation)
                && device.TryGetFeatureValue(CommonUsages.devicePosition, out UnityEngine.Vector3 position)
                && device.TryGetFeatureValue(CommonUsages.deviceRotation, out UnityEngine.Quaternion rotation))
            {
                sample = new QuestPoseSample(target, position, rotation);
                return true;
            }
            sample = QuestPoseSample.Unavailable(target);
            return false;
        }

        public static ProtoPose ToCanonicalPose(UnityEngine.Vector3 position, UnityEngine.Quaternion rotation)
        {
            double x = -rotation.x;
            double y = -rotation.y;
            double z = rotation.z;
            double w = rotation.w;
            double norm = Math.Sqrt(x * x + y * y + z * z + w * w);
            if (!IsFinite(position.x) || !IsFinite(position.y) || !IsFinite(position.z)
                || !IsFinite(norm) || norm <= 0) throw new ArgumentException("A finite tracked pose is required.");
            x /= norm;
            y /= norm;
            z /= norm;
            w /= norm;
            if (w < 0 || w == 0 && (x < 0 || x == 0 && (y < 0 || y == 0 && z < 0)))
            {
                x = -x;
                y = -y;
                z = -z;
                w = -w;
            }
            return new ProtoPose
            {
                Position = new ProtoVector3 { X = PositiveZero(position.x), Y = PositiveZero(position.y), Z = PositiveZero(-position.z) },
                Rotation = new ProtoQuaternion { X = PositiveZero(x), Y = PositiveZero(y), Z = PositiveZero(z), W = PositiveZero(w) },
            };
        }

        private static bool IsFinite(double value) { return !Double.IsNaN(value) && !Double.IsInfinity(value); }
        private static double PositiveZero(double value) { return value == 0 ? 0 : value; }
    }
}

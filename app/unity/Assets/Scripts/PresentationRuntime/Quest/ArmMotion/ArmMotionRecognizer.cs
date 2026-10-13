using System;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public enum ArmMotionPreset
    {
        SwipeLeft,
        SwipeRight,
        SwipeDown,
        SwipeUp,
        PushForward,
        PullBackward,
        SpreadHands,
        CloseHands
    }

    public readonly struct ArmMotionFrame
    {
        public Vector3 HeadPosition { get; }
        public Quaternion HeadRotation { get; }
        public bool HeadAvailable { get; }
        public Vector3 LeftPosition { get; }
        public bool LeftAvailable { get; }
        public Vector3 RightPosition { get; }
        public bool RightAvailable { get; }

        public ArmMotionFrame(Vector3 headPosition, Quaternion headRotation, bool headAvailable,
            Vector3 leftPosition, bool leftAvailable, Vector3 rightPosition, bool rightAvailable)
        {
            HeadPosition = headPosition;
            HeadRotation = headRotation;
            HeadAvailable = headAvailable;
            LeftPosition = leftPosition;
            LeftAvailable = leftAvailable;
            RightPosition = rightPosition;
            RightAvailable = rightAvailable;
        }
    }

    public enum ArmMotionPhase { WaitingTrigger, WaitingTracking, Ready, Moving, Matched, Failed }

    public enum ArmMotionDiagnosticReason
    {
        Reset, None, HeadTrackingUnavailable, HandTrackingUnavailable, InvalidPose,
        InvalidTimestamp, FrameGap, ClockNotIncreasing, TrackingChanged,
        WindowExpired, WrongDirection, DistanceTooSmall, SpeedTooLow, OffAxis,
        BothHandsMustMove
    }

    public readonly struct ArmMotionDiagnostics
    {
        public ArmMotionPhase Phase { get; }
        public ArmMotionDiagnosticReason Reason { get; }
        public bool HeadAvailable { get; }
        public bool LeftAvailable { get; }
        public bool RightAvailable { get; }
        public float LeftFrameSpeedMetersPerSecond { get; }
        public float RightFrameSpeedMetersPerSecond { get; }
        public float MaximumOffAxisRatio { get; }
        public float MinimumEachHandDistanceMeters { get; }
        public double WindowElapsedSeconds { get; }
        public double WindowSeconds { get; }
        public float MinimumDistanceMeters { get; }
        public float MinimumSpeedMetersPerSecond { get; }
        public Vector3 LeftDisplacement { get; }
        public Vector3 RightDisplacement { get; }
        public float LeftDistanceMeters { get; }
        public float RightDistanceMeters { get; }
        public float LeftOffAxisMeters { get; }
        public float RightOffAxisMeters { get; }
        public float LeftSpeedMetersPerSecond { get; }
        public float RightSpeedMetersPerSecond { get; }
        public float InitialSpanMeters { get; }
        public float CurrentSpanMeters { get; }
        public float SpanDistanceMeters { get; }
        public float LeftRadialDistanceMeters { get; }
        public float RightRadialDistanceMeters { get; }

        internal ArmMotionDiagnostics(ArmMotionPhase phase, ArmMotionDiagnosticReason reason,
            ArmMotionFrame frame, double elapsed, double window,
            float minimumDistance, float minimumSpeed, float leftFrameSpeed, float rightFrameSpeed, Vector3 left, Vector3 right, Vector3 direction,
            float initialSpan, float currentSpan, float spanDistance, float leftRadial, float rightRadial)
        {
            Phase = phase;
            Reason = reason;
            HeadAvailable = frame.HeadAvailable;
            LeftAvailable = frame.LeftAvailable;
            RightAvailable = frame.RightAvailable;
            LeftFrameSpeedMetersPerSecond = leftFrameSpeed;
            RightFrameSpeedMetersPerSecond = rightFrameSpeed;
            MaximumOffAxisRatio = ArmMotionRecognizer.OffAxisRatio;
            MinimumEachHandDistanceMeters = ArmMotionRecognizer.EachHandDistance;
            WindowElapsedSeconds = elapsed;
            WindowSeconds = window;
            MinimumDistanceMeters = minimumDistance;
            MinimumSpeedMetersPerSecond = minimumSpeed;
            LeftDisplacement = left;
            RightDisplacement = right;
            LeftDistanceMeters = Vector3.Dot(left, direction);
            RightDistanceMeters = Vector3.Dot(right, direction);
            LeftOffAxisMeters = (left - direction * LeftDistanceMeters).magnitude;
            RightOffAxisMeters = (right - direction * RightDistanceMeters).magnitude;
            LeftSpeedMetersPerSecond = elapsed > 0 ? (float)(LeftDistanceMeters / elapsed) : 0;
            RightSpeedMetersPerSecond = elapsed > 0 ? (float)(RightDistanceMeters / elapsed) : 0;
            InitialSpanMeters = initialSpan;
            CurrentSpanMeters = currentSpan;
            SpanDistanceMeters = spanDistance;
            LeftRadialDistanceMeters = leftRadial;
            RightRadialDistanceMeters = rightRadial;
        }
    }

    public sealed class ArmMotionRecognizer
    {
        private const float HandDistance = 0.28f;
        private const float SeparationDistance = 0.20f;
        internal const float EachHandDistance = 0.04f;
        private const float MinimumSpeed = 0.25f;
        private const float MinimumSeparationSpeed = 0.10f;
        private double motionWindow = 1.20;
        private float minimumDistance = HandDistance;
        private const double MaximumFrameGap = 0.50;
        internal const float OffAxisRatio = 0.65f;
        private bool initialized;
        private bool finished;
        private double previousTime;
        private double anchorTime;
        private ArmMotionFrame previousFrame;
        private Vector3 previousLeft;
        private Vector3 previousRight;
        private Vector3 anchorLeft;
        private Vector3 anchorRight;
        private Quaternion heading;
        private float leftFrameSpeed;
        private float rightFrameSpeed;

        public ArmMotionPreset SelectedPreset { get; private set; }
        public ArmMotionDiagnostics Diagnostics { get; private set; }

        public void Configure(ArmMotionPreset preset) => Configure(preset,
            preset == ArmMotionPreset.SpreadHands || preset == ArmMotionPreset.CloseHands
                ? SeparationDistance : HandDistance,
            preset == ArmMotionPreset.SpreadHands || preset == ArmMotionPreset.CloseHands ? 2.0 : 1.20);

        public void Configure(ArmMotionPreset preset, float minimumDistanceMeters, double windowSeconds)
        {
            if (!Enum.IsDefined(typeof(ArmMotionPreset), preset))
                throw new ArgumentOutOfRangeException(nameof(preset));
            if (!Finite(minimumDistanceMeters) || minimumDistanceMeters <= 0)
                throw new ArgumentOutOfRangeException(nameof(minimumDistanceMeters));
            if (!Finite(windowSeconds) || windowSeconds <= 0)
                throw new ArgumentOutOfRangeException(nameof(windowSeconds));
            minimumDistance = minimumDistanceMeters;
            motionWindow = windowSeconds;
            SelectedPreset = preset;
            Reset();
        }

        public void Reset(ArmMotionDiagnosticReason reason = ArmMotionDiagnosticReason.Reset)
        {
            initialized = false;
            finished = false;
            leftFrameSpeed = rightFrameSpeed = 0;
            UpdateDiagnostics(ArmMotionPhase.WaitingTrigger, reason, default, 0);
        }

        public bool Start(double timestamp, ArmMotionFrame frame)
        {
            if (initialized || finished) return false;
            if (!Finite(timestamp) || !Valid(frame))
            {
                finished = true;
                UpdateDiagnostics(ArmMotionPhase.WaitingTracking, InvalidReason(timestamp, frame), frame, 0);
                return false;
            }
            Vector3 left = frame.LeftPosition - frame.HeadPosition;
            Vector3 right = frame.RightPosition - frame.HeadPosition;
            initialized = true;
            previousTime = timestamp;
            previousFrame = frame;
            previousLeft = left;
            previousRight = right;
            Anchor(timestamp, frame, left, right);
            UpdateDiagnostics(ArmMotionPhase.Ready, ArmMotionDiagnosticReason.None, frame, 0);
            return true;
        }

        public bool Observe(double timestamp, ArmMotionFrame frame)
        {
            if (!initialized || finished) return false;
            if (!Finite(timestamp) || !Valid(frame))
            {
                finished = true;
                UpdateDiagnostics(ArmMotionPhase.Failed, InvalidReason(timestamp, frame), frame,
                    Finite(timestamp) ? Math.Max(0, timestamp - anchorTime) : 0);
                return false;
            }
            Vector3 left = frame.LeftPosition - frame.HeadPosition;
            Vector3 right = frame.RightPosition - frame.HeadPosition;
            double delta = timestamp - previousTime;
            if (delta <= 0 || delta > MaximumFrameGap ||
                frame.LeftAvailable != previousFrame.LeftAvailable ||
                frame.RightAvailable != previousFrame.RightAvailable)
            {
                ArmMotionDiagnosticReason reason = delta <= 0 ? ArmMotionDiagnosticReason.ClockNotIncreasing
                    : delta > MaximumFrameGap ? ArmMotionDiagnosticReason.FrameGap : ArmMotionDiagnosticReason.TrackingChanged;
                finished = true;
                UpdateDiagnostics(ArmMotionPhase.Failed, reason, frame, Math.Max(0, timestamp - anchorTime));
                return false;
            }
            leftFrameSpeed = frame.LeftAvailable ? (float)((left - previousLeft).magnitude / delta) : 0;
            rightFrameSpeed = frame.RightAvailable ? (float)((right - previousRight).magnitude / delta) : 0;
            previousTime = timestamp;
            previousFrame = frame;
            previousLeft = left;
            previousRight = right;
            double duration = timestamp - anchorTime;
            if (duration > motionWindow)
            {
                finished = true;
                UpdateDiagnostics(ArmMotionPhase.Failed, ArmMotionDiagnosticReason.WindowExpired, frame, duration);
                return false;
            }
            Quaternion inverseHeading = Quaternion.Inverse(heading);
            Vector3 leftDelta = inverseHeading * (left - anchorLeft);
            Vector3 rightDelta = inverseHeading * (right - anchorRight);
            bool matched = IsTwoHandPreset
                ? MatchSeparation(left, right, duration)
                : (frame.LeftAvailable && MatchDirection(leftDelta, duration)) ||
                    (frame.RightAvailable && MatchDirection(rightDelta, duration));
            bool displaced = (frame.LeftAvailable && leftDelta.sqrMagnitude > 0) ||
                (frame.RightAvailable && rightDelta.sqrMagnitude > 0);
            UpdateDiagnostics(matched ? ArmMotionPhase.Matched : displaced ? ArmMotionPhase.Moving : ArmMotionPhase.Ready,
                matched || !displaced ? ArmMotionDiagnosticReason.None
                    : MotionShortfall(frame, leftDelta, rightDelta, left, right, duration), frame, duration);
            finished = matched;
            return matched;
        }

        private ArmMotionDiagnosticReason InvalidReason(double timestamp, ArmMotionFrame frame) =>
            !Finite(timestamp) ? ArmMotionDiagnosticReason.InvalidTimestamp
                : !frame.HeadAvailable ? ArmMotionDiagnosticReason.HeadTrackingUnavailable
                : (IsTwoHandPreset ? !frame.LeftAvailable || !frame.RightAvailable : !frame.LeftAvailable && !frame.RightAvailable)
                    ? ArmMotionDiagnosticReason.HandTrackingUnavailable : ArmMotionDiagnosticReason.InvalidPose;

        private bool IsTwoHandPreset => SelectedPreset == ArmMotionPreset.SpreadHands ||
            SelectedPreset == ArmMotionPreset.CloseHands;

        private float RequiredSpeed => IsTwoHandPreset ? MinimumSeparationSpeed : MinimumSpeed;

        private bool Valid(ArmMotionFrame frame)
        {
            return frame.HeadAvailable && Finite(frame.HeadPosition) && Finite(frame.HeadRotation) &&
                (IsTwoHandPreset ? frame.LeftAvailable && frame.RightAvailable : frame.LeftAvailable || frame.RightAvailable) &&
                (!frame.LeftAvailable || Finite(frame.LeftPosition)) &&
                (!frame.RightAvailable || Finite(frame.RightPosition));
        }

        private void Anchor(double timestamp, ArmMotionFrame frame, Vector3 left, Vector3 right)
        {
            anchorLeft = left;
            anchorRight = right;
            anchorTime = timestamp;
            // The gesture keeps its initial horizontal heading even if the user turns their head.
            Vector3 forward = Vector3.ProjectOnPlane(frame.HeadRotation * Vector3.forward, Vector3.up);
            if (forward.sqrMagnitude < 0.001f)
                forward = Vector3.Cross(frame.HeadRotation * Vector3.right, Vector3.up);
            heading = Quaternion.LookRotation(forward.normalized, Vector3.up);
        }

        private Vector3 Direction
        {
            get
            {
                switch (SelectedPreset)
                {
                    case ArmMotionPreset.SwipeLeft: return Vector3.left;
                    case ArmMotionPreset.SwipeRight: return Vector3.right;
                    case ArmMotionPreset.SwipeDown: return Vector3.down;
                    case ArmMotionPreset.SwipeUp: return Vector3.up;
                    case ArmMotionPreset.PushForward: return Vector3.forward;
                    case ArmMotionPreset.PullBackward: return Vector3.back;
                    default: return Vector3.zero;
                }
            }
        }

        private void UpdateDiagnostics(ArmMotionPhase phase, ArmMotionDiagnosticReason reason,
            ArmMotionFrame frame, double elapsed)
        {
            bool hasAnchor = initialized;
            Vector3 left = frame.LeftPosition - frame.HeadPosition;
            Vector3 right = frame.RightPosition - frame.HeadPosition;
            Quaternion inverseHeading = Quaternion.Inverse(heading);
            Vector3 leftDelta = hasAnchor && frame.LeftAvailable ? inverseHeading * (left - anchorLeft) : Vector3.zero;
            Vector3 rightDelta = hasAnchor && frame.RightAvailable ? inverseHeading * (right - anchorRight) : Vector3.zero;
            float initialSpan = hasAnchor ? (anchorRight - anchorLeft).magnitude : 0;
            float currentSpan = frame.LeftAvailable && frame.RightAvailable && Finite(left) && Finite(right)
                ? (right - left).magnitude : 0;
            float sign = SelectedPreset == ArmMotionPreset.CloseHands ? -1 : 1;
            Vector3 midpoint = (anchorLeft + anchorRight) * 0.5f;
            float leftRadial = hasAnchor && frame.LeftAvailable ? ((left - midpoint).magnitude - (anchorLeft - midpoint).magnitude) * sign : 0;
            float rightRadial = hasAnchor && frame.RightAvailable ? ((right - midpoint).magnitude - (anchorRight - midpoint).magnitude) * sign : 0;
            Diagnostics = new ArmMotionDiagnostics(phase, reason, frame, elapsed,
                motionWindow, minimumDistance, RequiredSpeed, leftFrameSpeed, rightFrameSpeed, leftDelta, rightDelta, Direction, initialSpan, currentSpan,
                hasAnchor ? (currentSpan - initialSpan) * sign : 0, leftRadial, rightRadial);
        }

        private ArmMotionDiagnosticReason MotionShortfall(ArmMotionFrame frame, Vector3 leftDelta,
            Vector3 rightDelta, Vector3 left, Vector3 right, double duration)
        {
            if (!IsTwoHandPreset)
            {
                Vector3 displacement = !frame.LeftAvailable || (frame.RightAvailable &&
                    Vector3.Dot(rightDelta, Direction) > Vector3.Dot(leftDelta, Direction)) ? rightDelta : leftDelta;
                float distance = Vector3.Dot(displacement, Direction);
                if (distance <= 0) return ArmMotionDiagnosticReason.WrongDirection;
                if (distance < minimumDistance) return ArmMotionDiagnosticReason.DistanceTooSmall;
                if (distance / duration < RequiredSpeed) return ArmMotionDiagnosticReason.SpeedTooLow;
                return ArmMotionDiagnosticReason.OffAxis;
            }
            float initialSpan = (anchorRight - anchorLeft).magnitude;
            float currentSpan = (right - left).magnitude;
            bool spread = SelectedPreset == ArmMotionPreset.SpreadHands;
            float distanceChange = (currentSpan - initialSpan) * (spread ? 1 : -1);
            if (distanceChange < minimumDistance) return ArmMotionDiagnosticReason.DistanceTooSmall;
            if (distanceChange / duration < RequiredSpeed) return ArmMotionDiagnosticReason.SpeedTooLow;
            return ArmMotionDiagnosticReason.BothHandsMustMove;
        }

        private bool MatchDirection(Vector3 displacement, double duration)
        {
            Vector3 direction;
            switch (SelectedPreset)
            {
                case ArmMotionPreset.SwipeLeft: direction = Vector3.left; break;
                case ArmMotionPreset.SwipeRight: direction = Vector3.right; break;
                case ArmMotionPreset.SwipeDown: direction = Vector3.down; break;
                case ArmMotionPreset.SwipeUp: direction = Vector3.up; break;
                case ArmMotionPreset.PushForward: direction = Vector3.forward; break;
                case ArmMotionPreset.PullBackward: direction = Vector3.back; break;
                default: return false;
            }
            float distance = Vector3.Dot(displacement, direction);
            Vector3 offAxis = displacement - direction * distance;
            return distance >= minimumDistance && distance / duration >= RequiredSpeed &&
                offAxis.magnitude <= distance * OffAxisRatio;
        }

        private bool MatchSeparation(Vector3 left, Vector3 right, double duration)
        {
            Vector3 initialSeparation = anchorRight - anchorLeft;
            float finalSpan = (right - left).magnitude;
            bool spreading = SelectedPreset == ArmMotionPreset.SpreadHands;
            float sign = spreading ? 1 : -1;
            float distance = (finalSpan - initialSeparation.magnitude) * sign;
            Vector3 initialMidpoint = (anchorLeft + anchorRight) * 0.5f;
            float leftDistance = ((left - initialMidpoint).magnitude -
                (anchorLeft - initialMidpoint).magnitude) * sign;
            float rightDistance = ((right - initialMidpoint).magnitude -
                (anchorRight - initialMidpoint).magnitude) * sign;
            return distance >= minimumDistance && distance / duration >= RequiredSpeed &&
                leftDistance >= EachHandDistance && rightDistance >= EachHandDistance;
        }

        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        private static bool Finite(Vector3 value) => Finite(value.x) && Finite(value.y) && Finite(value.z);
        private static bool Finite(Quaternion value) => Finite(value.x) && Finite(value.y) &&
            Finite(value.z) && Finite(value.w) && Finite(Quaternion.Dot(value, value)) &&
            Math.Abs(Quaternion.Dot(value, value) - 1f) <= 0.01f;
    }
}

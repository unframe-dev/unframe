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

    public sealed class ArmMotionRecognizer
    {
        private const float HandDistance = 0.28f;
        private const float SeparationDistance = 0.30f;
        private const float EachHandDistance = 0.10f;
        private const float MinimumSpeed = 0.25f;
        private const double RestDuration = 0.20;
        private const double MotionWindow = 1.20;
        private const double MaximumFrameGap = 0.50;
        private const float RestSpeed = 0.12f;
        private bool initialized;
        private bool armed;
        private bool moving;
        private double previousTime;
        private double restSince;
        private double anchorTime;
        private ArmMotionFrame previousFrame;
        private Vector3 previousLeft;
        private Vector3 previousRight;
        private Vector3 anchorLeft;
        private Vector3 anchorRight;
        private Quaternion heading;

        public ArmMotionPreset SelectedPreset { get; private set; }

        public void Configure(ArmMotionPreset preset)
        {
            if (!Enum.IsDefined(typeof(ArmMotionPreset), preset))
                throw new ArgumentOutOfRangeException(nameof(preset));
            SelectedPreset = preset;
            Reset();
        }

        public void Reset()
        {
            initialized = false;
            armed = false;
            moving = false;
        }

        public bool Observe(double timestamp, ArmMotionFrame frame)
        {
            if (!Finite(timestamp) || !Valid(frame))
            {
                Reset();
                return false;
            }
            Vector3 left = frame.LeftPosition - frame.HeadPosition;
            Vector3 right = frame.RightPosition - frame.HeadPosition;
            if (!initialized)
            {
                Begin(timestamp, frame, left, right);
                return false;
            }
            double delta = timestamp - previousTime;
            if (delta <= 0 || delta > MaximumFrameGap ||
                frame.LeftAvailable != previousFrame.LeftAvailable ||
                frame.RightAvailable != previousFrame.RightAvailable)
            {
                Reset();
                Begin(timestamp, frame, left, right);
                return false;
            }
            bool still = (!frame.LeftAvailable || (left - previousLeft).magnitude <= RestSpeed * delta) &&
                (!frame.RightAvailable || (right - previousRight).magnitude <= RestSpeed * delta);
            previousTime = timestamp;
            previousFrame = frame;
            previousLeft = left;
            previousRight = right;
            if (!armed)
            {
                if (!still) restSince = timestamp;
                if (still && timestamp - restSince >= RestDuration)
                {
                    armed = true;
                    Anchor(timestamp, frame, left, right);
                }
                return false;
            }
            if (!moving && still)
            {
                Anchor(timestamp, frame, left, right);
                return false;
            }
            moving = true;
            double duration = timestamp - anchorTime;
            if (duration > MotionWindow)
            {
                armed = false;
                moving = false;
                restSince = timestamp;
                return false;
            }
            Quaternion inverseHeading = Quaternion.Inverse(heading);
            Vector3 leftDelta = inverseHeading * (left - anchorLeft);
            Vector3 rightDelta = inverseHeading * (right - anchorRight);
            bool matched = IsTwoHandPreset
                ? MatchSeparation(left, right, duration)
                : (frame.LeftAvailable && MatchDirection(leftDelta, duration)) ||
                    (frame.RightAvailable && MatchDirection(rightDelta, duration));
            if (!matched) return false;
            armed = false;
            moving = false;
            restSince = timestamp;
            return true;
        }

        private bool IsTwoHandPreset => SelectedPreset == ArmMotionPreset.SpreadHands ||
            SelectedPreset == ArmMotionPreset.CloseHands;

        private bool Valid(ArmMotionFrame frame)
        {
            return frame.HeadAvailable && Finite(frame.HeadPosition) && Finite(frame.HeadRotation) &&
                (IsTwoHandPreset ? frame.LeftAvailable && frame.RightAvailable : frame.LeftAvailable || frame.RightAvailable) &&
                (!frame.LeftAvailable || Finite(frame.LeftPosition)) &&
                (!frame.RightAvailable || Finite(frame.RightPosition));
        }

        private void Begin(double timestamp, ArmMotionFrame frame, Vector3 left, Vector3 right)
        {
            initialized = true;
            armed = false;
            moving = false;
            previousTime = timestamp;
            restSince = timestamp;
            previousFrame = frame;
            previousLeft = left;
            previousRight = right;
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
            return distance >= HandDistance && distance / duration >= MinimumSpeed &&
                offAxis.magnitude <= distance * 0.65f;
        }

        private bool MatchSeparation(Vector3 left, Vector3 right, double duration)
        {
            Vector3 initialSeparation = anchorRight - anchorLeft;
            float finalSpan = (right - left).magnitude;
            bool spreading = SelectedPreset == ArmMotionPreset.SpreadHands;
            if (spreading ? initialSeparation.magnitude > 0.50f || finalSpan < 0.60f
                : initialSeparation.magnitude < 0.60f || finalSpan > 0.50f) return false;
            float sign = spreading ? 1 : -1;
            float distance = (finalSpan - initialSeparation.magnitude) * sign;
            Vector3 initialMidpoint = (anchorLeft + anchorRight) * 0.5f;
            float leftDistance = ((left - initialMidpoint).magnitude -
                (anchorLeft - initialMidpoint).magnitude) * sign;
            float rightDistance = ((right - initialMidpoint).magnitude -
                (anchorRight - initialMidpoint).magnitude) * sign;
            return distance >= SeparationDistance && distance / duration >= MinimumSpeed &&
                leftDistance >= EachHandDistance && rightDistance >= EachHandDistance;
        }

        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        private static bool Finite(Vector3 value) => Finite(value.x) && Finite(value.y) && Finite(value.z);
        private static bool Finite(Quaternion value) => Finite(value.x) && Finite(value.y) &&
            Finite(value.z) && Finite(value.w) && Finite(Quaternion.Dot(value, value)) &&
            Math.Abs(Quaternion.Dot(value, value) - 1f) <= 0.01f;
    }
}

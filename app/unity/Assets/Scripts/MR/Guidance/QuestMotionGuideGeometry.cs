using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public readonly struct QuestMotionGuideArmPose
    {
        public QuestMotionGuideArmPose(Vector3 shoulder, Vector3 elbow, Vector3 wrist)
        { Shoulder = shoulder; Elbow = elbow; Wrist = wrist; }
        public Vector3 Shoulder { get; }
        public Vector3 Elbow { get; }
        public Vector3 Wrist { get; }
    }

    public static class QuestMotionGuideGeometry
    {
        public const float UpperArmLength = .25f;
        public const float ForearmLength = .25f;

        public static float MotionProgress(float phase)
        {
            phase = Mathf.Clamp01(phase);
            if (phase <= .15f) return 0;
            if (phase < .55f) return Mathf.SmoothStep(0, 1, (phase - .15f) / .4f);
            if (phase <= .65f) return 1;
            if (phase < .95f) return Mathf.SmoothStep(1, 0, (phase - .65f) / .3f);
            return 0;
        }

        public static void HandPath(int preset, double minimumDistance, bool bothHands, bool leftHand,
            Vector3 origin, Vector3 forward, Vector3 right, out Vector3 start, out Vector3 end)
        {
            Diagram(preset, minimumDistance, out float startHalf, out float endHalf, out float scale);
            Vector3 side = leftHand ? -right : right;
            start = origin + (bothHands ? side * startHalf * scale : Vector3.zero);
            end = bothHands ? origin + side * endHalf * scale
                : start + Direction(preset, forward, right, leftHand) * endHalf * scale;
        }

        public static QuestMotionGuideArmPose ArmPose(int preset, double minimumDistance, bool bothHands, bool leftHand,
            Vector3 origin, Vector3 forward, Vector3 right, float progress)
        {
            HandPath(preset, minimumDistance, bothHands, leftHand, origin, forward, right, out Vector3 start, out Vector3 end);
            Vector3 side = leftHand ? -right : right;
            Vector3 shoulderOffset = Vector3.up * .18f - forward * .25f;
            Vector3 shoulder = (bothHands ? origin + side * .12f : (start + end) * .5f + side * .16f) + shoulderOffset;
            float opening = preset == 8 ? 1 - Mathf.Clamp01(progress) : Mathf.Clamp01(progress);
            Vector3 wrist = Vector3.Lerp(start, end, Mathf.Clamp01(progress));
            if (bothHands)
            {
                // The diagram demonstrates elbow extension; real separation requirements remain in the instruction text.
                float squaredLengths = UpperArmLength * UpperArmLength + ForearmLength * ForearmLength;
                float lengthProduct = 2 * UpperArmLength * ForearmLength;
                float foldedReach = Mathf.Sqrt(Mathf.Max(0, squaredLengths - lengthProduct * Mathf.Cos(80 * Mathf.Deg2Rad) - shoulderOffset.sqrMagnitude));
                float extendedReach = Mathf.Sqrt(Mathf.Max(0, squaredLengths - lengthProduct * Mathf.Cos(170 * Mathf.Deg2Rad) - shoulderOffset.sqrMagnitude));
                float halfChord = (extendedReach - foldedReach) * .5f;
                const float arcDepth = .06f;
                float radius = (halfChord * halfChord + arcDepth * arcDepth) / (2 * arcDepth);
                float halfAngle = Mathf.Asin(halfChord / radius);
                float angle = Mathf.Lerp(-halfAngle, halfAngle, opening);
                float outwardReach = (foldedReach + extendedReach) * .5f + radius * Mathf.Sin(angle);
                float verticalArc = radius * (Mathf.Cos(halfAngle) - Mathf.Cos(angle));
                wrist = shoulder - shoulderOffset + side * outwardReach + Vector3.up * verticalArc;
            }
            Vector3 toWrist = wrist - shoulder;
            float distance = toWrist.magnitude;
            Vector3 axis = toWrist / distance;
            float along = (UpperArmLength * UpperArmLength - ForearmLength * ForearmLength + distance * distance) / (2 * distance);
            float height = Mathf.Sqrt(Mathf.Max(0, UpperArmLength * UpperArmLength - along * along));
            // Delay the elbow swing so the forearm remains visible during the hand's arc.
            float outwardBend = Mathf.Lerp(bothHands ? -.5f : -.8f, 2, opening * opening);
            Vector3 bend = Vector3.ProjectOnPlane(side * outwardBend - Vector3.up, axis).normalized;
            return new QuestMotionGuideArmPose(shoulder, shoulder + axis * along + bend * height, wrist);
        }

        public static void GetFrame(Quaternion headRotation, out Vector3 forward, out Vector3 right)
        {
            forward = Vector3.ProjectOnPlane(headRotation * Vector3.forward, Vector3.up);
            if (forward.sqrMagnitude < .001f)
            {
                Vector3 headRight = headRotation * Vector3.right;
                forward = new Vector3(-headRight.z, 0, headRight.x);
            }
            forward.Normalize();
            right = Vector3.Cross(Vector3.up, forward).normalized;
        }

        public static bool NeedsReframe(Vector3 frozenForward, Vector3 currentForward) => Vector3.Dot(frozenForward, currentForward) < .94f;

        public static Vector3 Direction(int preset, Vector3 forward, Vector3 right, bool leftHand)
        {
            switch (preset)
            {
                case 1: return -right;
                case 2: return right;
                case 3: return Vector3.down;
                case 4: return Vector3.up;
                case 5: return forward;
                case 6: return -forward;
                case 7: return leftHand ? -right : right;
                case 8: return leftHand ? right : -right;
                default: return Vector3.zero;
            }
        }

        public static void Diagram(int preset, double minimumDistance, out float startHalfSpan, out float endHalfSpan, out float scale)
        {
            float minimum = (float)minimumDistance;
            if (preset == 7)
            {
                startHalfSpan = .15f;
                endHalfSpan = Mathf.Max(.35f, (.3f + minimum) * .5f);
            }
            else if (preset == 8)
            {
                startHalfSpan = Mathf.Max(.35f, (.3f + minimum) * .5f);
                endHalfSpan = .15f;
            }
            else
            {
                startHalfSpan = 0;
                endHalfSpan = minimum;
            }
            scale = preset >= 7 ? Mathf.Min(1, .7f / (2 * Mathf.Max(startHalfSpan, endHalfSpan))) : Mathf.Min(1, .35f / minimum);
        }

    }
}

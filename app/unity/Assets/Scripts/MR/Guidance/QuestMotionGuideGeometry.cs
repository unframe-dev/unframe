using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public static class QuestMotionGuideGeometry
    {
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

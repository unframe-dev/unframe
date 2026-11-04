using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public static class QuestMotionGuideGeometry
    {
        public const float DisplayScale = .10f;
        public const float Distance = .50f;

        public static Quaternion GetYawRotation(Quaternion headRotation)
        {
            GetFrame(headRotation, out Vector3 forward, out _);
            return Quaternion.LookRotation(forward, Vector3.up);
        }

        public static Vector3 GetAnchorPosition(Vector3 headPosition, Quaternion headRotation, float verticalFov, float aspect) =>
            GetPeripheralPosition(headPosition, headRotation, verticalFov, aspect, 1);

        public static Vector3 GetHudPosition(Vector3 headPosition, Quaternion headRotation, float verticalFov, float aspect) =>
            GetPeripheralPosition(headPosition, headRotation, verticalFov, aspect, -1);

        private static Vector3 GetPeripheralPosition(Vector3 headPosition, Quaternion headRotation, float verticalFov, float aspect, float side)
        {
            float halfHeight = Mathf.Tan(verticalFov * .5f * Mathf.Deg2Rad);
            Vector3 direction = new Vector3(side * .62f * halfHeight * aspect, -.58f * halfHeight, 1).normalized;
            return headPosition + GetYawRotation(headRotation) * direction * Distance;
        }

        public static Vector3 GetInstructionPosition(Vector3 anchor, Quaternion headRotation) =>
            anchor + Vector3.up * .055f;

        public static Quaternion GetFacingRotation(Vector3 panelPosition, Vector3 headPosition, Quaternion headRotation)
        {
            Vector3 forward = panelPosition - headPosition;
            return forward.sqrMagnitude < .000001f
                ? headRotation : Quaternion.LookRotation(forward, headRotation * Vector3.up);
        }

        public static float GetViewportScale(float verticalFov, float aspect) =>
            Mathf.Min(1, Mathf.Tan(verticalFov * .5f * Mathf.Deg2Rad) * Mathf.Min(1, aspect) / Mathf.Tan(40 * Mathf.Deg2Rad));

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

    }
}

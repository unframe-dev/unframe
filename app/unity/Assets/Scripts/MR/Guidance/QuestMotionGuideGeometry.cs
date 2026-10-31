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

    }
}

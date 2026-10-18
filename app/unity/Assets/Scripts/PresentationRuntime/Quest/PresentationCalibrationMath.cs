using System;
using UnityEngine;
using ProtoPose = Unframe.Presentation.Pose;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationCalibrationMath
    {
        public static bool TryFromWorldOrigin(Pose worldFromPresentation, Transform questTrackingOrigin,
            out ProtoPose presentationFromQuestLocal, out string error)
        {
            presentationFromQuestLocal = null;
            error = "calibration-world-pose-invalid";
            if (!ValidPose(worldFromPresentation) || !TryTrackingOrigin(questTrackingOrigin, out Pose worldFromQuestLocal)) return false;
            Quaternion inverse = Quaternion.Inverse(worldFromPresentation.rotation);
            Vector3 position = inverse * (worldFromQuestLocal.position - worldFromPresentation.position);
            Quaternion rotation = inverse * worldFromQuestLocal.rotation;
            if (!ValidPose(new Pose(position, rotation))) return false;
            presentationFromQuestLocal = QuestPresentationTracking.ToCanonicalPose(position, rotation);
            error = null;
            return true;
        }

        public static bool TryWorldFromPresentation(ProtoPose presentationFromQuestLocal, Transform questTrackingOrigin,
            out Pose worldFromPresentation, out string error)
        {
            worldFromPresentation = default;
            error = "calibration-world-pose-invalid";
            if (!PresentationCalibrationState.IsCanonical(presentationFromQuestLocal)
                || !PresentationCoordinateAdapter.TryToUnityPose(presentationFromQuestLocal, out Pose calibration)
                || !TryTrackingOrigin(questTrackingOrigin, out Pose worldFromQuestLocal)) return false;
            Quaternion inverse = Quaternion.Inverse(calibration.rotation);
            Quaternion rotation = worldFromQuestLocal.rotation * inverse;
            Vector3 position = worldFromQuestLocal.position - rotation * calibration.position;
            Pose result = new Pose(position, rotation);
            if (!ValidPose(result)) return false;
            worldFromPresentation = result;
            error = null;
            return true;
        }

        private static bool TryTrackingOrigin(Transform origin, out Pose pose)
        {
            pose = default;
            if (origin == null || !origin.gameObject.activeInHierarchy) return false;
            // Parent scale can introduce shear even when the resulting lossyScale looks unit.
            for (Transform current = origin; current != null; current = current.parent)
            {
                Vector3 scale = current.localScale;
                if (scale.x != 1 || scale.y != 1 || scale.z != 1) return false;
            }
            pose = new Pose(origin.position, origin.rotation);
            return ValidPose(pose);
        }

        private static bool ValidPose(Pose pose)
        {
            Vector3 p = pose.position;
            Quaternion q = pose.rotation;
            if (!Finite(p.x) || !Finite(p.y) || !Finite(p.z) || !Finite(q.x) || !Finite(q.y) || !Finite(q.z) || !Finite(q.w)) return false;
            double norm = (double)q.x * q.x + (double)q.y * q.y + (double)q.z * q.z + (double)q.w * q.w;
            return Math.Abs(norm - 1) <= 0.00001;
        }

        private static bool Finite(float value) => !Single.IsNaN(value) && !Single.IsInfinity(value);
    }
}

using UnityEngine;
using UnityEngine.XR.OpenXR;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestBodyTrackingSource : MonoBehaviour, IQuestBodyPoseSource
    {
        public bool TryGetQuestLocalPose(out Vector3 position, out Quaternion rotation)
        {
            QuestBodyTrackingFeature feature = OpenXRSettings.Instance?.GetFeature<QuestBodyTrackingFeature>();
            if (feature != null) return feature.TryGetHipPose(out position, out rotation);
            position = default;
            rotation = default;
            return false;
        }
    }
}

using Unframe.Presentation.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationSurfaceMetadata : MonoBehaviour
    {
        [SerializeField] private string surfaceId;
        [SerializeField] private string hostNodeId;

        public string SurfaceId { get { return surfaceId; } }
        public string HostNodeId { get { return hostNodeId; } }

        public void Initialize(ProjectedSurfaceDefinition definition)
        {
            surfaceId = definition.SurfaceId;
            hostNodeId = definition.HostNodeId;
        }
    }
}

using Unframe.Presentation.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    [DisallowMultipleComponent]
    public sealed class PresentationNodeMetadata : MonoBehaviour
    {
        [SerializeField] private string nodeId;
        [SerializeField] private string semanticSurfaceId;
        [SerializeField] private string modelAssetId;

        public string NodeId { get { return nodeId; } }
        public string SemanticSurfaceId { get { return semanticSurfaceId; } }
        public string ModelAssetId { get { return modelAssetId; } }
        public ProjectedNodeDefinition.NodeOneofCase NodeKind { get; private set; }

        public void Initialize(ProjectedNodeDefinition definition)
        {
            nodeId = definition.NodeId;
            NodeKind = definition.NodeCase;
            semanticSurfaceId = definition.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Surface ? definition.Surface.SemanticSurfaceId : null;
            modelAssetId = definition.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model ? definition.Model.ModelAssetId : null;
        }
    }
}

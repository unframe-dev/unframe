using System.Collections.Generic;
using UnityEngine;
using Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationNodeRegistry
    {
        private readonly Dictionary<string, GameObject> nodes = new Dictionary<string, GameObject>();
        private readonly Dictionary<string, (GameObject Object, PresenterAnchorParent Definition)> anchorParents = new Dictionary<string, (GameObject, PresenterAnchorParent)>();

        public bool TryGet(string nodeId, out GameObject nodeObject)
        {
            return nodes.TryGetValue(nodeId, out nodeObject);
        }

        internal IEnumerable<KeyValuePair<string, (GameObject Object, PresenterAnchorParent Definition)>> AnchorParents => anchorParents;

        public void Clear()
        {
            foreach (GameObject nodeObject in nodes.Values)
            {
                if (nodeObject != null)
                {
                    if (Application.isPlaying)
                    {
                        UnityEngine.Object.Destroy(nodeObject);
                    }
                    else
                    {
                        UnityEngine.Object.DestroyImmediate(nodeObject);
                    }
                }
            }

            nodes.Clear();
            anchorParents.Clear();
        }

        internal void Register(string nodeId, GameObject nodeObject)
        {
            nodes.Add(nodeId, nodeObject);
        }

        internal void RegisterAnchor(string nodeId, GameObject anchorParent, PresenterAnchorParent definition)
        {
            anchorParents.Add(nodeId, (anchorParent, definition));
        }
    }
}

using System.Collections.Generic;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationNodeRegistry
    {
        private readonly Dictionary<string, GameObject> nodes = new Dictionary<string, GameObject>();

        public bool TryGet(string nodeId, out GameObject nodeObject)
        {
            return nodes.TryGetValue(nodeId, out nodeObject);
        }

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
        }

        internal void Register(string nodeId, GameObject nodeObject)
        {
            nodes.Add(nodeId, nodeObject);
        }
    }
}

using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Owns the generated hierarchy for one Delivery and atomically replaces it after a successful rebuild.
    /// </summary>
    public sealed class PresentationNodeHierarchy
    {
        private readonly PresentationNodeFactory factory = new PresentationNodeFactory();
        private Transform generatedRoot;

        public PresentationNodeRegistry Registry { get; private set; }

        public bool TryReplace(PresentationRuntimeDataStore store, Transform root, out string error)
        {
            Transform nextRoot = new GameObject("Presentation Nodes").transform;
            nextRoot.SetParent(root, false);
            nextRoot.gameObject.SetActive(false);
            if (!factory.TryBuild(store, nextRoot, out PresentationNodeRegistry next, out error))
            {
                DestroyRoot(nextRoot);
                return false;
            }

            DestroyRoot(generatedRoot);
            generatedRoot = nextRoot;
            generatedRoot.gameObject.SetActive(true);
            Registry = next;
            return true;
        }

        public void Clear()
        {
            DestroyRoot(generatedRoot);
            generatedRoot = null;
            Registry = null;
        }

        private static void DestroyRoot(Transform root)
        {
            if (root == null)
            {
                return;
            }

            root.gameObject.SetActive(false);
            if (Application.isPlaying)
            {
                Object.Destroy(root.gameObject);
            }
            else
            {
                Object.DestroyImmediate(root.gameObject);
            }
        }
    }
}

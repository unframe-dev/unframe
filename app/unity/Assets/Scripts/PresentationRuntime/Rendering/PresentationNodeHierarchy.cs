using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Owns the generated hierarchy for one projected catalog and atomically replaces it after a successful rebuild.
    /// </summary>
    public sealed class PresentationNodeHierarchy
    {
        private readonly PresentationNodeFactory factory = new PresentationNodeFactory();
        private Transform generatedRoot;

        public PresentationNodeRegistry Registry { get; private set; }

        public bool TryReplace(IPresentationRenderView view, Transform root, out string error)
        {
            Transform nextRoot = new GameObject("Presentation Nodes").transform;
            nextRoot.SetParent(root, false);
            nextRoot.gameObject.SetActive(false);
            if (!factory.TryBuild(view, nextRoot, out PresentationNodeRegistry next, out error))
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

        public void ApplyOrigin(Unframe.Presentation.Pose origin)
        {
            if (generatedRoot == null || origin == null) return;
            generatedRoot.localPosition = PresentationUnityCoordinates.Position(origin.Position);
            generatedRoot.localRotation = PresentationUnityCoordinates.Rotation(origin.Rotation);
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

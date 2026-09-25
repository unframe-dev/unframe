using System;
using System.Collections.Generic;
using Unframe.Delivery.V2;
using Unframe.Presentation.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Local-only projection of contract nodes using Unity primitives and builtin text.
    /// </summary>
    public sealed class LocalPresentationPlaceholderRenderer
    {
        private sealed class SurfacePlaceholder
        {
            public string SemanticSurfaceId;
            public UnityEngine.Transform Root;
            public readonly List<GameObject> TextObjects = new List<GameObject>();
        }

        private readonly List<GameObject> roots = new List<GameObject>();
        private readonly Dictionary<string, SurfacePlaceholder> surfaces = new Dictionary<string, SurfacePlaceholder>();

        public void Render(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy)
        {
            Clear();
            if (store == null || hierarchy == null || hierarchy.Registry == null)
            {
                return;
            }

            foreach (ProjectedNodeDefinition definition in store.Nodes)
            {
                if (!hierarchy.Registry.TryGet(definition.NodeId, out GameObject nodeObject))
                {
                    continue;
                }

                switch (definition.NodeCase)
                {
                    case ProjectedNodeDefinition.NodeOneofCase.Model:
                        CreateCube(nodeObject.transform, "Model Placeholder", new UnityEngine.Vector3(1f, 1f, 1f));
                        break;
                    case ProjectedNodeDefinition.NodeOneofCase.Shape:
                        CreateShape(nodeObject.transform, definition.Shape);
                        break;
                    case ProjectedNodeDefinition.NodeOneofCase.Surface:
                        CreateSurface(store, nodeObject.transform, definition.NodeId, definition.Surface.SemanticSurfaceId);
                        break;
                }
            }
        }

        public void RefreshSurfaces(PresentationRuntimeDataStore store)
        {
            if (store == null)
            {
                return;
            }

            foreach (SurfacePlaceholder surface in surfaces.Values)
            {
                foreach (GameObject textObject in surface.TextObjects)
                {
                    DestroyObject(textObject);
                }

                surface.TextObjects.Clear();
                int index = 0;
                foreach (string text in ResolveLiteralText(store, surface.SemanticSurfaceId))
                {
                    surface.TextObjects.Add(CreateText(surface.Root, text, index++));
                }
            }
        }

        public void Clear()
        {
            foreach (GameObject root in roots)
            {
                if (root == null)
                {
                    continue;
                }

                if (Application.isPlaying)
                {
                    UnityEngine.Object.Destroy(root);
                }
                else
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }

            roots.Clear();
            surfaces.Clear();
        }

        private void CreateSurface(PresentationRuntimeDataStore store, UnityEngine.Transform parent, string nodeId, string semanticSurfaceId)
        {
            GameObject root = CreateRoot(parent, "Surface Placeholder");
            SurfacePlaceholder surface = new SurfacePlaceholder { SemanticSurfaceId = semanticSurfaceId, Root = root.transform };
            surfaces.Add(nodeId, surface);
            int index = 0;
            foreach (string text in ResolveLiteralText(store, semanticSurfaceId))
            {
                surface.TextObjects.Add(CreateText(root.transform, text, index++));
            }
        }

        private static IEnumerable<string> ResolveLiteralText(PresentationRuntimeDataStore store, string semanticSurfaceId)
        {
            foreach (DeliveredRenderSurface surface in store.Delivery.ProjectionProfile.RenderSurfaces)
            {
                if (surface.SemanticSurfaceId != semanticSurfaceId)
                {
                    continue;
                }

                string stateId = FindCurrentState(store, semanticSurfaceId);
                string artifactId = FindArtifactId(surface, stateId);
                foreach (DeliveredArtifact artifact in surface.Artifacts)
                {
                    if (artifact.ArtifactCase != DeliveredArtifact.ArtifactOneofCase.NativeUi || artifact.NativeUi.ArtifactId != artifactId)
                    {
                        continue;
                    }

                    foreach (NativeUiNode node in artifact.NativeUi.Nodes)
                    {
                        if (node.NodeCase == NativeUiNode.NodeOneofCase.Text
                            && node.Text.Value != null
                            && node.Text.Value.SourceCase == NativeTextValue.SourceOneofCase.Literal)
                        {
                            yield return node.Text.Value.Literal.Value;
                        }
                    }
                }
            }
        }

        private static string FindCurrentState(PresentationRuntimeDataStore store, string semanticSurfaceId)
        {
            foreach (ProjectedSurfaceDefinition surface in store.Delivery.ProjectionProfile.RuntimeCatalog.Surfaces)
            {
                if (store.TryGetNode(surface.HostNodeId, out ProjectedNodeDefinition node)
                    && node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Surface
                    && node.Surface.SemanticSurfaceId == semanticSurfaceId
                    && store.TryGetSurfaceState(surface.SurfaceId, out Unframe.Realtime.V2.SurfaceRuntimeState state))
                {
                    return state.StateId;
                }
            }

            return null;
        }

        private static string FindArtifactId(DeliveredRenderSurface surface, string stateId)
        {
            foreach (DeliveredStateBinding binding in surface.StateBindings)
            {
                if (binding.StateId == stateId && binding.BindingCase == DeliveredStateBinding.BindingOneofCase.Artifact)
                {
                    return binding.Artifact.ArtifactId;
                }
            }

            return null;
        }

        private void CreateShape(UnityEngine.Transform parent, ShapeNode shape)
        {
            PrimitiveType type = shape != null && shape.GeometryCase == ShapeNode.GeometryOneofCase.Sphere ? PrimitiveType.Sphere : PrimitiveType.Cube;
            UnityEngine.Vector3 scale = UnityEngine.Vector3.one;
            if (shape != null && shape.GeometryCase == ShapeNode.GeometryOneofCase.Box && shape.Box.Size != null)
            {
                scale = new UnityEngine.Vector3((float)shape.Box.Size.X, (float)shape.Box.Size.Y, (float)shape.Box.Size.Z);
            }
            else if (shape != null && shape.GeometryCase == ShapeNode.GeometryOneofCase.Sphere)
            {
                float diameter = (float)(shape.Sphere.Radius * 2d);
                scale = UnityEngine.Vector3.one * diameter;
            }

            CreatePrimitive(parent, "Shape Placeholder", type, scale);
        }

        private void CreateCube(UnityEngine.Transform parent, string name, UnityEngine.Vector3 scale)
        {
            CreatePrimitive(parent, name, PrimitiveType.Cube, scale);
        }

        private void CreatePrimitive(UnityEngine.Transform parent, string name, PrimitiveType type, UnityEngine.Vector3 scale)
        {
            GameObject nodeObject = GameObject.CreatePrimitive(type);
            nodeObject.name = name;
            nodeObject.transform.SetParent(parent, false);
            nodeObject.transform.localScale = scale;
            RemoveCollider(nodeObject);
        }

        private static GameObject CreateText(UnityEngine.Transform parent, string value, int index)
        {
            GameObject textObject = new GameObject("Text " + index);
            textObject.transform.SetParent(parent, false);
            textObject.transform.localPosition = new UnityEngine.Vector3(0f, 0.35f - index * 0.35f, -0.06f);
            TextMesh text = textObject.AddComponent<TextMesh>();
            text.text = value;
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = 64;
            text.characterSize = 0.07f;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            return textObject;
        }

        private GameObject CreateRoot(UnityEngine.Transform parent, string name)
        {
            GameObject root = new GameObject(name);
            root.transform.SetParent(parent, false);
            roots.Add(root);
            return root;
        }

        private static void RemoveCollider(GameObject nodeObject)
        {
            Collider collider = nodeObject.GetComponent<Collider>();
            if (Application.isPlaying)
            {
                UnityEngine.Object.Destroy(collider);
            }
            else
            {
                UnityEngine.Object.DestroyImmediate(collider);
            }
        }

        private static void DestroyObject(GameObject target)
        {
            if (Application.isPlaying)
            {
                UnityEngine.Object.Destroy(target);
            }
            else
            {
                UnityEngine.Object.DestroyImmediate(target);
            }
        }
    }
}

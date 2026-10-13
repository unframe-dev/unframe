using System;
using System.Collections.Generic;
using Unframe.Delivery;
using Unframe.Presentation;
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

            foreach (KeyValuePair<string, SurfacePlaceholder> entry in surfaces)
            {
                SurfacePlaceholder surface = entry.Value;
                bool visible = true;
                float opacity = 1f;
                Renderer previousRenderer = surface.TextObjects.Count > 0 && surface.TextObjects[0] != null
                    ? surface.TextObjects[0].GetComponent<Renderer>()
                    : null;
                if (previousRenderer != null)
                {
                    visible = previousRenderer.enabled;
                    opacity = previousRenderer.GetComponent<PresentationVisualOpacity>()?.Opacity ?? 1f;
                }
                else if (store.TryGetNodeState(entry.Key, out Unframe.Realtime.NodeRuntimeState state))
                {
                    visible = state.Visible;
                    opacity = (float)state.Opacity;
                }

                foreach (GameObject textObject in surface.TextObjects)
                {
                    DestroyObject(textObject);
                }

                surface.TextObjects.Clear();
                int index = 0;
                foreach (TextLayout layout in ResolveLiteralText(store, surface.SemanticSurfaceId))
                {
                    GameObject textObject = CreateText(surface.Root, layout.Text, layout.SurfaceBounds, index++);
                    textObject.GetComponent<Renderer>().enabled = visible;
                    PresentationVisualOpacity.Apply(textObject, opacity);
                    surface.TextObjects.Add(textObject);
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
            foreach (TextLayout layout in ResolveLiteralText(store, semanticSurfaceId))
            {
                surface.TextObjects.Add(CreateText(root.transform, layout.Text, layout.SurfaceBounds, index++));
            }
        }

        private readonly struct TextLayout
        {
            public TextLayout(NativeUiText text, LogicalBounds surfaceBounds)
            {
                Text = text;
                SurfaceBounds = surfaceBounds;
            }

            public NativeUiText Text { get; }
            public LogicalBounds SurfaceBounds { get; }
        }

        private static IEnumerable<TextLayout> ResolveLiteralText(PresentationRuntimeDataStore store, string semanticSurfaceId)
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
                            yield return new TextLayout(node.Text, surface.LogicalBounds);
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
                    && store.TryGetSurfaceState(surface.SurfaceId, out Unframe.Realtime.SurfaceRuntimeState state))
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

            CreatePrimitive(parent, "Shape Placeholder", type, scale, shape.Material);
        }

        private void CreateCube(UnityEngine.Transform parent, string name, UnityEngine.Vector3 scale)
        {
            CreatePrimitive(parent, name, PrimitiveType.Cube, scale);
        }

        private void CreatePrimitive(UnityEngine.Transform parent, string name, PrimitiveType type, UnityEngine.Vector3 scale,
            UnlitShapeMaterial material = null)
        {
            GameObject nodeObject = GameObject.CreatePrimitive(type);
            nodeObject.name = name;
            nodeObject.transform.SetParent(parent, false);
            nodeObject.transform.localScale = scale;
            RemoveCollider(nodeObject);
            Color color = material == null ? Color.white : PresentationUnlitMaterial.FromSrgba(
                material.Color.Red, material.Color.Green, material.Color.Blue, material.Color.Alpha);
            PresentationUnlitMaterial.Assign(nodeObject.GetComponent<Renderer>(), color,
                doubleSided: material != null && material.DoubleSided);
        }

        private static GameObject CreateText(UnityEngine.Transform parent, NativeUiText value, LogicalBounds surfaceBounds, int index)
        {
            GameObject textObject = new GameObject("Text " + index);
            textObject.transform.SetParent(parent, false);
            textObject.transform.localPosition = new UnityEngine.Vector3(0f, 0.35f - index * 0.35f, -0.06f);
            TextMesh text = textObject.AddComponent<TextMesh>();
            text.text = value.Value.Literal.Value;
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = 64;
            text.characterSize = 0.07f * (value.FontSize > 0 ? (float)value.FontSize / 20f : 1f);
            text.lineSpacing = value.FontSize > 0 && value.LineHeight > 0
                ? (float)(value.LineHeight / value.FontSize) : 1f;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = value.Align == NativeTextAlign.Start ? TextAlignment.Left
                : value.Align == NativeTextAlign.End ? TextAlignment.Right : TextAlignment.Center;
            FitText(text, value.Bounds, surfaceBounds);
            Color color = PresentationUnlitMaterial.FromSrgba(value.Color.Red, value.Color.Green, value.Color.Blue, value.Color.Alpha);
            Renderer renderer = text.GetComponent<Renderer>();
            PresentationUnlitMaterial.Assign(renderer, color, text.font.material.mainTexture, doubleSided: true, alphaMask: true);
            // Transparent panels otherwise cover lower text when their centers sort closer to the viewer.
            renderer.sortingOrder = 1;
            return textObject;
        }

        private static void FitText(TextMesh text, LogicalBounds bounds, LogicalBounds surfaceBounds)
        {
            if (bounds == null || surfaceBounds == null || bounds.Width <= 0 || bounds.Height <= 0
                || surfaceBounds.Width <= 0 || surfaceBounds.Height <= 0)
            {
                return;
            }

            float left = (float)Math.Max(bounds.X, surfaceBounds.X);
            float top = (float)Math.Max(bounds.Y, surfaceBounds.Y);
            float right = (float)Math.Min(bounds.X + bounds.Width, surfaceBounds.X + surfaceBounds.Width);
            float bottom = (float)Math.Min(bounds.Y + bounds.Height, surfaceBounds.Y + surfaceBounds.Height);
            float width = right - left;
            float height = bottom - top;
            if (width <= 0f || height <= 0f)
            {
                text.text = string.Empty;
                return;
            }

            Renderer renderer = text.GetComponent<Renderer>();
            string original = text.text;
            var lines = new List<string>();
            foreach (string paragraph in original.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
            {
                string line = string.Empty;
                System.Globalization.TextElementEnumerator elements = System.Globalization.StringInfo.GetTextElementEnumerator(paragraph);
                while (elements.MoveNext())
                {
                    string element = elements.GetTextElement();
                    text.text = line + element;
                    if (line.Length > 0 && renderer.localBounds.size.x > width)
                    {
                        lines.Add(line);
                        line = element;
                    }
                    else
                    {
                        line += element;
                    }
                }
                lines.Add(line);
            }

            text.text = string.Join("\n", lines);
            Bounds measured = renderer.localBounds;
            float scale = Mathf.Min(1f, width / Mathf.Max(measured.size.x, 0.0001f),
                height / Mathf.Max(measured.size.y, 0.0001f));
            text.transform.localScale = UnityEngine.Vector3.one * scale;
            UnityEngine.Vector3 center = new UnityEngine.Vector3(
                (left + right) * 0.5f - (float)(surfaceBounds.X + surfaceBounds.Width * 0.5),
                (float)(surfaceBounds.Y + surfaceBounds.Height * 0.5) - (top + bottom) * 0.5f,
                -0.06f);
            UnityEngine.Vector3 position = center - measured.center * scale;
            float canvasCenterX = (float)(surfaceBounds.X + surfaceBounds.Width * 0.5);
            if (text.alignment == TextAlignment.Left)
            {
                position.x = left - canvasCenterX - measured.min.x * scale;
            }
            else if (text.alignment == TextAlignment.Right)
            {
                position.x = right - canvasCenterX - measured.max.x * scale;
            }
            text.transform.localPosition = position;
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
            if (target == null)
            {
                return;
            }

            target.SetActive(false);
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

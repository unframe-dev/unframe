using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Unframe.Unity.PresentationRuntime
{
    internal sealed class PresentationNativeTextMesh : IDisposable
    {
        private sealed class Part
        {
            internal GameObject Root;
            internal Mesh Mesh;
            internal MeshRenderer Renderer;
            internal Material Source;
            internal Material Material;
            internal bool Current;
        }
        private readonly TextMeshProUGUI text;
        private readonly int order;
        private readonly List<Part> parts = new List<Part>();
        private readonly RectMask2D[] masks;
        private readonly UnityEngine.Vector3[] corners = new UnityEngine.Vector3[4];
        private TMP_SubMeshUI[] submeshes = Array.Empty<TMP_SubMeshUI>();
        private CanvasRenderer[] canvasRenderers = Array.Empty<CanvasRenderer>();
        private bool built;
        private Rect lastClip, lastRect;
        private UnityEngine.Vector3 lastScale;
        private TMP_FontAsset lastFont;
        private Material lastMaterial;
        private int lastMaterialCrc;
        private int lastAtlas;
        private float lastOpacity;
        internal PresentationNativeTextMesh(TextMeshProUGUI text, int order)
        { this.text = text; this.order = order; masks = text.GetComponentsInParent<RectMask2D>(true); text.enabled = false; SuppressCanvasDrawing(true); }
        internal bool IsReady
        {
            get
            {
                if (text == null || text.font == null || text.fontSharedMaterial == null) return false;
                foreach (Part part in parts)
                    if (part.Root == null || part.Mesh == null || part.Renderer == null || part.Material == null || part.Source == null
                        || part.Root.GetComponent<MeshFilter>()?.sharedMesh != part.Mesh || part.Renderer.sharedMaterial != part.Material) return false;
                return true;
            }
        }
        internal void Refresh(bool visible, float opacity)
        {
            if (!visible) { Disable(); return; }
            SuppressCanvasDrawing();
            Rect clip = ClipRect();
            int materialCrc = text.fontSharedMaterial.ComputeCRC();
            int atlas = AtlasSignature();
            bool layoutChanged = !built || text.havePropertiesChanged || lastFont != text.font || lastMaterial != text.fontSharedMaterial
                || lastMaterialCrc != materialCrc || lastAtlas != atlas || lastRect != text.rectTransform.rect || lastScale != text.transform.lossyScale;
            if (!layoutChanged && lastClip == clip && lastOpacity == opacity)
            { foreach (Part part in parts) part.Renderer.enabled = part.Current && part.Mesh.vertexCount != 0; return; }
            if (layoutChanged) text.ForceMeshUpdate(true, true);
            var info = text.textInfo;
            for (int index = 0; index < info.materialCount; index++)
            {
                TMP_MeshInfo source = info.meshInfo[index];
                if (index == parts.Count)
                {
                    var root = new GameObject("Native text mesh " + index, typeof(MeshFilter), typeof(MeshRenderer));
                    root.transform.SetParent(text.transform, false);
                    var part = new Part { Root = root, Mesh = new Mesh { name = "Native text glyphs" }, Renderer = root.GetComponent<MeshRenderer>() };
                    root.GetComponent<MeshFilter>().sharedMesh = part.Mesh;
                    part.Renderer.sortingOrder = order; parts.Add(part);
                }
                Part target = parts[index]; target.Current = true;
                if (target.Source != source.material)
                {
                    PresentationTextureResidency.Destroy(target.Material);
                    target.Source = source.material; target.Material = new Material(source.material);
                    target.Material.DisableKeyword("UNITY_UI_CLIP_RECT"); target.Material.DisableKeyword("UNITY_UI_ALPHACLIP");
                    target.Renderer.sharedMaterial = target.Material;
                }
                target.Material.CopyPropertiesFromMaterial(source.material);
                target.Material.DisableKeyword("UNITY_UI_CLIP_RECT"); target.Material.DisableKeyword("UNITY_UI_ALPHACLIP");
                var positions = new List<UnityEngine.Vector3>(); var uv0 = new List<Vector4>();
                var uv2 = new List<UnityEngine.Vector2>(); var colors = new List<Color>(); var triangles = new List<int>();
                for (int triangle = 0; triangle < source.vertexCount / 4 * 6; triangle += 3)
                {
                    PresentationMeshClip.Vertex Read(int offset)
                    {
                        int vertex = source.triangles[triangle + offset]; Color color = source.colors32[vertex]; color.a *= opacity;
                        return new PresentationMeshClip.Vertex(source.vertices[vertex], source.uvs0[vertex], source.uvs2[vertex], color);
                    }
                    var polygon = PresentationMeshClip.Triangle(Read(0), Read(1), Read(2), clip);
                    int first = positions.Count;
                    foreach (var vertex in polygon) { positions.Add(vertex.Position); uv0.Add(vertex.Uv0); uv2.Add(vertex.Uv2); colors.Add(vertex.Color); }
                    for (int vertex = 1; vertex + 1 < polygon.Count; vertex++) { triangles.Add(first); triangles.Add(first + vertex); triangles.Add(first + vertex + 1); }
                }
                target.Mesh.Clear(); target.Mesh.indexFormat = positions.Count > 65535 ? UnityEngine.Rendering.IndexFormat.UInt32 : UnityEngine.Rendering.IndexFormat.UInt16;
                target.Mesh.SetVertices(positions); target.Mesh.SetUVs(0, uv0); target.Mesh.SetUVs(1, uv2);
                target.Mesh.SetColors(colors); target.Mesh.SetTriangles(triangles, 0); target.Mesh.RecalculateBounds(); target.Mesh.RecalculateNormals();
                target.Renderer.enabled = triangles.Count != 0;
            }
            for (int index = info.materialCount; index < parts.Count; index++) { parts[index].Current = false; parts[index].Renderer.enabled = false; }
            // TMP remains the layout source, but only the spatial meshes take part in rendering.
            SuppressCanvasDrawing(true);
            built = true; lastClip = clip; lastOpacity = opacity; lastRect = text.rectTransform.rect; lastScale = text.transform.lossyScale;
            lastFont = text.font; lastMaterial = text.fontSharedMaterial; lastMaterialCrc = lastMaterial.ComputeCRC(); lastAtlas = AtlasSignature();
        }
        private void SuppressCanvasDrawing(bool discover = false)
        {
            if (discover) { submeshes = text.GetComponentsInChildren<TMP_SubMeshUI>(true); canvasRenderers = text.GetComponentsInChildren<CanvasRenderer>(true); }
            foreach (TMP_SubMeshUI submesh in submeshes) if (submesh != null) submesh.enabled = false;
            foreach (CanvasRenderer renderer in canvasRenderers) if (renderer != null) renderer.Clear();
        }
        private int AtlasSignature()
        {
            int value = text.font.atlasTextureCount;
            unchecked { value = value * 31 + text.font.glyphTable.Count; value = value * 31 + text.font.characterTable.Count; }
            foreach (Texture2D atlas in text.font.atlasTextures)
                if (atlas != null) unchecked { value = value * 31 + atlas.GetInstanceID(); value = value * 31 + (int)atlas.updateCount; value = value * 31 + atlas.width; value = value * 31 + atlas.height; }
            return value;
        }
        private Rect ClipRect()
        {
            Rect result = text.rectTransform.rect;
            foreach (RectMask2D mask in masks)
            {
                if (mask == null || !mask.isActiveAndEnabled) continue;
                var rect = mask.rectTransform; rect.GetWorldCorners(corners);
                UnityEngine.Vector3 minimum = text.transform.InverseTransformPoint(corners[0]);
                UnityEngine.Vector3 maximum = text.transform.InverseTransformPoint(corners[2]);
                result = Rect.MinMaxRect(Mathf.Max(result.xMin, minimum.x), Mathf.Max(result.yMin, minimum.y),
                    Mathf.Min(result.xMax, maximum.x), Mathf.Min(result.yMax, maximum.y));
            }
            return result;
        }
        internal void Disable() { foreach (Part part in parts) if (part.Renderer != null) part.Renderer.enabled = false; }
        public void Dispose()
        {
            foreach (Part part in parts)
            { PresentationTextureResidency.Destroy(part.Mesh); PresentationTextureResidency.Destroy(part.Material); PresentationTextureResidency.Destroy(part.Root); }
            parts.Clear();
        }
    }
}

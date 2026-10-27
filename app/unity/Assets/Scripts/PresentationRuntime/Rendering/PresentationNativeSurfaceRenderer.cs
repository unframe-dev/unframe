using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using UnityEngine.TextCore.LowLevel;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationNativeSurfaceRenderer : IDisposable
    {
        private sealed class Partition
        {
            internal DeliveredRenderSurface Definition;
            internal string HostId;
            internal GameObject Root;
            internal CanvasGroup Visibility;
            internal Canvas Canvas;
            internal readonly Dictionary<string, GameObject> Artifacts = new Dictionary<string, GameObject>();
            internal readonly List<KeyValuePair<NativeUiText, TextMeshProUGUI>> Texts = new List<KeyValuePair<NativeUiText, TextMeshProUGUI>>();
        }
        private readonly List<Partition> partitions = new List<Partition>();
        private readonly Dictionary<string, TMP_FontAsset> fonts = new Dictionary<string, TMP_FontAsset>();

        public bool IsReady
        {
            get
            {
                foreach (Partition partition in partitions)
                {
                    if (partition.Root == null || partition.Visibility == null || partition.Canvas == null) return false;
                    foreach (var text in partition.Texts) if (text.Value == null || text.Value.font == null) return false;
                }
                foreach (TMP_FontAsset font in fonts.Values)
                {
                    if (font == null || font.material == null) return false;
                    foreach (Texture2D atlas in font.atlasTextures) if (atlas == null) return false;
                }
                return true;
            }
        }

        public bool TryBuild(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy,
            IReadOnlyDictionary<string, string> assetPaths, out string error)
        {
            Clear();
            try
            {
                foreach (DeliveredRenderSurface surface in store.RenderSurfaces)
                {
                    if (surface.RendererKind != RendererKind.NativeUi) continue;
                    if (!store.TryGetSurface(surface.SemanticSurfaceId, out ProjectedSurfaceDefinition semantic)
                        || !hierarchy.Registry.TryGet(semantic.HostNodeId, out GameObject host))
                        throw new InvalidOperationException("native-ui-host-absent");
                    var partition = new Partition { Definition = surface, HostId = semantic.HostNodeId };
                    partitions.Add(partition);
                    partition.Root = new GameObject(surface.RenderSurfaceId, typeof(RectTransform), typeof(Canvas), typeof(CanvasGroup));
                    partition.Root.transform.SetParent(host.transform, false);
                    Canvas canvas = partition.Root.GetComponent<Canvas>();
                    canvas.renderMode = RenderMode.WorldSpace;
                    partition.Canvas = canvas;
                    partition.Visibility = partition.Root.GetComponent<CanvasGroup>();
                    partition.Visibility.blocksRaycasts = false;
                    RectTransform rect = (RectTransform)partition.Root.transform;
                    rect.sizeDelta = new UnityEngine.Vector2((float)semantic.LogicalSize.X, (float)semantic.LogicalSize.Y);
                    double scaleX = semantic.PhysicalSizeMeters.X / semantic.LogicalSize.X;
                    double scaleY = semantic.PhysicalSizeMeters.Y / semantic.LogicalSize.Y;
                    if (semantic.Fit == SurfaceFit.Contain) scaleX = scaleY = Math.Min(scaleX, scaleY);
                    if (semantic.Fit == SurfaceFit.Cover) scaleX = scaleY = Math.Max(scaleX, scaleY);
                    rect.localScale = new UnityEngine.Vector3((float)scaleX, (float)scaleY, 1);
                    rect.localPosition = new UnityEngine.Vector3(0, 0, -(float)surface.Layer * 0.0001f);
                    // Canvas faces local -Z, matching the contract surface normal after coordinate conversion.
                    foreach (DeliveredArtifact delivered in surface.Artifacts)
                    {
                        NativeUiArtifact artifact = delivered.NativeUi;
                        var artifactRoot = new GameObject(artifact.ArtifactId, typeof(RectTransform));
                        // TMP reads its font in Awake; assign the delivered font before activating the hierarchy.
                        artifactRoot.SetActive(false);
                        artifactRoot.transform.SetParent(rect, false);
                        ((RectTransform)artifactRoot.transform).sizeDelta = rect.sizeDelta;
                        partition.Artifacts.Add(artifact.ArtifactId, artifactRoot);
                        var nodes = new Dictionary<string, NativeUiNode>();
                        foreach (NativeUiNode node in artifact.Nodes)
                            nodes.Add(node.NodeCase == NativeUiNode.NodeOneofCase.Group ? node.Group.NodeId : node.Text.NodeId, node);
                        BuildNode(artifact.RootNodeId, nodes, artifactRoot.transform, null, partition, assetPaths, new HashSet<string>());
                    }
                }
                NativeUiResidencyPlan residency = store.Delivery.Residency?.NativeUi;
                if (residency != null)
                    foreach (string fontId in residency.FontAssetIds)
                    {
                        if (!assetPaths.TryGetValue(fontId, out string path) || !fonts.TryGetValue(path, out TMP_FontAsset font)
                            || !store.TryGetAsset(fontId, out AssetAccessBinding access)) throw new InvalidOperationException("native-ui-font-residency-absent");
                        var glyphs = new List<uint>();
                        foreach (GlyphResidencyKey glyph in residency.Glyphs) if (glyph.FontChecksum == access.Checksum) glyphs.Add(glyph.UnicodeScalar);
                        if (glyphs.Count > 0 && !font.TryAddCharacters(glyphs.ToArray())) throw new InvalidOperationException("native-ui-font-glyph-unavailable");
                    }
                error = null;
                return true;
            }
            catch (Exception exception)
            {
                Clear();
                error = exception.Message;
                return false;
            }
        }

        private void BuildNode(string id, Dictionary<string, NativeUiNode> nodes, UnityEngine.Transform parent,
            LogicalBounds parentBounds, Partition partition, IReadOnlyDictionary<string, string> paths, HashSet<string> visited)
        {
            if (!visited.Add(id) || !nodes.TryGetValue(id, out NativeUiNode node)) throw new InvalidOperationException("native-ui-tree-invalid");
            bool group = node.NodeCase == NativeUiNode.NodeOneofCase.Group;
            LogicalBounds bounds = group ? node.Group.Bounds : node.Text.Bounds;
            var child = new GameObject(id, typeof(RectTransform));
            var rect = (RectTransform)child.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new UnityEngine.Vector2(0, 1);
            rect.pivot = new UnityEngine.Vector2(0, 1);
            rect.sizeDelta = new UnityEngine.Vector2((float)bounds.Width, (float)bounds.Height);
            rect.anchoredPosition = new UnityEngine.Vector2((float)(bounds.X - (parentBounds?.X ?? 0)), -(float)(bounds.Y - (parentBounds?.Y ?? 0)));
            if (group)
            {
                if (node.Group.Clip) child.AddComponent<RectMask2D>();
                foreach (string childId in node.Group.ChildNodeIds) BuildNode(childId, nodes, rect, bounds, partition, paths, visited);
                return;
            }
            NativeUiText definition = node.Text;
            if (definition.Font?.Primary == null || paths == null || !paths.TryGetValue(definition.Font.Primary.AssetId, out string path) || !File.Exists(path))
                throw new InvalidOperationException("native-ui-font-asset-absent");
            if (!fonts.TryGetValue(path, out TMP_FontAsset font))
            {
                font = TMP_FontAsset.CreateFontAsset(path, 0, 64, 6, GlyphRenderMode.SDFAA, 1024, 1024);
                if (font == null) { PresentationTextureResidency.Destroy(font); throw new InvalidOperationException("native-ui-font-load-failed"); }
                fonts.Add(path, font);
            }
            TextMeshProUGUI text = child.AddComponent<TextMeshProUGUI>();
            text.font = font;
            text.fontSize = Math.Max(1, (int)Math.Round(definition.FontSize));
            text.lineSpacing = (float)((definition.LineHeight - font.faceInfo.lineHeight * definition.FontSize / font.faceInfo.pointSize) * 100 / definition.FontSize);
            text.richText = false;
            text.raycastTarget = false;
            text.textWrappingMode = TextWrappingModes.Normal;
            text.overflowMode = TextOverflowModes.Masking;
            text.alignment = definition.Align == NativeTextAlign.Center ? TextAlignmentOptions.Top
                : definition.Align == NativeTextAlign.End ? TextAlignmentOptions.TopRight : TextAlignmentOptions.TopLeft;
            text.color = new Color((float)definition.Color.Red, (float)definition.Color.Green, (float)definition.Color.Blue, (float)definition.Color.Alpha);
            child.AddComponent<RectMask2D>();
            partition.Texts.Add(new KeyValuePair<NativeUiText, TextMeshProUGUI>(definition, text));
        }

        public bool TryRefresh(PresentationRuntimeDataStore store, double runtimeTimeMs, out string error)
        {
            foreach (Partition partition in partitions)
            {
                string artifactId = null;
                if (store.TryGetSurfaceState(partition.Definition.SemanticSurfaceId, out SurfaceRuntimeState state))
                    foreach (DeliveredStateBinding binding in partition.Definition.StateBindings)
                        if (binding.StateId == state.StateId && binding.BindingCase == DeliveredStateBinding.BindingOneofCase.Artifact) artifactId = binding.Artifact.ArtifactId;
                foreach (var artifact in partition.Artifacts) artifact.Value.SetActive(artifact.Key == artifactId);
                bool visible = store.TryGetNodeState(partition.HostId, out NodeRuntimeState host) && host.Active && host.Visible;
                partition.Canvas.enabled = visible;
                partition.Visibility.alpha = host == null ? 0 : (float)host.Opacity;
                foreach (var entry in partition.Texts)
                {
                    if (!entry.Value.gameObject.activeInHierarchy) continue;
                    if (!TryResolveText(entry.Key.Value, id => store.TryGetVariableState(id, out VariableState variable) ? variable : null, out string text))
                    { Disable(); error = "native-ui-text-value-unavailable"; return false; }
                    if (CountCodePoints(text) > entry.Key.MaxCodePoints)
                    { Disable(); error = "native-ui-text-limit-exceeded"; return false; }
                    if (!entry.Value.font.HasCharacters(text, out uint[] missing, false, false))
                    { Disable(); error = "native-ui-font-glyph-unavailable"; return false; }
                    entry.Value.text = text;
                }
            }
            error = null;
            return true;
        }

        public bool TryPickInteraction(Ray ray, PresentationRuntimeDataStore store,
            out string surfaceId, out string interactionId, out float surfaceDistance)
        {
            surfaceId = null;
            interactionId = null;
            surfaceDistance = float.PositiveInfinity;
            PresentationNormalizedPoint point = default;
            foreach (Partition partition in partitions)
            {
                if (partition.Root == null || !partition.Root.activeInHierarchy || !partition.Canvas.enabled
                    || !store.TryGetSurface(partition.Definition.SemanticSurfaceId, out ProjectedSurfaceDefinition semantic)
                    || !store.TryGetSurfaceState(semantic.SurfaceId, out SurfaceRuntimeState state)) continue;
                bool artifactVisible = false;
                foreach (DeliveredStateBinding binding in partition.Definition.StateBindings)
                    if (binding.StateId == state.StateId && binding.BindingCase == DeliveredStateBinding.BindingOneofCase.Artifact
                        && partition.Artifacts.TryGetValue(binding.Artifact.ArtifactId, out GameObject artifact) && artifact.activeSelf)
                        artifactVisible = true;
                if (!artifactVisible) continue;
                LogicalBounds bounds = partition.Definition.LogicalBounds;
                var center = new UnityEngine.Vector3((float)(bounds.X + bounds.Width / 2 - semantic.LogicalSize.X / 2),
                    (float)(semantic.LogicalSize.Y / 2 - bounds.Y - bounds.Height / 2), 0);
                var size = new UnityEngine.Vector3((float)bounds.Width, (float)bounds.Height, 1);
                Matrix4x4 quadToWorld = partition.Root.transform.localToWorldMatrix * Matrix4x4.TRS(center, UnityEngine.Quaternion.identity, size);
                if (!PresentationSurfacePicking.TryIntersect(ray, quadToWorld, bounds, semantic.LogicalSize.X, semantic.LogicalSize.Y,
                        out PresentationNormalizedPoint candidate, out float distance)
                    || distance > surfaceDistance
                    || distance == surfaceDistance && surfaceId != null && StringComparer.Ordinal.Compare(semantic.SurfaceId, surfaceId) >= 0) continue;
                surfaceId = semantic.SurfaceId;
                surfaceDistance = distance;
                point = candidate;
            }
            if (surfaceId == null) return false;
            foreach (ProjectedSemanticSurface semantic in store.SemanticSurfaces)
                if (semantic.SemanticSurfaceId == surfaceId && store.TryGetSurfaceState(surfaceId, out SurfaceRuntimeState state))
                    return PresentationSurfacePicking.TryResolve(semantic, state.StateId, point, out interactionId);
            return false;
        }

        private static ulong CountCodePoints(string text)
        {
            ulong count = 0;
            for (int index = 0; index < text.Length; index++, count++)
                if (char.IsHighSurrogate(text[index]) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1])) index++;
            return count;
        }

        public static bool TryResolveText(NativeTextValue source, Func<string, VariableState> variable, out string text)
        {
            text = null;
            if (source == null) return false;
            if (source.SourceCase == NativeTextValue.SourceOneofCase.Literal) { text = source.Literal.Value; return true; }
            string id = source.SourceCase == NativeTextValue.SourceOneofCase.NumberVariable ? source.NumberVariable.VariableId
                : source.SourceCase == NativeTextValue.SourceOneofCase.StringVariable ? source.StringVariable.VariableId
                : source.SourceCase == NativeTextValue.SourceOneofCase.BooleanVariable ? source.BooleanVariable.VariableId : null;
            ScalarValue value = id == null ? null : variable(id)?.Value;
            if (value == null) return false;
            if (source.SourceCase == NativeTextValue.SourceOneofCase.NumberVariable && source.NumberVariable.FractionDigits <= 20 && value.ValueCase == ScalarValue.ValueOneofCase.NumberValue)
                text = value.NumberValue.ToString("F" + source.NumberVariable.FractionDigits, CultureInfo.InvariantCulture);
            else if (source.SourceCase == NativeTextValue.SourceOneofCase.StringVariable && value.ValueCase == ScalarValue.ValueOneofCase.StringValue) text = value.StringValue;
            else if (source.SourceCase == NativeTextValue.SourceOneofCase.BooleanVariable && value.ValueCase == ScalarValue.ValueOneofCase.BooleanValue) text = value.BooleanValue ? source.BooleanVariable.TrueLabel : source.BooleanVariable.FalseLabel;
            return text != null;
        }

        public void Disable() { foreach (Partition partition in partitions) if (partition.Canvas != null) partition.Canvas.enabled = false; }
        private void Clear()
        {
            foreach (Partition partition in partitions) PresentationTextureResidency.Destroy(partition.Root);
            partitions.Clear();
            foreach (TMP_FontAsset font in fonts.Values)
            {
                if (font == null) continue;
                foreach (Texture2D atlas in font.atlasTextures) PresentationTextureResidency.Destroy(atlas);
                PresentationTextureResidency.Destroy(font.material);
                PresentationTextureResidency.Destroy(font);
            }
            fonts.Clear();
        }
        public void Dispose() { Clear(); }
    }
}

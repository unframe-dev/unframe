using System;
using System.Collections.Generic;
using Unframe.Delivery;
using Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationRichDeliveryValidation
    {
        internal static bool TryValidateRuntime(DeliveryManifest manifest, out string error)
        {
            try { return TryValidateRuntimeCore(manifest, out error); }
            catch (Exception exception) when (exception is OverflowException || exception is ArgumentException || exception is NullReferenceException)
            { error = "delivery native UI or video residency is invalid."; return false; }
        }

        private static bool TryValidateRuntimeCore(DeliveryManifest manifest, out string error)
        {
            error = "delivery native UI or video residency exceeds its declared capability budget.";
            if (manifest?.ProjectionProfile == null || manifest.CapabilityProfile?.Limits == null || manifest.Residency == null) return false;
            var assets = new Dictionary<string, AssetAccessBinding>();
            foreach (AssetAccessBinding asset in manifest.AssetAccess) if (!assets.TryAdd(asset.AssetId, asset)) return false;
            var variables = new Dictionary<string, ProjectedVariableDefinition>();
            foreach (ProjectedVariableDefinition variable in manifest.ProjectionProfile.RuntimeCatalog.Variables) variables.Add(variable.VariableId, variable);
            NativeUiLimits nativeLimits = manifest.CapabilityProfile.Limits.NativeUi;
            VideoLimits videoLimits = manifest.CapabilityProfile.Limits.Video;
            NativeUiResidencyPlan nativePlan = manifest.Residency.NativeUi;
            VideoResidencyPlan videoPlan = manifest.Residency.Video;
            var fontIds = new HashSet<string>();
            var videoAssets = new Dictionary<string, VideoArtifact>();
            ulong decoderCount = 0, frameBytes = 0;
            foreach (DeliveredRenderSurface surface in manifest.ProjectionProfile.RenderSurfaces)
                foreach (DeliveredArtifact delivered in surface.Artifacts)
                {
                    if (delivered.ArtifactCase == DeliveredArtifact.ArtifactOneofCase.NativeUi)
                    {
                        NativeUiArtifact artifact = delivered.NativeUi;
                        NativeUiCapability capability = manifest.CapabilityProfile.Renderers?.NativeUi;
                        if (nativeLimits == null || nativePlan == null || capability == null || !capability.Supported
                            || capability.ContractVersion != artifact.ContractVersion || surface.ArtifactContractVersion != artifact.ContractVersion
                            || surface.RendererKind != RendererKind.NativeUi || !TryValidateNativeUiArtifact(artifact, assets, variables, out error)) return false;
                        foreach (NativeUiFeature feature in artifact.RequiredFeatures) if (!capability.Features.Contains(feature)) return false;
                        error = "delivery native UI residency exceeds its declared capability budget.";
                        ulong textCount = 0, codePoints = 0;
                        var nodes = new Dictionary<string, NativeUiNode>();
                        foreach (NativeUiNode node in artifact.Nodes)
                        {
                            nodes.Add(node.NodeCase == NativeUiNode.NodeOneofCase.Text ? node.Text.NodeId : node.Group.NodeId, node);
                            if (node.NodeCase != NativeUiNode.NodeOneofCase.Text)
                            {
                                if (node.Group.Clip && !capability.Features.Contains(NativeUiFeature.Clip)) return false;
                                continue;
                            }
                            textCount++;
                            codePoints = Math.Max(codePoints, node.Text.MaxCodePoints);
                            fontIds.Add(node.Text.Font.Primary.AssetId);
                        }
                        ulong depth = Depth(artifact.RootNodeId, nodes);
                        if ((ulong)nodes.Count > nativeLimits.MaxNodesPerArtifact || (ulong)nodes.Count > nativePlan.MaximumNodesPerArtifact
                            || textCount > nativeLimits.MaxTextNodesPerArtifact || textCount > nativePlan.MaximumTextNodesPerArtifact
                            || codePoints > nativeLimits.MaxCodePointsPerText || codePoints > nativePlan.MaximumCodePointsPerText
                            || depth > nativeLimits.MaxTreeDepth || depth > nativePlan.MaximumTreeDepth) return false;
                    }
                    else if (delivered.ArtifactCase == DeliveredArtifact.ArtifactOneofCase.Video)
                    {
                        VideoArtifact artifact = delivered.Video;
                        VideoCapability capability = manifest.CapabilityProfile.Renderers?.Video;
                        if (videoLimits == null || videoPlan == null || capability == null || !capability.Supported
                            || capability.ContractVersion != artifact.ContractVersion || surface.ArtifactContractVersion != artifact.ContractVersion
                            || surface.RendererKind != RendererKind.Video || !TryValidateVideoArtifact(artifact, assets, out error)) return false;
                        if (!capability.Features.Contains(VideoFeature.H264) || artifact.HasAudio && !capability.Features.Contains(VideoFeature.Audio)) return false;
                        foreach (VideoFeature feature in artifact.RequiredFeatures) if (!capability.Features.Contains(feature)) return false;
                        error = "delivery video residency exceeds its declared capability budget.";
                        ulong bytes = checked(artifact.PixelSize.Width * artifact.PixelSize.Height * 4);
                        if (artifact.PixelSize.Width > videoLimits.MaxWidth || artifact.PixelSize.Height > videoLimits.MaxHeight
                            || artifact.PixelSize.Width * artifact.PixelSize.Height > videoLimits.MaxPixels) return false;
                        decoderCount++;
                        frameBytes = checked(frameBytes + bytes);
                        if (videoAssets.TryGetValue(artifact.VideoAssetId, out VideoArtifact existing)
                            && (existing.Checksum != artifact.Checksum || !existing.PixelSize.Equals(artifact.PixelSize)
                                || existing.EncodedSizeBytes != artifact.EncodedSizeBytes || existing.Codec != artifact.Codec)) return false;
                        videoAssets[artifact.VideoAssetId] = artifact;
                    }
                }
            if (fontIds.Count != 0)
            {
                if (nativePlan.BudgetTierId != nativeLimits.TierId || (ulong)fontIds.Count > nativeLimits.MaxFontAssets
                    || nativePlan.MaximumNodesPerArtifact > nativeLimits.MaxNodesPerArtifact || nativePlan.MaximumTreeDepth > nativeLimits.MaxTreeDepth
                    || nativePlan.MaximumTextNodesPerArtifact > nativeLimits.MaxTextNodesPerArtifact || nativePlan.MaximumCodePointsPerText > nativeLimits.MaxCodePointsPerText
                    || nativePlan.FontAssetCount != (ulong)fontIds.Count || nativePlan.FontAssetIds.Count != fontIds.Count
                    || (ulong)nativePlan.Glyphs.Count > nativeLimits.MaxGlyphs
                    || !fontIds.SetEquals(nativePlan.FontAssetIds)) return false;
                var glyphs = new HashSet<string>();
                var checksums = new HashSet<string>();
                foreach (string font in fontIds) checksums.Add(assets[font].Checksum);
                foreach (GlyphResidencyKey glyph in nativePlan.Glyphs)
                    if (!checksums.Contains(glyph.FontChecksum) || glyph.UnicodeScalar > 0x10FFFF || glyph.UnicodeScalar >= 0xD800 && glyph.UnicodeScalar <= 0xDFFF
                        || !glyphs.Add(glyph.FontChecksum + ":" + glyph.UnicodeScalar)) return false;
            }
            if (decoderCount != 0)
            {
                ulong encoded = 0;
                var selected = new HashSet<string>();
                foreach (VideoResidencyBinding binding in videoPlan.Videos)
                {
                    if (!selected.Add(binding.AssetId) || !videoAssets.TryGetValue(binding.AssetId, out VideoArtifact artifact)
                        || binding.Checksum != artifact.Checksum || binding.EncodedSizeBytes != artifact.EncodedSizeBytes
                        || binding.DecodedFrameBytes != artifact.PixelSize.Width * artifact.PixelSize.Height * 4) return false;
                    encoded = checked(encoded + binding.EncodedSizeBytes);
                }
                if (selected.Count != videoAssets.Count || videoPlan.BudgetTierId != videoLimits.TierId
                    || encoded != videoPlan.TotalEncodedBytes || encoded > videoLimits.MaxEncodedBytes
                    || decoderCount > videoLimits.MaxConcurrentDecoders || decoderCount > videoPlan.MaximumConcurrentDecoders
                    || videoPlan.MaximumConcurrentDecoders > videoLimits.MaxConcurrentDecoders || videoPlan.MaximumDecodedFrameBytes > videoLimits.MaxDecodedFrameBytes
                    || frameBytes > videoLimits.MaxDecodedFrameBytes || frameBytes > videoPlan.MaximumDecodedFrameBytes) return false;
            }
            error = null;
            return true;
        }

        private static ulong Depth(string id, Dictionary<string, NativeUiNode> nodes)
        {
            NativeUiNode node = nodes[id];
            ulong depth = 1;
            if (node.NodeCase == NativeUiNode.NodeOneofCase.Group)
                foreach (string child in node.Group.ChildNodeIds) depth = Math.Max(depth, 1 + Depth(child, nodes));
            return depth;
        }

        internal static bool TryValidateNativeUiArtifact(NativeUiArtifact artifact,
            Dictionary<string, AssetAccessBinding> assets, Dictionary<string, ProjectedVariableDefinition> variables, out string error)
        {
            error = "delivery native UI artifact is invalid or unsupported.";
            if (artifact == null || artifact.Nodes.Count == 0 || artifact.Nodes.Count > 4096) return false;
            foreach (NativeUiFeature feature in artifact.RequiredFeatures) if (feature != NativeUiFeature.Clip) return false;
            var nodes = new Dictionary<string, NativeUiNode>();
            foreach (NativeUiNode node in artifact.Nodes)
            {
                string id = node?.NodeCase == NativeUiNode.NodeOneofCase.Text ? node.Text.NodeId
                    : node?.NodeCase == NativeUiNode.NodeOneofCase.Group ? node.Group.NodeId : null;
                if (!PresentationDeliveryCatalog.IsId(id) || !nodes.TryAdd(id, node)) return false;
                LogicalBounds bounds = node.NodeCase == NativeUiNode.NodeOneofCase.Text ? node.Text.Bounds : node.Group.Bounds;
                if (bounds == null || !Finite(bounds.X) || !Finite(bounds.Y) || !Positive(bounds.Width) || !Positive(bounds.Height)) return false;
                if (node.NodeCase != NativeUiNode.NodeOneofCase.Text) continue;
                NativeUiText text = node.Text;
                if (text.Color == null || !Unit(text.Color.Red) || !Unit(text.Color.Green) || !Unit(text.Color.Blue) || !Unit(text.Color.Alpha)
                    || !Positive(text.FontSize) || text.FontSize > 512 || !Positive(text.LineHeight) || text.MaxCodePoints == 0
                    || text.Overflow != NativeTextOverflow.Clip
                    || text.Align != NativeTextAlign.Start && text.Align != NativeTextAlign.Center && text.Align != NativeTextAlign.End
                    || text.Font?.Primary == null || !assets.ContainsKey(text.Font.Primary.AssetId) || text.Font.Fallbacks.Count != 0 || text.Value == null) return false;
                NativeTextValue source = text.Value;
                if (source.SourceCase == NativeTextValue.SourceOneofCase.Literal) continue;
                string variableId;
                ScalarType type;
                if (source.SourceCase == NativeTextValue.SourceOneofCase.NumberVariable)
                { variableId = source.NumberVariable.VariableId; type = ScalarType.Number; if (source.NumberVariable.FractionDigits > 20) return false; }
                else if (source.SourceCase == NativeTextValue.SourceOneofCase.StringVariable)
                { variableId = source.StringVariable.VariableId; type = ScalarType.String; }
                else if (source.SourceCase == NativeTextValue.SourceOneofCase.BooleanVariable)
                { variableId = source.BooleanVariable.VariableId; type = ScalarType.Boolean; }
                else return false;
                if (!variables.TryGetValue(variableId, out ProjectedVariableDefinition variable) || variable.Type != type) return false;
            }
            if (!PresentationDeliveryCatalog.IsId(artifact.RootNodeId) || !Visit(artifact.RootNodeId, nodes, new HashSet<string>(), out int count, 1) || count != nodes.Count) return false;
            error = null;
            return true;
        }

        private static bool Visit(string id, Dictionary<string, NativeUiNode> nodes, HashSet<string> visited, out int count, int depth)
        {
            count = 0;
            if (depth > 64 || !visited.Add(id) || !nodes.TryGetValue(id, out NativeUiNode node)) return false;
            count = 1;
            if (node.NodeCase == NativeUiNode.NodeOneofCase.Group)
                foreach (string child in node.Group.ChildNodeIds)
                { if (!Visit(child, nodes, visited, out int childCount, depth + 1)) return false; count += childCount; }
            return true;
        }

        internal static bool TryValidateVideoArtifact(VideoArtifact artifact, Dictionary<string, AssetAccessBinding> assets, out string error)
        {
            error = "delivery video artifact is invalid or unsupported.";
            if (artifact == null || artifact.Codec != VideoCodec.H264 || artifact.HasAlpha || artifact.DurationMs == 0
                || artifact.PixelSize == null || artifact.PixelSize.Width == 0 || artifact.PixelSize.Height == 0
                || artifact.PixelSize.Width > 4096 || artifact.PixelSize.Height > 4096
                || !assets.TryGetValue(artifact.VideoAssetId, out AssetAccessBinding asset) || asset.MediaType != "video/mp4"
                || asset.Checksum != artifact.Checksum || asset.EncodedSizeBytes != artifact.EncodedSizeBytes) return false;
            foreach (VideoFeature feature in artifact.RequiredFeatures) if (feature != VideoFeature.H264 && feature != VideoFeature.Audio) return false;
            error = null;
            return true;
        }
        private static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
        private static bool Positive(double value) { return Finite(value) && value > 0; }
        private static bool Unit(double value) { return Finite(value) && value >= 0 && value <= 1; }
    }
}

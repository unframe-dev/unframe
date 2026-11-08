using System;
using System.Collections.Generic;
using Unframe.Delivery;
using Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationBakedDeliveryValidation
    {
        internal static bool TryValidate(DeliveryManifest manifest, out string error)
        {
            return TryValidate(manifest.ProjectionProfile.RenderSurfaces, manifest.Residency.Textures,
                manifest.CapabilityProfile.Renderers?.BakedWeb, manifest.CapabilityProfile.Limits?.Texture,
                manifest.AssetAccess, out error) && TryValidateOwnership(manifest.ProjectionProfile.RuntimeCatalog,
                    manifest.ProjectionProfile.RenderSurfaces, manifest.Residency.Textures, out error);
        }

        public static bool TryValidate(IEnumerable<DeliveredRenderSurface> renderSurfaces, TextureResidencyPlan plan,
            TextureCapability capability, TextureLimits profileLimits, IEnumerable<AssetAccessBinding> assetAccess, out string error)
        {
            error = "delivery texture residency or artifact metadata is inconsistent.";
            Dictionary<string, TextureArtifact> selected = new Dictionary<string, TextureArtifact>();
            Dictionary<string, AssetAccessBinding> assets = new Dictionary<string, AssetAccessBinding>();
            foreach (AssetAccessBinding asset in assetAccess)
                if (asset == null || assets.ContainsKey(asset.AssetId)) return false;
                else assets.Add(asset.AssetId, asset);

            foreach (DeliveredRenderSurface surface in renderSurfaces)
            {
                if (surface.RendererKind != RendererKind.BakedWeb) continue;
                TextureLimits limits = profileLimits;
                if (capability == null || limits == null || surface.LogicalBounds == null || !ValidBounds(surface.LogicalBounds)) return false;
                Dictionary<string, BakedWebArtifact> artifacts = new Dictionary<string, BakedWebArtifact>();
                foreach (DeliveredArtifact delivered in surface.Artifacts)
                {
                    BakedWebArtifact artifact = delivered.BakedWeb;
                    artifacts.Add(artifact.ArtifactId, artifact);
                    HashSet<BakedWebFeature> features = new HashSet<BakedWebFeature>();
                    foreach (BakedWebFeature feature in artifact.RequiredFeatures)
                        if (feature == BakedWebFeature.Unspecified || !Enum.IsDefined(typeof(BakedWebFeature), feature)
                            || !features.Add(feature) || !capability.Features.Contains(feature)) return false;
                    if (!features.Contains(BakedWebFeature.Png) || !features.Contains(BakedWebFeature.Srgb)) return false;
                    HashSet<string> states = new HashSet<string>();
                    foreach (BakedWebStateTexture state in artifact.States)
                    {
                        TextureArtifact texture = state.Texture;
                        if (!states.Add(state.StateId) || texture == null || texture.PixelSize == null
                            || !assets.TryGetValue(texture.AssetId, out AssetAccessBinding access)
                            || access.Checksum != texture.Checksum || access.MediaType != "image/png" || access.EncodedSizeBytes != texture.EncodedSizeBytes
                            || !PresentationDeliveryCatalog.IsContentHash(texture.Checksum) || texture.MipCount != 1
                            || texture.AlphaMode != TextureAlphaMode.Opaque && texture.AlphaMode != TextureAlphaMode.Straight
                            || !features.Contains(texture.AlphaMode == TextureAlphaMode.Opaque ? BakedWebFeature.AlphaOpaque : BakedWebFeature.AlphaStraight)
                            || !ValidTexture(texture, limits)) return false;
                        bool bound = false;
                        foreach (DeliveredStateBinding binding in surface.StateBindings)
                            if (binding.StateId == state.StateId && binding.BindingCase == DeliveredStateBinding.BindingOneofCase.Artifact
                                && binding.Artifact.ArtifactId == artifact.ArtifactId) bound = true;
                        if (!bound) return false;
                        if (selected.TryGetValue(texture.Checksum, out TextureArtifact previous))
                        {
                            if (!previous.PixelSize.Equals(texture.PixelSize) || previous.EncodedSizeBytes != texture.EncodedSizeBytes
                                || previous.DecodedGpuBytes != texture.DecodedGpuBytes || previous.AlphaMode != texture.AlphaMode) return false;
                        }
                        else selected.Add(texture.Checksum, texture);
                    }
                }
                foreach (DeliveredStateBinding binding in surface.StateBindings)
                {
                    if (binding.BindingCase != DeliveredStateBinding.BindingOneofCase.Artifact) continue;
                    if (!artifacts.TryGetValue(binding.Artifact.ArtifactId, out BakedWebArtifact artifact)) return false;
                    bool present = false;
                    foreach (BakedWebStateTexture state in artifact.States) if (state.StateId == binding.StateId) present = true;
                    if (!present) return false;
                }
            }
            if (plan == null || !PresentationDeliveryCatalog.IsId(plan.InitialGroupId) || plan.GroupWindows.Count == 0
                || plan.Textures.Count != selected.Count) return false;
            if (selected.Count != 0 && (profileLimits == null || plan.BudgetTierId != profileLimits.TierId)) return false;
            HashSet<string> seen = new HashSet<string>();
            ulong gpu = 0, peak = 0;
            foreach (TextureResidencyBinding binding in plan.Textures)
            {
                if (!seen.Add(binding.Checksum) || !selected.TryGetValue(binding.Checksum, out TextureArtifact texture)
                    || !assets.TryGetValue(binding.AssetId, out AssetAccessBinding access) || access.Checksum != binding.Checksum
                    || binding.PixelSize == null || !binding.PixelSize.Equals(texture.PixelSize)
                    || binding.DecodedGpuBytes != texture.DecodedGpuBytes
                    || binding.PeakLoadCpuBytes != texture.EncodedSizeBytes + 2 * texture.DecodedGpuBytes) return false;
                gpu += binding.DecodedGpuBytes;
                peak = Math.Max(peak, binding.PeakLoadCpuBytes);
            }
            if (gpu != plan.TotalDecodedGpuBytes || peak != plan.MaximumPeakLoadCpuBytes
                || profileLimits != null && peak > profileLimits.MaxSerialLoadCpuBytes) return false;
            ulong maximumGpu = 0, maximumBindings = 0;
            var groups = new HashSet<string>(StringComparer.Ordinal);
            var descriptors = new Dictionary<string, TextureResidencyBinding>(StringComparer.Ordinal);
            foreach (var binding in plan.Textures) if (!descriptors.TryAdd(binding.AssetId, binding)) return false;
            foreach (var window in plan.GroupWindows)
            {
                if (!PresentationDeliveryCatalog.IsId(window.GroupId) || !groups.Add(window.GroupId)) return false;
                var windowIds = new HashSet<string>(StringComparer.Ordinal);
                ulong windowGpu = 0;
                foreach (string id in window.AssetIds)
                {
                    if (!windowIds.Add(id) || !descriptors.TryGetValue(id, out var binding)) return false;
                    windowGpu = checked(windowGpu + binding.DecodedGpuBytes);
                }
                maximumGpu = Math.Max(maximumGpu, windowGpu);
                maximumBindings = Math.Max(maximumBindings, (ulong)windowIds.Count);
            }
            if (!groups.Contains(plan.InitialGroupId) || maximumGpu != plan.MaximumResidentGpuBytes
                || maximumBindings != plan.MaximumResidentTextureBindings
                || profileLimits != null && (maximumGpu > profileLimits.MaxGpuBytes || maximumBindings > profileLimits.MaxTextureBindings)) return false;
            error = null;
            return true;
        }

        public static bool TryValidateOwnership(ProjectedRuntimeCatalog catalog,
            IEnumerable<DeliveredRenderSurface> surfaces, TextureResidencyPlan plan, out string error)
        {
            error = "texture-window-owner-assets-absent";
            var groups = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var window in plan.GroupWindows) groups.Add(window.GroupId, new HashSet<string>(window.AssetIds, StringComparer.Ordinal));
            var ids = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var binding in plan.Textures) ids.Add(binding.Checksum, binding.AssetId);
            foreach (var surface in surfaces)
            {
                if (surface.RendererKind != RendererKind.BakedWeb) continue;
                ProjectedSurfaceDefinition semantic = null;
                foreach (var candidate in catalog.Surfaces)
                    if (candidate.SurfaceId == surface.SemanticSurfaceId) { semantic = candidate; break; }
                if (semantic?.Owner == null) return false;
                foreach (var artifact in surface.Artifacts)
                    foreach (var state in artifact.BakedWeb.States)
                    {
                        if (!ids.TryGetValue(state.Texture.Checksum, out string id)) return false;
                        if (semantic.Owner.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation)
                        {
                            foreach (var assets in groups.Values) if (!assets.Contains(id)) return false;
                        }
                        else if (!groups.TryGetValue(semantic.Owner.Group.GroupId, out var assets) || !assets.Contains(id)) return false;
                    }
            }
            error = null;
            return true;
        }

        private static bool ValidBounds(LogicalBounds bounds)
        {
            return PresentationDeliveryCatalog.IsFinite(bounds.X) && PresentationDeliveryCatalog.IsFinite(bounds.Y)
                && PresentationDeliveryCatalog.IsFinite(bounds.Width) && bounds.Width > 0
                && PresentationDeliveryCatalog.IsFinite(bounds.Height) && bounds.Height > 0;
        }

        private static bool ValidTexture(TextureArtifact texture, TextureLimits limits)
        {
            ulong w = texture.PixelSize.Width, h = texture.PixelSize.Height;
            if (w == 0 || w > 2048 || h == 0 || h > 2048 || w > limits.MaxTextureWidth || h > limits.MaxTextureHeight
                || w * h > limits.MaxTexturePixels) return false;
            ulong scanlines = h * (4 * w + 1);
            return texture.DecodedGpuBytes == w * h * 4 && texture.EncodedSizeBytes >= 78
                && texture.EncodedSizeBytes <= 83 + scanlines + (scanlines >> 12) + (scanlines >> 14) + (scanlines >> 25);
        }
    }
}

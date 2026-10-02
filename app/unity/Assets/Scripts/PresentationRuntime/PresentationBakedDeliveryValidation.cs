using System;
using System.Collections.Generic;
using Unframe.Delivery.V2;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationBakedDeliveryValidation
    {
        internal static bool TryValidate(DeliveryManifest manifest, out string error)
        {
            error = "delivery texture residency or artifact metadata is inconsistent.";
            Dictionary<string, TextureArtifact> selected = new Dictionary<string, TextureArtifact>();
            Dictionary<string, AssetAccessBinding> assets = new Dictionary<string, AssetAccessBinding>();
            foreach (AssetAccessBinding asset in manifest.AssetAccess) assets.Add(asset.AssetId, asset);
            ulong bindingCount = 0;
            foreach (DeliveredRenderSurface surface in manifest.ProjectionProfile.RenderSurfaces)
            {
                if (surface.RendererKind != RendererKind.BakedWeb) continue;
                TextureCapability capability = manifest.CapabilityProfile.Renderers.BakedWeb;
                TextureLimits limits = manifest.CapabilityProfile.Limits == null ? null : manifest.CapabilityProfile.Limits.Texture;
                if (limits == null || surface.LogicalBounds == null || !ValidBounds(surface.LogicalBounds)) return false;
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
                        bindingCount++;
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
            TextureResidencyPlan plan = manifest.Residency.Textures;
            if (selected.Count == 0) { error = null; return plan == null || plan.Textures.Count == 0 && plan.TotalDecodedGpuBytes == 0 && plan.MaximumPeakLoadCpuBytes == 0; }
            TextureLimits profileLimits = manifest.CapabilityProfile.Limits.Texture;
            if (plan == null || plan.BudgetTierId != profileLimits.TierId || bindingCount > profileLimits.MaxTextureBindings
                || plan.Textures.Count != selected.Count) return false;
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
                || gpu > profileLimits.MaxGpuBytes || peak > profileLimits.MaxSerialLoadCpuBytes) return false;
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
            return texture.DecodedGpuBytes == w * h * 4 && texture.EncodedSizeBytes == 76 + scanlines + 5 * ((scanlines + 65534) / 65535);
        }
    }
}

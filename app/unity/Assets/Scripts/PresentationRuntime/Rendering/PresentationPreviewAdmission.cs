using System;
using System.Collections.Generic;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Applies the fixed Preview budget to texture descriptors already validated by the input adapter.
    /// Loads are serial and discard CPU readback before loading the next texture.
    /// </summary>
    public static class PresentationPreviewAdmission
    {
        public const ulong SceneGpuLimitBytes = 64UL * 1024 * 1024;
        public const ulong OverlapGpuLimitBytes = 96UL * 1024 * 1024;
        public const ulong LoadCpuLimitBytes = 64UL * 1024 * 1024;

        public static bool TryAdmit(IEnumerable<TextureResidencyBinding> current, IEnumerable<TextureResidencyBinding> next, out string error)
        {
            error = "preview.texture-metadata-invalid";
            if (!TryIndex(current, out Dictionary<string, TextureResidencyBinding> oldTextures)
                || !TryIndex(next, out Dictionary<string, TextureResidencyBinding> newTextures)) return false;

            ulong oldGpu = 0;
            ulong newGpu = 0;
            foreach (TextureResidencyBinding texture in oldTextures.Values)
                if (!TryAdd(ref oldGpu, texture.DecodedGpuBytes, SceneGpuLimitBytes))
                { error = "preview.scene-gpu-budget-exceeded"; return false; }
            foreach (TextureResidencyBinding texture in newTextures.Values)
                if (!TryAdd(ref newGpu, texture.DecodedGpuBytes, SceneGpuLimitBytes))
                { error = "preview.scene-gpu-budget-exceeded"; return false; }

            ulong overlapGpu = oldGpu;
            foreach (TextureResidencyBinding texture in newTextures.Values)
            {
                if (oldTextures.TryGetValue(texture.Checksum, out TextureResidencyBinding resident))
                {
                    if (!SameMetadata(resident, texture)) return false;
                    continue;
                }
                if (texture.PeakLoadCpuBytes > LoadCpuLimitBytes)
                { error = "preview.load-cpu-budget-exceeded"; return false; }
                if (!TryAdd(ref overlapGpu, texture.DecodedGpuBytes, OverlapGpuLimitBytes))
                { error = "preview.overlap-gpu-budget-exceeded"; return false; }
            }
            error = null;
            return true;
        }

        private static bool TryIndex(IEnumerable<TextureResidencyBinding> textures, out Dictionary<string, TextureResidencyBinding> index)
        {
            index = new Dictionary<string, TextureResidencyBinding>(StringComparer.Ordinal);
            if (textures == null) return false;
            foreach (TextureResidencyBinding texture in textures)
            {
                if (texture == null || String.IsNullOrEmpty(texture.Checksum) || texture.PixelSize == null
                    || texture.PixelSize.Width == 0 || texture.PixelSize.Height == 0
                    || texture.DecodedGpuBytes == 0 || texture.PeakLoadCpuBytes == 0) return false;
                if (index.TryGetValue(texture.Checksum, out TextureResidencyBinding previous))
                {
                    if (!SameMetadata(previous, texture)) return false;
                }
                else index.Add(texture.Checksum, texture);
            }
            return true;
        }

        private static bool SameMetadata(TextureResidencyBinding left, TextureResidencyBinding right)
        {
            return left.PixelSize.Equals(right.PixelSize) && left.DecodedGpuBytes == right.DecodedGpuBytes
                && left.PeakLoadCpuBytes == right.PeakLoadCpuBytes;
        }

        private static bool TryAdd(ref ulong total, ulong value, ulong limit)
        {
            if (total > limit || value > limit - total) return false;
            total += value;
            return true;
        }
    }
}

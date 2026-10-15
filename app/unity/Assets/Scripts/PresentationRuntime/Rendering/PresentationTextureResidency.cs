using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using Unframe.Delivery;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationTextureResidency : IDisposable
    {
        private sealed class SharedTexture
        {
            internal Texture2D Texture;
            internal TextureResidencyBinding Descriptor;
            internal int Owners;
        }
        private static readonly Dictionary<string, SharedTexture> SharedTextures = new Dictionary<string, SharedTexture>();
        private static readonly uint[] CrcTable = CreateCrcTable();
        private readonly Dictionary<string, Texture2D> textures = new Dictionary<string, Texture2D>();
        private readonly Dictionary<string, TextureResidencyBinding> descriptors = new Dictionary<string, TextureResidencyBinding>();
        public ulong ResidentGpuBytes { get; private set; }

        public bool TryGet(string checksum, out Texture2D texture)
        {
            return textures.TryGetValue(checksum, out texture) && texture != null && !texture.isReadable;
        }

        public bool TryRetain(TextureResidencyBinding binding, out string error)
        {
            error = "asset-texture-residency-failed";
            if (binding == null || binding.PixelSize == null || !SharedTextures.TryGetValue(binding.Checksum, out SharedTexture shared)
                || shared.Texture == null || shared.Texture.isReadable
                || !shared.Descriptor.PixelSize.Equals(binding.PixelSize)
                || shared.Descriptor.DecodedGpuBytes != binding.DecodedGpuBytes
                || shared.Descriptor.PeakLoadCpuBytes != binding.PeakLoadCpuBytes) return false;
            if (descriptors.ContainsKey(binding.Checksum))
            {
                error = null;
                return TryGet(binding.Checksum, out _);
            }
            shared.Owners = checked(shared.Owners + 1);
            descriptors.Add(binding.Checksum, binding.Clone());
            textures.Add(binding.Checksum, shared.Texture);
            ResidentGpuBytes = checked(ResidentGpuBytes + binding.DecodedGpuBytes);
            error = null;
            return true;
        }

        public bool IsReady(IEnumerable<TextureResidencyBinding> selected)
        {
            foreach (TextureResidencyBinding binding in selected)
                if (!TryGet(binding.Checksum, out Texture2D texture) || texture.width != (int)binding.PixelSize.Width
                    || texture.height != (int)binding.PixelSize.Height || texture.format != TextureFormat.RGBA32 || texture.mipmapCount != 1) return false;
            return true;
        }

        public bool TryLoad(TextureResidencyBinding binding, AssetAccessBinding access, byte[] bytes, out string error)
        {
            error = "asset-texture-residency-failed";
            if (binding == null || binding.PixelSize == null || access == null || bytes == null
                || binding.AssetId != access.AssetId || binding.Checksum != access.Checksum
                || access.MediaType != "image/png" || access.EncodedSizeBytes != (ulong)bytes.LongLength
                || binding.PixelSize.Width == 0 || binding.PixelSize.Width > 2048
                || binding.PixelSize.Height == 0 || binding.PixelSize.Height > 2048) return false;

            ulong width = binding.PixelSize.Width;
            ulong height = binding.PixelSize.Height;
            ulong raw = width * height * 4;
            ulong scanlines = height * (4 * width + 1);
            ulong encoded = 76 + scanlines + 5 * ((scanlines + 65534) / 65535);
            if (binding.DecodedGpuBytes != raw || binding.PeakLoadCpuBytes != encoded + 2 * raw
                || access.EncodedSizeBytes != encoded || !HasMatchingHeader(bytes, (uint)width, (uint)height)) return false;
            using (SHA256 hash = SHA256.Create())
            {
                string actual = "sha256:" + BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                if (binding.Checksum != actual) return false;
            }

            if (descriptors.TryGetValue(binding.Checksum, out TextureResidencyBinding existing))
            {
                if (!existing.PixelSize.Equals(binding.PixelSize) || existing.DecodedGpuBytes != binding.DecodedGpuBytes
                    || existing.PeakLoadCpuBytes != binding.PeakLoadCpuBytes || !TryGet(binding.Checksum, out _)) return false;
                error = null;
                return true;
            }

            if (SharedTextures.TryGetValue(binding.Checksum, out SharedTexture shared))
            {
                if (shared.Texture == null || shared.Texture.isReadable
                    || !shared.Descriptor.PixelSize.Equals(binding.PixelSize)
                    || shared.Descriptor.DecodedGpuBytes != binding.DecodedGpuBytes
                    || shared.Descriptor.PeakLoadCpuBytes != binding.PeakLoadCpuBytes) return false;
                shared.Owners = checked(shared.Owners + 1);
                descriptors.Add(binding.Checksum, binding.Clone());
                textures.Add(binding.Checksum, shared.Texture);
                ResidentGpuBytes = checked(ResidentGpuBytes + raw);
                error = null;
                return true;
            }

            if (!TryDecode(bytes, (int)width, (int)height, out byte[] rgba)) return false;

            Texture2D texture = null;
            try
            {
                texture = new Texture2D((int)width, (int)height, TextureFormat.RGBA32, false, false);
                texture.LoadRawTextureData(rgba);
                texture.Apply(false, true);
                if (texture.width != (int)width
                    || texture.height != (int)height || texture.format != TextureFormat.RGBA32
                    || texture.mipmapCount != 1 || texture.isReadable)
                {
                    error = "asset-texture-residency-failed: decoded format=" + texture.format + ", readable=" + texture.isReadable + ", size=" + texture.width + "x" + texture.height + ", mips=" + texture.mipmapCount;
                    Destroy(texture);
                    return false;
                }
                texture.wrapMode = TextureWrapMode.Clamp;
                texture.filterMode = FilterMode.Bilinear;
                descriptors.Add(binding.Checksum, binding.Clone());
                textures.Add(binding.Checksum, texture);
                SharedTextures.Add(binding.Checksum, new SharedTexture { Texture = texture, Descriptor = binding.Clone(), Owners = 1 });
                ResidentGpuBytes = checked(ResidentGpuBytes + raw);
                error = null;
                return true;
            }
            catch (Exception exception) when (exception is UnityException || exception is ArgumentException || exception is OverflowException || exception is OutOfMemoryException)
            {
                Destroy(texture);
                return false;
            }
        }

        // The portable encoder emits one sRGB chunk and stored DEFLATE blocks with filter zero.
        // Decode directly into the upload buffer to keep the declared two-RGBA-copy peak.
        private static bool TryDecode(byte[] png, int width, int height, out byte[] rgba)
        {
            rgba = null;
            if (ReadUInt32(png, 33) != 1 || png[37] != 115 || png[38] != 82 || png[39] != 71 || png[40] != 66 || png[41] != 0
                || png[50] != 73 || png[51] != 68 || png[52] != 65 || png[53] != 84) return false;
            int end = png.Length - 16;
            if (ReadUInt32(png, 46) != end - 54 || png[54] != 0x78 || png[55] != 0x01
                || ReadUInt32(png, png.Length - 12) != 0 || png[png.Length - 8] != 73 || png[png.Length - 7] != 69
                || png[png.Length - 6] != 78 || png[png.Length - 5] != 68) return false;
            if (!ValidChunkCrc(png, 8) || !ValidChunkCrc(png, 33) || !ValidChunkCrc(png, 46) || !ValidChunkCrc(png, png.Length - 12)) return false;
            byte[] output = new byte[width * height * 4];
            int cursor = 56;
            int scanline = 0;
            int total = height * (4 * width + 1);
            uint a = 1, b = 0;
            while (cursor < end - 4)
            {
                if (cursor + 5 > end - 4) return false;
                int final = png[cursor++];
                int length = png[cursor] | png[cursor + 1] << 8;
                int complement = png[cursor + 2] | png[cursor + 3] << 8;
                cursor += 4;
                if ((final != 0 && final != 1) || (length ^ complement) != 65535 || length == 0
                    || length != Math.Min(65535, total - scanline) || cursor + length > end - 4) return false;
                for (int i = 0; i < length; i++, scanline++)
                {
                    byte value = png[cursor++];
                    a = (a + value) % 65521;
                    b = (b + a) % 65521;
                    int row = scanline / (width * 4 + 1);
                    int column = scanline % (width * 4 + 1);
                    if (column == 0) { if (value != 0) return false; }
                    else output[(height - row - 1) * width * 4 + column - 1] = value;
                }
                if (final == 1)
                {
                    if (scanline != total || cursor != end - 4 || ReadUInt32(png, cursor) != (b << 16 | a)) return false;
                    rgba = output;
                    return true;
                }
                if (scanline >= total) return false;
            }
            return false;
        }

        private static uint[] CreateCrcTable()
        {
            uint[] table = new uint[256];
            for (uint index = 0; index < table.Length; index++)
            {
                uint value = index;
                for (int bit = 0; bit < 8; bit++) value = (value & 1) != 0 ? 0xedb88320U ^ (value >> 1) : value >> 1;
                table[index] = value;
            }
            return table;
        }

        private static bool ValidChunkCrc(byte[] png, int start)
        {
            if (start < 0 || start > png.Length - 12) return false;
            uint length = ReadUInt32(png, start);
            if (length > png.Length - start - 12) return false;
            int end = start + 8 + (int)length;
            uint crc = uint.MaxValue;
            for (int index = start + 4; index < end; index++) crc = CrcTable[(crc ^ png[index]) & 255] ^ (crc >> 8);
            return ~crc == ReadUInt32(png, end);
        }

        private static bool HasMatchingHeader(byte[] bytes, uint width, uint height)
        {
            byte[] signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
            if (bytes.Length < 33) return false;
            for (int i = 0; i < signature.Length; i++) if (bytes[i] != signature[i]) return false;
            return ReadUInt32(bytes, 8) == 13 && bytes[12] == 73 && bytes[13] == 72 && bytes[14] == 68 && bytes[15] == 82
                && ReadUInt32(bytes, 16) == width && ReadUInt32(bytes, 20) == height
                && bytes[24] == 8 && bytes[25] == 6 && bytes[26] == 0 && bytes[27] == 0 && bytes[28] == 0;
        }

        private static uint ReadUInt32(byte[] bytes, int offset)
        {
            return (uint)bytes[offset] << 24 | (uint)bytes[offset + 1] << 16 | (uint)bytes[offset + 2] << 8 | bytes[offset + 3];
        }

        public void Dispose()
        {
            List<string> checksums = new List<string>(textures.Keys);
            checksums.Sort(StringComparer.Ordinal);
            foreach (string checksum in checksums)
            {
                SharedTexture shared = SharedTextures[checksum];
                if (--shared.Owners != 0) continue;
                SharedTextures.Remove(checksum);
                Destroy(shared.Texture);
            }
            textures.Clear();
            descriptors.Clear();
            ResidentGpuBytes = 0;
        }

        internal static void Destroy(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Threading;
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
        internal static int GpuReleaseFrame { get; private set; } = -1;
        private static readonly uint[] CrcTable = CreateCrcTable();
        private readonly Dictionary<string, Texture2D> textures = new Dictionary<string, Texture2D>();
        private readonly Dictionary<string, TextureResidencyBinding> descriptors = new Dictionary<string, TextureResidencyBinding>();
        public ulong ResidentGpuBytes { get; private set; }
        public IEnumerable<TextureResidencyBinding> Bindings => descriptors.Values;

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

        private static bool ValidateEncoded(TextureResidencyBinding binding, AssetAccessBinding access, byte[] bytes, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (binding == null || binding.PixelSize == null || access == null || bytes == null
                || binding.AssetId != access.AssetId || binding.Checksum != access.Checksum
                || access.MediaType != "image/png" || access.EncodedSizeBytes != (ulong)bytes.LongLength
                || binding.PixelSize.Width == 0 || binding.PixelSize.Width > 2048
                || binding.PixelSize.Height == 0 || binding.PixelSize.Height > 2048) return false;

            ulong width = binding.PixelSize.Width;
            ulong height = binding.PixelSize.Height;
            ulong raw = width * height * 4;
            ulong scanlines = height * (4 * width + 1);
            // zlib deflateBound for the encoder's windowBits=15 and memLevel=8, plus PNG chunks.
            ulong maximumEncoded = 83 + scanlines + (scanlines >> 12) + (scanlines >> 14) + (scanlines >> 25);
            if (binding.DecodedGpuBytes != raw || binding.PeakLoadCpuBytes != access.EncodedSizeBytes + 2 * raw
                || access.EncodedSizeBytes < 78 || access.EncodedSizeBytes > maximumEncoded || !HasMatchingHeader(bytes, (uint)width, (uint)height)) return false;
            using (SHA256 hash = SHA256.Create())
            {
                string actual = "sha256:" + BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                if (binding.Checksum != actual) return false;
            }

            token.ThrowIfCancellationRequested();
            return true;
        }

        public static bool TryPrepare(TextureResidencyBinding binding, AssetAccessBinding access, byte[] bytes,
            out byte[] rgba, CancellationToken token = default)
        {
            rgba = null;
            return ValidateEncoded(binding, access, bytes, token)
                && TryDecode(bytes, (int)binding.PixelSize.Width, (int)binding.PixelSize.Height, out rgba, token);
        }

        public bool TryLoad(TextureResidencyBinding binding, AssetAccessBinding access, byte[] bytes, out string error)
        {
            error = "asset-texture-residency-failed";
            if (!ValidateEncoded(binding, access, bytes, default)) return false;
            if (TryRetain(binding, out error)) return true;
            return TryDecode(bytes, (int)binding.PixelSize.Width, (int)binding.PixelSize.Height, out byte[] rgba, default)
                && TryUpload(binding, rgba, out error);
        }

        internal bool TryUpload(TextureResidencyBinding binding, byte[] rgba, out string error)
        {
            error = "asset-texture-residency-failed";
            ulong width = binding.PixelSize.Width, height = binding.PixelSize.Height;
            ulong raw = width * height * 4;
            if (rgba == null || (ulong)rgba.LongLength != raw) return false;
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

        // Keep the last compressed byte out of bulk reads so inflater read-ahead cannot hide trailing data.
        private sealed class DeflateInput : MemoryStream
        {
            private readonly CancellationToken token;
            internal DeflateInput(byte[] bytes, int offset, int count, CancellationToken token) : base(bytes, offset, count, false) { this.token = token; }
            public override int Read(byte[] buffer, int offset, int count)
            {
                token.ThrowIfCancellationRequested();
                long remaining = Length - Position;
                if (count == 0) return 0;
                if (remaining == 0) throw new InvalidDataException("Truncated DEFLATE stream.");
                return base.Read(buffer, offset, (int)Math.Min(count, Math.Max(1, remaining - 1)));
            }
        }

        // Decode rows directly into the upload buffer, without retaining a second scanline image.
        private static bool TryDecode(byte[] png, int width, int height, out byte[] rgba, CancellationToken token)
        {
            rgba = null;
            if (png.Length < 78 || ReadUInt32(png, 33) != 1 || png[37] != 115 || png[38] != 82 || png[39] != 71 || png[40] != 66 || png[41] != 0
                || png[50] != 73 || png[51] != 68 || png[52] != 65 || png[53] != 84) return false;
            int end = png.Length - 16;
            if (ReadUInt32(png, 46) != end - 54 || (png[54] & 15) != 8 || (png[54] >> 4) > 7
                || ((png[54] << 8 | png[55]) % 31) != 0 || (png[55] & 32) != 0
                || ReadUInt32(png, png.Length - 12) != 0 || png[png.Length - 8] != 73 || png[png.Length - 7] != 69
                || png[png.Length - 6] != 78 || png[png.Length - 5] != 68) return false;
            if (!ValidChunkCrc(png, 8, token) || !ValidChunkCrc(png, 33, token) || !ValidChunkCrc(png, 46, token) || !ValidChunkCrc(png, png.Length - 12, token)) return false;
            byte[] output = new byte[width * height * 4];
            uint a = 1, b = 0;
            try
            {
                using (var input = new DeflateInput(png, 56, end - 60, token))
                using (var inflater = new DeflateStream(input, CompressionMode.Decompress, true))
                {
                    for (int row = 0; row < height; row++)
                    {
                        token.ThrowIfCancellationRequested();
                        if (inflater.ReadByte() != 0) return false;
                        b = (b + a) % 65521;
                        int offset = (height - row - 1) * width * 4;
                        int filled = 0;
                        while (filled < width * 4)
                        {
                            token.ThrowIfCancellationRequested();
                            int read = inflater.Read(output, offset + filled, width * 4 - filled);
                            if (read == 0) return false;
                            for (int i = 0; i < read; i++)
                            {
                                a = (a + output[offset + filled + i]) % 65521;
                                b = (b + a) % 65521;
                            }
                            filled += read;
                        }
                    }
                    if (inflater.ReadByte() != -1 || input.Position != input.Length || ReadUInt32(png, end - 4) != (b << 16 | a)) return false;
                }
                rgba = output;
                return true;
            }
            catch (InvalidDataException) { return false; }
            catch (IOException) { return false; }
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

        private static bool ValidChunkCrc(byte[] png, int start, CancellationToken token)
        {
            if (start < 0 || start > png.Length - 12) return false;
            uint length = ReadUInt32(png, start);
            if (length > png.Length - start - 12) return false;
            int end = start + 8 + (int)length;
            uint crc = uint.MaxValue;
            for (int index = start + 4; index < end; index++)
            {
                if ((index & 65535) == 0) token.ThrowIfCancellationRequested();
                crc = CrcTable[(crc ^ png[index]) & 255] ^ (crc >> 8);
            }
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

        public void RetainOnly(IEnumerable<string> requiredChecksums)
        {
            var required = new HashSet<string>(requiredChecksums, StringComparer.Ordinal);
            var checksums = new List<string>(textures.Keys);
            checksums.Sort(StringComparer.Ordinal);
            foreach (string checksum in checksums)
            {
                if (required.Contains(checksum)) continue;
                ResidentGpuBytes -= descriptors[checksum].DecodedGpuBytes;
                textures.Remove(checksum);
                descriptors.Remove(checksum);
                SharedTexture shared = SharedTextures[checksum];
                if (--shared.Owners != 0) continue;
                SharedTextures.Remove(checksum);
                if (Application.isPlaying) GpuReleaseFrame = Time.frameCount;
                Destroy(shared.Texture);
            }
        }

        public void Dispose() => RetainOnly(Array.Empty<string>());

        internal static void Destroy(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}

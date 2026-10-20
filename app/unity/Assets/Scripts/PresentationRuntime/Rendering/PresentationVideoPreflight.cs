using System;
using System.Collections.Generic;
using System.IO;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    // Only the allocation-relevant ISO BMFF/AVC headers are inspected here; decoding remains VideoPlayer's responsibility.
    public static class PresentationVideoPreflight
    {
        private sealed class Inspection
        {
            internal byte[] Bytes; internal VideoArtifact Artifact; internal int Boxes, VideoTracks, AudioTracks, Samples, SpsCount;
            internal bool HasMovie, HasData, VideoDuration; internal uint MovieTimescale;
        }
        public static bool TryValidate(byte[] bytes, VideoArtifact artifact, out string error)
        {
            error = "video-container-preflight-invalid";
            try
            {
                if (bytes == null || bytes.Length < 32 || bytes.Length > 64 * 1024 * 1024 || artifact?.PixelSize == null
                    || artifact.Codec != VideoCodec.H264 || artifact.PixelSize.Width == 0 || artifact.PixelSize.Width > 1920
                    || artifact.PixelSize.Height == 0 || artifact.PixelSize.Height > 1080 || artifact.DurationMs == 0) return false;
                var inspection = new Inspection { Bytes = bytes, Artifact = artifact };
                Boxes(inspection, 0, bytes.Length, 0);
                if (!inspection.HasMovie || !inspection.HasData || inspection.VideoTracks != 1 || inspection.AudioTracks != (artifact.HasAudio ? 1 : 0)
                    || !inspection.VideoDuration || inspection.Samples != 1 || inspection.SpsCount == 0) return false;
                error = null; return true;
            }
            catch (Exception exception) when (exception is ArgumentException || exception is OverflowException || exception is IndexOutOfRangeException || exception is EndOfStreamException) { return false; }
        }
        private static uint U32(byte[] bytes, int p) => (uint)bytes[p] << 24 | (uint)bytes[p + 1] << 16 | (uint)bytes[p + 2] << 8 | bytes[p + 3];
        private static int U16(byte[] bytes, int p) => bytes[p] * 256 + bytes[p + 1];
        private static void Require(bool condition) { if (!condition) throw new ArgumentException("Invalid MP4 header."); }
        private static void Boxes(Inspection scan, int start, int end, int depth)
        {
            Require(depth <= 12); byte[] bytes = scan.Bytes;
            for (int p = start; p < end;)
            {
                Require(end - p >= 8 && ++scan.Boxes <= 16384);
                ulong size = U32(bytes, p); uint type = U32(bytes, p + 4); int header = 8;
                if (size == 1) { Require(end - p >= 16); size = (ulong)U32(bytes, p + 8) << 32 | U32(bytes, p + 12); header = 16; }
                if (size == 0) size = (ulong)(end - p);
                Require(size >= (ulong)header && size <= (ulong)(end - p)); int next = checked(p + (int)size), payload = p + header;
                switch (type)
                {
                    case 0x6d6f6f76: Require(!scan.HasMovie); scan.HasMovie = true; Boxes(scan, payload, next, depth + 1); break;
                    case 0x7472616b: case 0x6d646961: case 0x6d696e66: case 0x7374626c: Boxes(scan, payload, next, depth + 1); break;
                    case 0x6d646174: scan.HasData = true; break;
                    case 0x6d766864:
                        Require(next - payload >= 20 && bytes[payload] <= 1);
                        int timeOffset = bytes[payload] == 1 ? 20 : 12; Require(next - payload >= timeOffset + 4);
                        scan.MovieTimescale = U32(bytes, payload + timeOffset); Require(scan.MovieTimescale > 0); break;
                    case 0x68646c72:
                        Require(next - payload >= 12); uint handler = U32(bytes, payload + 8);
                        if (handler == 0x76696465) scan.VideoTracks++;
                        else if (handler == 0x736f756e) scan.AudioTracks++;
                        else Require(handler == 0x6d646972); break;
                    case 0x73747364:
                        Require(next - payload >= 8 && U32(bytes, payload + 4) == 1); Boxes(scan, payload + 8, next, depth + 1); break;
                    case 0x61766331:
                        Require(next - payload >= 78 && (ulong)U16(bytes, payload + 24) == scan.Artifact.PixelSize.Width && (ulong)U16(bytes, payload + 26) == scan.Artifact.PixelSize.Height);
                        scan.Samples++; Boxes(scan, payload + 78, next, depth + 1); break;
                    case 0x6d703461:
                        Require(next - payload >= 28 && U16(bytes, payload + 8) == 0 && U16(bytes, payload + 16) <= 2); break;
                    case 0x61766343:
                        Avc(scan, payload, next); break;
                    case 0x746b6864:
                        Require(next - payload >= 84); uint width = U32(bytes, next - 8), height = U32(bytes, next - 4);
                        if (width != 0 || height != 0)
                        {
                            Require(width == scan.Artifact.PixelSize.Width * 65536u && height == scan.Artifact.PixelSize.Height * 65536u && scan.MovieTimescale > 0 && bytes[payload] <= 1);
                            ulong duration = bytes[payload] == 0 ? U32(bytes, payload + 20) : ((ulong)U32(bytes, payload + 28) << 32 | U32(bytes, payload + 32));
                            Require(Math.Abs((decimal)duration * 1000 / scan.MovieTimescale - scan.Artifact.DurationMs) <= 1);
                            scan.VideoDuration = true;
                        }
                        break;
                }
                p = next;
            }
        }
        private static void Avc(Inspection scan, int start, int end)
        {
            byte[] bytes = scan.Bytes;
            Require(end - start >= 7 && bytes[start] == 1 && bytes[start + 3] <= 41 && (bytes[start + 4] & 3) == 3);
            int count = bytes[start + 5] & 31; Require(count > 0 && count <= 8); int p = start + 6;
            for (int i = 0; i < count; i++)
            {
                Require(end - p >= 2); int length = U16(bytes, p); p += 2; Require(length > 4 && length <= end - p);
                Sps(bytes, p, length, (uint)scan.Artifact.PixelSize.Width, (uint)scan.Artifact.PixelSize.Height); p += length; scan.SpsCount++;
            }
            Require(p < end); int pps = bytes[p++]; Require(pps > 0 && pps <= 32);
            for (int i = 0; i < pps; i++) { Require(end - p >= 2); int length = U16(bytes, p); p += 2; Require(length > 0 && length <= end - p && (bytes[p] & 31) == 8); p += length; }
            Require(p <= end);
        }
        private sealed class Bits
        {
            private readonly byte[] bytes; private int position;
            internal Bits(byte[] bytes) { this.bytes = bytes; }
            internal uint Read(int count)
            {
                Require(count >= 0 && count <= 32 && position <= bytes.Length * 8 - count); uint value = 0;
                for (int i = 0; i < count; i++, position++) value = value << 1 | (uint)(bytes[position / 8] >> (7 - position % 8) & 1);
                return value;
            }
            internal int Ue() { int zero = 0; while (Read(1) == 0) Require(++zero <= 24); return checked((int)((1u << zero) - 1 + Read(zero))); }
            internal int Se() { int v = Ue(); return v % 2 == 0 ? -v / 2 : (v + 1) / 2; }
        }
        private static void Sps(byte[] encoded, int start, int length, uint expectedWidth, uint expectedHeight)
        {
            Require((encoded[start] & 31) == 7); var rbsp = new List<byte>(length); int zeros = 0;
            for (int i = start + 1; i < start + length; i++)
            {
                byte value = encoded[i]; if (zeros >= 2 && value == 3) { Require(i + 1 < start + length && encoded[i + 1] <= 3); zeros = 0; continue; }
                rbsp.Add(value); zeros = value == 0 ? zeros + 1 : 0;
            }
            var bits = new Bits(rbsp.ToArray()); uint profile = bits.Read(8); bits.Read(8); uint level = bits.Read(8);
            Require(profile == 100 && level >= 10 && level <= 41 && bits.Ue() <= 31);
            int chroma = 1;
            if (profile == 100)
            {
                chroma = bits.Ue(); Require(chroma == 1); Require(bits.Ue() == 0 && bits.Ue() == 0); bits.Read(1);
                if (bits.Read(1) != 0)
                    for (int i = 0; i < 8; i++)
                        if (bits.Read(1) != 0)
                        { int last = 8, next = 8; for (int j = 0; j < (i < 6 ? 16 : 64); j++) { if (next != 0) { int delta = bits.Se(); Require(delta >= -128 && delta <= 127); next = (last + delta + 256) % 256; } if (next != 0) last = next; } }
            }
            Require(bits.Ue() <= 12); int order = bits.Ue(); Require(order <= 2);
            if (order == 0) Require(bits.Ue() <= 12);
            else if (order == 1) { bits.Read(1); bits.Se(); bits.Se(); int cycle = bits.Ue(); Require(cycle <= 255); for (int i = 0; i < cycle; i++) bits.Se(); }
            int references = bits.Ue(); Require(references <= 16); bits.Read(1);
            int widthMbs = checked(bits.Ue() + 1), heightUnits = checked(bits.Ue() + 1); int frame = (int)bits.Read(1);
            if (frame == 0) bits.Read(1); bits.Read(1);
            int left = 0, right = 0, top = 0, bottom = 0;
            if (bits.Read(1) != 0) { left = bits.Ue(); right = bits.Ue(); top = bits.Ue(); bottom = bits.Ue(); }
            int codedWidth = checked(widthMbs * 16), codedHeight = checked(heightUnits * 16 * (2 - frame));
            int width = checked(codedWidth - (left + right) * 2), height = checked(codedHeight - (top + bottom) * 2 * (2 - frame));
            Require(codedWidth <= 1920 && codedHeight <= 1088 && width > 0 && height > 0 && width == expectedWidth && height == expectedHeight
                && checked((long)widthMbs * heightUnits * (2 - frame)) <= 8192 && checked((long)widthMbs * heightUnits * (2 - frame) * references) <= 32768);
        }
    }
}

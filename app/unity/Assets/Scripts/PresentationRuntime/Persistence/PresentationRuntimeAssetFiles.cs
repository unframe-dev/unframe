using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using Unframe.Delivery;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationRuntimeAssetFiles : IDisposable
    {
        private readonly string directory = Path.Combine(Application.temporaryCachePath, "unframe-runtime-" + Guid.NewGuid().ToString("N"));
        private readonly Dictionary<string, string> paths = new Dictionary<string, string>();
        private readonly Dictionary<string, long> lengths = new Dictionary<string, long>();
        private bool disposed;

        public IReadOnlyDictionary<string, string> Paths => paths;
        public bool IsReady
        {
            get
            {
                if (disposed) return false;
                foreach (var entry in lengths)
                    if (!File.Exists(entry.Key) || new FileInfo(entry.Key).Length != entry.Value) return false;
                return true;
            }
        }

        public string Add(AssetAccessBinding asset, byte[] bytes)
        {
            if (disposed) throw new ObjectDisposedException(nameof(PresentationRuntimeAssetFiles));
            if (asset == null || bytes == null || !PresentationDeliveryCatalog.IsContentHash(asset.Checksum)
                || string.IsNullOrEmpty(asset.AssetId) || asset.EncodedSizeBytes != (ulong)bytes.LongLength)
                throw new InvalidOperationException("asset-file-metadata-invalid");
            string extension = Extension(asset.MediaType);
            using (SHA256 hash = SHA256.Create())
                if ("sha256:" + BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant() != asset.Checksum)
                    throw new InvalidOperationException("asset-file-checksum-mismatch");
            string path = Path.Combine(directory, asset.Checksum.Substring(7) + extension);
            if (paths.ContainsKey(asset.AssetId)) throw new InvalidOperationException("asset-file-id-duplicated");
            Directory.CreateDirectory(directory);
            if (!File.Exists(path)) File.WriteAllBytes(path, bytes);
            paths.Add(asset.AssetId, path);
            lengths[path] = bytes.LongLength;
            return path;
        }

        private static string Extension(string mediaType)
        {
            switch (mediaType)
            {
                case "video/mp4": return ".mp4";
                case "font/ttf": return ".ttf";
                case "font/otf": return ".otf";
                case "model/gltf-binary": return ".glb";
                case "image/png": return ".png";
                default: throw new InvalidOperationException("asset-file-media-type-unsupported");
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            paths.Clear();
            lengths.Clear();
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}

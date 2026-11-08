using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationAssetPreloader
    {
        public const int MaximumConcurrentDownloads = 4;
        public const ulong MaximumInFlightEncodedBytes = 32UL * 1024 * 1024;

        public static async Task<IReadOnlyDictionary<string, string>> PreloadAsync(
            IReadOnlyList<AssetAccessBinding> assets, PresentationEncodedAssetCache.Lease lease,
            Func<AssetAccessBinding, CancellationToken, Task<byte[]>> download, CancellationToken token,
            Action<int, int> progress = null, int maximumConcurrentDownloads = MaximumConcurrentDownloads,
            ulong maximumInFlightEncodedBytes = MaximumInFlightEncodedBytes)
        {
            if (assets == null || lease == null || download == null) throw new ArgumentNullException();
            if (maximumConcurrentDownloads < 1 || maximumInFlightEncodedBytes == 0) throw new ArgumentOutOfRangeException();
            var paths = new Dictionary<string, string>(StringComparer.Ordinal);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var asset in assets)
                if (asset == null || string.IsNullOrEmpty(asset.AssetId) || asset.EncodedSizeBytes == 0 || !ids.Add(asset.AssetId))
                    throw new InvalidOperationException("asset-descriptor-conflict");
            using (var cancellation = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                int next = 0;
                while (next < assets.Count)
                {
                    token.ThrowIfCancellationRequested();
                    ulong bytes = 0;
                    var batch = new List<Task>();
                    while (next < assets.Count && batch.Count < maximumConcurrentDownloads)
                    {
                        AssetAccessBinding asset = assets[next];
                        // An oversized asset runs alone; subtracting avoids unsigned overflow.
                        if (batch.Count != 0 && (bytes >= maximumInFlightEncodedBytes
                            || asset.EncodedSizeBytes > maximumInFlightEncodedBytes - bytes)) break;
                        bytes = checked(bytes + asset.EncodedSizeBytes);
                        next++;
                        batch.Add(LoadAsync(asset));
                    }
                    await Task.WhenAll(batch);
                }
                token.ThrowIfCancellationRequested();
                return paths;

                async Task LoadAsync(AssetAccessBinding asset)
                {
                    try
                    {
                        string path = await lease.GetFileAsync(asset, download, cancellation.Token);
                        lock (paths)
                        {
                            paths.Add(asset.AssetId, path);
                            progress?.Invoke(paths.Count, assets.Count);
                        }
                    }
                    catch { cancellation.Cancel(); throw; }
                }
            }
        }
    }
}

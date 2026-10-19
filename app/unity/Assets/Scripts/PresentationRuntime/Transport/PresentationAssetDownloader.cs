using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationAssetDownloader
    {
        public static async Task<byte[]> DownloadAsync(HttpClient client, AssetAccessBinding access, CancellationToken token)
        {
            if (!Uri.TryCreate(access.Url, UriKind.Absolute, out Uri url) || url.Scheme != "https"
                || !string.IsNullOrEmpty(url.UserInfo) || access.ExpiresAtUnixMs <= (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                || access.EncodedSizeBytes == 0 || access.EncodedSizeBytes > MaximumAssetBytes(access.MediaType)) throw new InvalidOperationException("asset-download-access-invalid");
            using (HttpResponseMessage response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token))
            {
                if (!response.IsSuccessStatusCode || response.Content.Headers.ContentType?.MediaType != access.MediaType
                    || response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value != (long)access.EncodedSizeBytes)
                    throw new InvalidOperationException("asset-download-metadata-mismatch");
                byte[] bytes = new byte[(int)access.EncodedSizeBytes];
                using (System.IO.Stream stream = await response.Content.ReadAsStreamAsync())
                {
                    int offset = 0;
                    while (offset < bytes.Length)
                    {
                        int read = await stream.ReadAsync(bytes, offset, bytes.Length - offset, token);
                        if (read == 0) throw new InvalidOperationException("asset-download-incomplete");
                        offset += read;
                    }
                    byte[] excess = new byte[1];
                    if (await stream.ReadAsync(excess, 0, 1, token) != 0) throw new InvalidOperationException("asset-download-size-mismatch");
                }
                return bytes;
            }
        }

        private static ulong MaximumAssetBytes(string mediaType)
        {
            switch (mediaType)
            {
                case "image/png": return 17UL * 1024 * 1024;
                case "font/ttf":
                case "font/otf": return 32UL * 1024 * 1024;
                case "model/gltf-binary":
                case "video/mp4": return 256UL * 1024 * 1024;
                default: return 0;
            }
        }

    }
}

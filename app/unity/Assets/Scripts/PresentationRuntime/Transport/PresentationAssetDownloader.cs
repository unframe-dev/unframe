using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationAssetDownloader
    {
        public static HttpMessageHandler CreateHandler(Uri endpoint, string fingerprint)
        {
            var handler = new HttpClientHandler { AllowAutoRedirect = false };
            if (fingerprint != null)
            {
                if (endpoint.Scheme != "https" || !PresentationDeliveryCatalog.IsContentHash(fingerprint))
                    throw new InvalidOperationException("asset-download-endpoint-invalid");
                handler.ServerCertificateCustomValidationCallback = (request, certificate, chain, errors) =>
                    request.RequestUri.GetLeftPart(UriPartial.Authority) == endpoint.GetLeftPart(UriPartial.Authority)
                    && (errors & SslPolicyErrors.RemoteCertificateNameMismatch) == 0
                    && VerifyPinnedCertificate(certificate, fingerprint, DateTimeOffset.UtcNow);
            }
            return handler;
        }

        public static bool VerifyPinnedCertificate(X509Certificate2 certificate, string fingerprint, DateTimeOffset now)
        {
            if (certificate == null) return false;
            using (var sha = SHA256.Create())
            {
                string actual = "sha256:" + BitConverter.ToString(sha.ComputeHash(certificate.RawData)).Replace("-", "").ToLowerInvariant();
                return actual == fingerprint && now >= new DateTimeOffset(certificate.NotBefore.ToUniversalTime())
                    && now <= new DateTimeOffset(certificate.NotAfter.ToUniversalTime());
            }
        }

        public static async Task<byte[]> DownloadAsync(HttpClient client, AssetAccessBinding access, CancellationToken token,
            Uri venueEndpoint = null, string sessionId = null, Func<CancellationToken, Task<string>> bearerProvider = null)
        {
            if (!Uri.TryCreate(access.Url, UriKind.Absolute, out Uri url) || url.Scheme != "https"
                || !string.IsNullOrEmpty(url.UserInfo) || access.ExpiresAtUnixMs <= (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                || access.EncodedSizeBytes == 0 || access.EncodedSizeBytes > MaximumAssetBytes(access.MediaType)) throw new InvalidOperationException("asset-download-access-invalid");
            using (var request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                if (venueEndpoint != null)
                {
                    string path = "/sessions/" + Uri.EscapeDataString(sessionId) + "/assets/" + Uri.EscapeDataString(access.AssetId);
                    if (url.GetLeftPart(UriPartial.Authority) != venueEndpoint.GetLeftPart(UriPartial.Authority)
                        || url.AbsolutePath != path || !string.IsNullOrEmpty(url.Query) || !string.IsNullOrEmpty(url.Fragment)
                        || bearerProvider == null) throw new InvalidOperationException("asset-download-endpoint-invalid");
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await bearerProvider(token));
                }
                using (HttpResponseMessage response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token))
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

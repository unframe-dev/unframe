using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using UnityEngine;
using UnityEngine.Networking;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationPreviewAssetProvider
    {
        private sealed class BoundedDownload : DownloadHandlerScript
        {
            internal readonly byte[] Bytes;
            internal int Count;
            private bool invalidLength;
            internal BoundedDownload(int size) : base(new byte[Math.Min(size, 8192)]) { Bytes = new byte[size]; }
            protected override void ReceiveContentLengthHeader(ulong length) { invalidLength = length != (ulong)Bytes.Length; }
            protected override bool ReceiveData(byte[] data, int length)
            {
                if (invalidLength || data == null || length < 0 || length > Bytes.Length - Count) return false;
                Buffer.BlockCopy(data, 0, Bytes, Count, length);
                Count += length;
                return true;
            }
        }
        private readonly Dictionary<string, AssetAccessBinding> assets = new Dictionary<string, AssetAccessBinding>();
        private readonly string requestId;
        private readonly string bearer;

        public PresentationPreviewAssetProvider(PresentationLocalPreviewInput input, string bearer)
        {
            if (input == null || String.IsNullOrEmpty(bearer)) throw new ArgumentException("Preview input and bearer are required.");
            requestId = input.RequestId;
            this.bearer = bearer;
            foreach (KeyValuePair<string, string> reference in input.References)
                assets.Add(reference.Value, input.Assets[reference.Key]);
        }

        public async Task<PresentationPreviewAssetData> GetAsync(string requestedId, string reference, CancellationToken token)
        {
            if (requestedId != requestId || !assets.TryGetValue(reference, out AssetAccessBinding asset)
                || !Uri.TryCreate(Application.absoluteURL, UriKind.Absolute, out Uri document)
                || document.Scheme != "https" && document.Scheme != "http") throw new InvalidOperationException("preview.asset-reference-invalid");
            Uri url = new Uri(document, "/api/previews/" + requestId + "/assets/" + Uri.EscapeDataString(reference));
            using (var download = new BoundedDownload((int)asset.EncodedSizeBytes))
            using (var request = new UnityWebRequest(url, UnityWebRequest.kHttpVerbGET, download, null))
            {
                request.redirectLimit = 0;
                request.timeout = 30;
                request.SetRequestHeader("Authorization", "Bearer " + bearer);
                UnityWebRequestAsyncOperation operation = request.SendWebRequest();
                try
                {
                    while (!operation.isDone) { token.ThrowIfCancellationRequested(); await Task.Yield(); }
                    token.ThrowIfCancellationRequested();
                    string mediaType = request.GetResponseHeader("Content-Type")?.Split(';')[0].Trim();
                    if (request.result != UnityWebRequest.Result.Success || request.responseCode != 200
                        || mediaType != asset.MediaType || download.Count != download.Bytes.Length)
                        throw new InvalidOperationException("preview.asset-download-failed");
                    return new PresentationPreviewAssetData(download.Bytes, mediaType);
                }
                finally { if (!operation.isDone) request.Abort(); }
            }
        }
    }
}

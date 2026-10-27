using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationBakedRuntimeDownloadEditModeTests
{
    private sealed class Handler : HttpMessageHandler
    {
        private readonly byte[] bytes;
        private readonly string mediaType;
        private readonly long? contentLength;
        public int Requests { get; private set; }
        public Handler(byte[] bytes, string mediaType = "image/png", long? contentLength = null)
        {
            this.bytes = bytes;
            this.mediaType = mediaType;
            this.contentLength = contentLength;
        }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests++;
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StreamContent(new NonSeekableStream(bytes))
            };
            response.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType);
            response.Content.Headers.ContentLength = contentLength;
            return Task.FromResult(response);
        }
    }

    private sealed class NonSeekableStream : MemoryStream
    {
        public NonSeekableStream(byte[] bytes) : base(bytes) { }
        public override bool CanSeek { get { return false; } }
    }

    [Test]
    public async Task HttpsChunkedAssetAcceptsExactBoundedBytesWithoutContentLength()
    {
        byte[] bytes = { 1, 2, 3 };
        using (var client = new HttpClient(new Handler(bytes)))
        {
            var access = new AssetAccessBinding
            {
                Url = "https://assets.example.test/texture.png",
                MediaType = "image/png",
                EncodedSizeBytes = 3,
                ExpiresAtUnixMs = (ulong)DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeMilliseconds()
            };
            byte[] actual = await Download(client, access);
            Assert.That(actual, Is.EqualTo(bytes));
        }
    }

    [Test]
    public void AssetDownloadRejectsLoopbackHttpBeforeSending()
    {
        using (var client = new HttpClient(new Handler(new byte[] { 1 })))
        {
            var access = new AssetAccessBinding
            {
                Url = "http://127.0.0.1/texture.png",
                MediaType = "image/png",
                EncodedSizeBytes = 1,
                ExpiresAtUnixMs = (ulong)DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeMilliseconds()
            };
            var exception = Assert.ThrowsAsync<InvalidOperationException>(async () => await Download(client, access));
            Assert.That(exception.Message, Is.EqualTo("asset-download-access-invalid"));
        }
    }

    [TestCase(2, "asset-download-incomplete")]
    [TestCase(4, "asset-download-size-mismatch")]
    public void ChunkedAssetRejectsBodiesOutsideDeclaredSize(int actualSize, string code)
    {
        using (var client = new HttpClient(new Handler(new byte[actualSize])))
        {
            var exception = Assert.ThrowsAsync<InvalidOperationException>(async () => await Download(client, Access()));
            Assert.That(exception.Message, Is.EqualTo(code));
        }
    }

    [TestCase("video/mp4", null)]
    [TestCase("image/png", 2L)]
    public void AssetResponseMustMatchDeclaredMediaTypeAndLength(string mediaType, long? length)
    {
        using (var client = new HttpClient(new Handler(new byte[3], mediaType, length)))
        {
            var exception = Assert.ThrowsAsync<InvalidOperationException>(async () => await Download(client, Access()));
            Assert.That(exception.Message, Is.EqualTo("asset-download-metadata-mismatch"));
        }
    }

    [TestCase("image/png", 17825793UL)]
    [TestCase("font/ttf", 33554433UL)]
    [TestCase("font/otf", 33554433UL)]
    [TestCase("model/gltf-binary", 268435457UL)]
    [TestCase("video/mp4", 268435457UL)]
    [TestCase("application/octet-stream", 1UL)]
    [TestCase("image/png", 0UL)]
    public void InvalidAssetSizeOrMediaTypeIsRejectedBeforeSending(string mediaType, ulong size)
    {
        var handler = new Handler(new byte[0]);
        using (var client = new HttpClient(handler))
        {
            var access = Access();
            access.MediaType = mediaType;
            access.EncodedSizeBytes = size;
            var exception = Assert.ThrowsAsync<InvalidOperationException>(async () => await Download(client, access));
            Assert.That(exception.Message, Is.EqualTo("asset-download-access-invalid"));
            Assert.That(handler.Requests, Is.Zero);
        }
    }

    [Test]
    public void ExpiredAccessIsRejectedBeforeSending()
    {
        var handler = new Handler(new byte[0]);
        using (var client = new HttpClient(handler))
        {
            var access = Access();
            access.ExpiresAtUnixMs = (ulong)DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds();
            var exception = Assert.ThrowsAsync<InvalidOperationException>(async () => await Download(client, access));
            Assert.That(exception.Message, Is.EqualTo("asset-download-access-invalid"));
            Assert.That(handler.Requests, Is.Zero);
        }
    }

    private static AssetAccessBinding Access()
    {
        return new AssetAccessBinding
        {
            Url = "https://assets.example.test/texture.png",
            MediaType = "image/png",
            EncodedSizeBytes = 3,
            ExpiresAtUnixMs = (ulong)DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeMilliseconds()
        };
    }

    private static Task<byte[]> Download(HttpClient client, AssetAccessBinding access)
    {
        return PresentationAssetDownloader.DownloadAsync(client, access, CancellationToken.None);
    }
}

using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery.V2;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationBakedRuntimeDownloadEditModeTests
{
    private sealed class Handler : HttpMessageHandler
    {
        private readonly byte[] bytes;
        public Handler(byte[] bytes) { this.bytes = bytes; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StreamContent(new NonSeekableStream(bytes))
            };
            response.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
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

    private static Task<byte[]> Download(HttpClient client, AssetAccessBinding access)
    {
        MethodInfo method = typeof(PresentationBakedRuntime).GetMethod("DownloadAsync", BindingFlags.NonPublic | BindingFlags.Static);
        return (Task<byte[]>)method.Invoke(null, new object[] { client, access, CancellationToken.None });
    }
}

using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Unframe.ControlPlane;
using Unframe.ControlPlane.Api;
using Unframe.ControlPlane.Client;

var png = Convert.FromBase64String(
    "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAED0lEQVR4nO3BMQEAAADCoPVPbQdvoAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4DcC8AAB" +
    "2WfxiAAAAABJRU5ErkJggg==");
using var handler = new UploadHandler(png);
using var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.example.test") };
var api = new DefaultApi(
    NullLogger<DefaultApi>.Instance,
    NullLoggerFactory.Instance,
    http,
    new JsonSerializerOptionsProvider(new JsonSerializerOptions()),
    new DefaultApiEvents(),
    new FixedTokenProvider<ApiKeyToken>(new ApiKeyToken("session", ClientUtils.ApiKeyHeader.__Secure_better_auth_session_token)),
    new FixedTokenProvider<BearerToken>(new BearerToken("session")));

using var stream = new MemoryStream(png);
var response = await api.UsersMeImagePutAsync(new FileParameter(stream, "avatar.png"));
if (response.StatusCode != HttpStatusCode.OK || !handler.ReceivedUpload)
    throw new InvalidOperationException("The profile image upload did not complete.");
Console.WriteLine("C# profile image upload sends the original PNG bytes with image/png.");

sealed class FixedTokenProvider<T>(T token) : TokenProvider<T> where T : TokenBase
{
    protected override ValueTask<T> GetAsync(string header = "", CancellationToken cancellation = default) => new(token);
}

sealed class UploadHandler(byte[] expected) : HttpMessageHandler
{
    public bool ReceivedUpload { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method != HttpMethod.Put || request.RequestUri?.AbsolutePath != "/users/me/image")
            throw new InvalidOperationException("The profile image was sent to the wrong endpoint.");
        if (request.Content?.Headers.ContentType?.MediaType != "image/png")
            throw new InvalidOperationException("The upload must use image/png from the API contract.");
        var bytes = await request.Content.ReadAsByteArrayAsync(cancellationToken);
        if (!bytes.SequenceEqual(expected))
            throw new InvalidOperationException("The upload must contain the original PNG bytes, not serialized FileParameter metadata.");
        ReceivedUpload = true;
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"image\":\"https://api.example.test/avatar.png\"}")
        };
    }
}

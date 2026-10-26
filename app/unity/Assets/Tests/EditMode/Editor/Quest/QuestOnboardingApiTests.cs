using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

public sealed class QuestOnboardingApiTests
{
    private sealed class Handler : HttpMessageHandler
    {
        public string Path;
        public string Body;
        public string Response;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Path = request.RequestUri.AbsolutePath;
            Body = await request.Content.ReadAsStringAsync();
            Assert.That(request.Headers.Authorization, Is.Null);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Response) };
        }
    }

    [Test]
    public async Task DeviceAuthorizationUsesContractAndKeepsPendingIdentityUnauthenticated()
    {
        var handler = new Handler { Response = "{\"device_code\":\"secret\",\"user_code\":\"ABCD-EFGH\",\"verification_uri_complete\":\"https://web.example/device?user_code=ABCD-EFGH\",\"expires_in\":1800,\"interval\":3}" };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unframe-unity", handler))
        {
            var authorization = await api.BeginAuthorizationAsync(CancellationToken.None);
            Assert.That(handler.Path, Is.EqualTo("/api/auth/device/code"));
            Assert.That(handler.Body, Does.Contain("\"client_id\":\"unframe-unity\""));
            Assert.That(authorization.UserCode, Is.EqualTo("ABCD-EFGH"));
            Assert.That(api.IsAuthenticated, Is.False);
            Assert.That(await api.PollAuthorizationAsync(CancellationToken.None), Is.False);
            Assert.That(handler.Path, Is.EqualTo("/api/auth/device/code"), "Polling must respect the server interval.");
            Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None));
        }
    }

    [Test]
    public void DeviceAuthorizationRejectsApprovalUrlOutsideConfiguredWebOrigin()
    {
        var handler = new Handler { Response = "{\"device_code\":\"secret\",\"user_code\":\"ABCD-EFGH\",\"verification_uri_complete\":\"https://other.example/device?user_code=ABCD-EFGH\",\"expires_in\":1800,\"interval\":3}" };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unframe-unity", handler))
        {
            var error = Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.BeginAuthorizationAsync(CancellationToken.None));
            Assert.That(error.Code, Is.EqualTo("invalid-authorization-response"));
            Assert.That(api.IsAuthenticated, Is.False);
        }
    }
}

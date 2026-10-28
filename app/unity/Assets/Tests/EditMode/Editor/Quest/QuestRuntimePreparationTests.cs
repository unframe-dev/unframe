using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

public sealed class QuestRuntimePreparationTests
{
    private sealed class Service : HttpMessageHandler
    {
        public readonly List<string> Requests = new List<string>();
        public bool UnavailableOnce;
        public bool InvalidReady;
        public bool StartingAlways;
        public int PollFailure;
        private int preparations;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            string path = request.RequestUri.AbsolutePath;
            string body;
            var status = HttpStatusCode.OK;
            if (path == "/api/auth/device/code")
                body = "{\"device_code\":\"fixture-device\",\"user_code\":\"ABCD-EFGH\",\"verification_uri_complete\":\"https://web.example/device?user_code=ABCD-EFGH\",\"expires_in\":300,\"interval\":1}";
            else if (path == "/api/auth/device/token")
                body = "{\"access_token\":\"fixture-credential\",\"token_type\":\"Bearer\",\"expires_in\":300}";
            else
            {
                Requests.Add(request.Method + " " + path);
                Assert.That(request.Headers.Authorization?.ToString(), Is.EqualTo("Bearer fixture-credential"));
                Assert.That(path, Is.EqualTo("/sessions/room-1/runtime-preparation"));
                preparations++;
                if (request.Method == HttpMethod.Get && PollFailure != 0)
                {
                    status = (HttpStatusCode)PollFailure;
                    body = "{\"error\":{\"code\":\"forbidden\"}}";
                }
                else if (UnavailableOnce && preparations == 1)
                {
                    status = HttpStatusCode.Conflict;
                    body = "{\"error\":{\"code\":\"runtime_unavailable\",\"message\":\"unavailable\"}}";
                }
                else
                {
                    string state = StartingAlways || preparations == 1 ? "starting" : "ready";
                    body = "{\"state\":\"" + state + "\",\"runtimeId\":\"runtime-1\",\"assignmentEpoch\":" + (InvalidReady ? "0" : "1") + ",\"leaseExpiresAt\":\"2099-01-01T00:00:00Z\"}";
                }
            }
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
        }
    }

    private static async Task Authenticate(QuestOnboardingApi api)
    {
        await api.BeginAuthorizationAsync(CancellationToken.None);
        await Task.Delay(1100);
        Assert.That(await api.PollAuthorizationAsync(CancellationToken.None), Is.True);
    }

    [Test]
    public async Task RuntimePreparationRequestsAssignmentThenPollsUntilReady()
    {
        var service = new Service();
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", service))
        {
            await Authenticate(api);
            await api.PrepareRuntimeAsync("room-1", CancellationToken.None);
            Assert.That(service.Requests, Is.EqualTo(new[] { "POST /sessions/room-1/runtime-preparation", "GET /sessions/room-1/runtime-preparation" }));
        }
    }

    [Test]
    public async Task MissingHostAllowsPreparationToRetryTheExistingRoom()
    {
        var service = new Service { UnavailableOnce = true };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", service))
        {
            await Authenticate(api);
            Exception failure = null;
            try { await api.PrepareRuntimeAsync("room-1", CancellationToken.None); }
            catch (Exception exception) { failure = exception; }
            Assert.That(failure, Is.TypeOf<QuestOnboardingApiException>());
            Assert.That(((QuestOnboardingApiException)failure).Code, Is.EqualTo("runtime-unavailable"));
            await api.PrepareRuntimeAsync("room-1", CancellationToken.None);
            Assert.That(service.Requests, Is.EqualTo(new[] { "POST /sessions/room-1/runtime-preparation", "POST /sessions/room-1/runtime-preparation" }));
        }
    }

    [Test]
    public async Task InvalidAssignmentCannotCompleteRuntimePreparation()
    {
        var service = new Service { InvalidReady = true };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", service))
        {
            await Authenticate(api);
            Exception failure = null;
            try { await api.PrepareRuntimeAsync("room-1", CancellationToken.None); }
            catch (Exception exception) { failure = exception; }
            Assert.That(failure, Is.TypeOf<QuestOnboardingApiException>());
            Assert.That(((QuestOnboardingApiException)failure).Code, Is.EqualTo("invalid-response"));
        }
    }

    [TestCase(401, "authentication-required")]
    [TestCase(403, "forbidden")]
    public async Task PollAuthorizationFailureStopsWithoutFurtherRequests(int status, string code)
    {
        var service = new Service { PollFailure = status };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", service))
        {
            await Authenticate(api);
            Exception failure = null;
            try { await api.PrepareRuntimeAsync("room-1", CancellationToken.None); }
            catch (Exception exception) { failure = exception; }
            Assert.That(failure, Is.TypeOf<QuestOnboardingApiException>());
            Assert.That(((QuestOnboardingApiException)failure).Code, Is.EqualTo(code));
            await Task.Delay(300);
            Assert.That(service.Requests.Count, Is.EqualTo(2));
            if (status == 401) Assert.That(api.IsAuthenticated, Is.False);
        }
    }

    [Test]
    public async Task CancellationWhileStartingDoesNotContinuePolling()
    {
        var service = new Service { StartingAlways = true };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", service))
        using (var cancellation = new CancellationTokenSource())
        {
            await Authenticate(api);
            cancellation.CancelAfter(50);
            Exception failure = null;
            try { await api.PrepareRuntimeAsync("room-1", cancellation.Token); }
            catch (Exception exception) { failure = exception; }
            Assert.That(failure, Is.InstanceOf<OperationCanceledException>());
            await Task.Delay(300);
            Assert.That(service.Requests.Count, Is.EqualTo(1));
        }
    }
}

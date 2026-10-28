using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

public sealed class QuestOnboardingStartApiTests
{
    private sealed class Handler : HttpMessageHandler
    {
        public string State = "Waiting";
        public bool LoseResponse, Conflict;
        public readonly List<string> Requests = new List<string>();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Requests.Add(request.Method.Method + " " + request.RequestUri.AbsolutePath);
            Assert.That(request.Headers.Authorization?.Scheme, Is.EqualTo("Bearer"));
            if (request.Method == HttpMethod.Post)
            {
                State = "Presenting";
                if (LoseResponse) { LoseResponse = false; throw new HttpRequestException("response-lost"); }
                if (Conflict) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Conflict));
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"id\":\"session\",\"state\":\"" + State + "\"}") });
        }
    }
    private static QuestOnboardingApi Create(Handler handler)
    {
        var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler);
        var flags = BindingFlags.Instance | BindingFlags.NonPublic;
        typeof(QuestOnboardingApi).GetField("credential", flags).SetValue(api, "test-token");
        typeof(QuestOnboardingApi).GetField("credentialExpiresAt", flags).SetValue(api, DateTimeOffset.UtcNow.AddHours(1));
        return api;
    }
    [Test]
    public async Task LostStartResponseCanRetryWithoutStartingTwice()
    {
        var handler = new Handler { LoseResponse = true };
        using (var api = Create(handler))
        {
            Assert.ThrowsAsync<HttpRequestException>(() => api.StartSessionAsync("session", CancellationToken.None));
            await api.StartSessionAsync("session", CancellationToken.None);
            Assert.That(handler.Requests.FindAll(value => value.StartsWith("POST")).Count, Is.EqualTo(1));
        }
    }
    [Test]
    public async Task ConcurrentStartConflictRereadsThePresentingState()
    {
        var handler = new Handler { Conflict = true };
        using (var api = Create(handler)) await api.StartSessionAsync("session", CancellationToken.None);
        Assert.That(handler.Requests, Is.EqualTo(new[] { "GET /sessions/session", "POST /sessions/session/start", "GET /sessions/session" }));
    }
    [TestCase("Ended")]
    [TestCase("invalid")]
    public void EndedOrInvalidSessionCannotBeStarted(string state)
    {
        var handler = new Handler { State = state };
        using (var api = Create(handler)) Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.StartSessionAsync("session", CancellationToken.None));
        Assert.That(handler.Requests, Is.EqualTo(new[] { "GET /sessions/session" }));
    }
}

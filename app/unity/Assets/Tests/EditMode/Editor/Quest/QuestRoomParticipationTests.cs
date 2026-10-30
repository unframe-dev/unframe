using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestRoomParticipationTests
{
    private sealed class Store : IQuestCredentialStore
    {
        public readonly Dictionary<string, QuestAccountCredential> Records = new Dictionary<string, QuestAccountCredential>();
        public QuestAccountCredential Load(string scope) => Records.TryGetValue(scope, out var value) ? value : null;
        public void Save(string scope, QuestAccountCredential value) => Records[scope] = value;
        public void Delete(string scope) => Records.Remove(scope);
    }

    [Test]
    public async Task RestoresTheAccountCredentialOnlyForTheConfiguredOriginAndClient()
    {
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("saved-account", DateTimeOffset.UtcNow.AddHours(1)));
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", credentialStore: store))
        {
            Assert.That(api.IsAuthenticated, Is.True);
            Assert.That(await api.CredentialAsync(CancellationToken.None), Is.EqualTo("saved-account"));
        }
        using (var other = new QuestOnboardingApi(new Uri("https://other.example"), new Uri("https://web.example"), "unity", credentialStore: store))
            Assert.That(other.IsAuthenticated, Is.False);
        using (var otherClient = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "other", credentialStore: store))
            Assert.That(otherClient.IsAuthenticated, Is.False);
    }

    private sealed class Handler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Respond;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
            => Task.FromResult(Respond(request));
    }

    private static HttpResponseMessage Json(string value, HttpStatusCode status = HttpStatusCode.OK)
        => new HttpResponseMessage(status) { Content = new StringContent(value) };

    [Test]
    public async Task ListsOwnedRoomsWithTheServerCursorAndAccountCredential()
    {
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("saved-account", DateTimeOffset.UtcNow.AddHours(1)));
        var handler = new Handler
        {
            Respond = request =>
        {
            Assert.That(request.Method, Is.EqualTo(HttpMethod.Get));
            Assert.That(request.RequestUri.PathAndQuery, Is.EqualTo("/sessions?limit=20&cursor=room-before"));
            Assert.That(request.Headers.Authorization?.Parameter, Is.EqualTo("saved-account"));
            return Json("{\"sessions\":[{\"id\":\"console-room\",\"presentationId\":\"p1\",\"state\":\"Waiting\"}],\"nextCursor\":\"console-room\"}");
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store))
        {
            var page = await api.ListRoomsAsync(CancellationToken.None, "room-before");
            Assert.That(page.Rooms[0].SessionId, Is.EqualTo("console-room"));
            Assert.That(page.NextCursor, Is.EqualTo("console-room"));
        }
    }

    [Test]
    public void PresenterPaginationShowsEveryRoomAcrossServerPageBoundaries()
    {
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("saved-account", DateTimeOffset.UtcNow.AddHours(1)));
        var handler = new Handler
        {
            Respond = request =>
        {
            bool more = request.RequestUri.Query.Contains("cursor=");
            var rooms = new List<string>();
            for (int i = more ? 20 : 0; i < (more ? 23 : 20); i++)
                rooms.Add("{\"id\":\"room-" + i + "\",\"state\":\"Waiting\",\"presentationId\":\"p1\"}");
            return Json("{\"sessions\":[" + string.Join(",", rooms) + "],\"nextCursor\":" + (more ? "null" : "\"room-19\"") + "}");
        }
        };
        var host = new GameObject("Room pagination");
        var head = new GameObject("Head");
        try
        {
            var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store);
            var view = host.AddComponent<QuestOnboardingView>();
            view.Configure(null, null, null, head.transform, api);
            view.FindButton("Presenter").onClick.Invoke();
            var displayed = new List<string>();
            do
            {
                foreach (var button in view.Panel.GetComponentsInChildren<UnityEngine.UI.Button>())
                    if (button.name.StartsWith("Room ")) displayed.Add(button.name);
                var next = view.FindButton("MoreRooms");
                if (next == null) break;
                next.onClick.Invoke();
            } while (displayed.Count < 30);
            Assert.That(displayed, Is.EqualTo(new[] { "Room 0", "Room 1", "Room 2", "Room 3", "Room 4", "Room 5", "Room 6", "Room 7", "Room 8", "Room 9", "Room 10", "Room 11", "Room 12", "Room 13", "Room 14", "Room 15", "Room 16", "Room 17", "Room 18", "Room 19", "Room 20", "Room 21", "Room 22" }));
        }
        finally { UnityEngine.Object.DestroyImmediate(host); UnityEngine.Object.DestroyImmediate(head); }
    }

    [Test]
    public async Task AnonymousParticipationUsesSeparateCredentialsAndRevokesOnLeave()
    {
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("saved-account", DateTimeOffset.UtcNow.AddHours(1)));
        var requests = new List<string>();
        var handler = new Handler
        {
            Respond = request =>
        {
            string path = request.RequestUri.AbsolutePath;
            requests.Add(request.Method + " " + path);
            if (path == "/viewer-credentials" && request.Method == HttpMethod.Post)
            {
                Assert.That(request.Headers.Authorization, Is.Null);
                return Json("{\"token\":\"viewer_anonymous\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"sessionId\":\"shared-room\",\"participantId\":\"anonymous_one\"}", HttpStatusCode.Created);
            }
            Assert.That(request.Headers.Authorization?.Parameter, Is.EqualTo("viewer_anonymous"));
            if (request.Method == HttpMethod.Delete) return Json("{}", HttpStatusCode.NoContent);
            Assert.That(path, Is.EqualTo("/sessions/shared-room"));
            return Json("{\"id\":\"shared-room\",\"state\":\"Presenting\",\"presentationId\":\"p1\"}");
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store))
        {
            var room = await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            Assert.That(room.SessionId, Is.EqualTo("shared-room"));
            Assert.That(await api.ViewerCredentialAsync(room.SessionId, CancellationToken.None), Is.EqualTo("viewer_anonymous"));
            Assert.That(await api.CredentialAsync(CancellationToken.None), Is.EqualTo("saved-account"));
            await api.LeaveViewerAsync(CancellationToken.None);
            Assert.That(requests, Is.EqualTo(new[] { "POST /viewer-credentials", "GET /sessions/shared-room", "DELETE /viewer-credentials" }));
            Assert.That(store.Records["https://api.example/|unity"].token, Is.EqualTo("saved-account"));
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task FailedRevocationIsRetriedBeforeAnotherParticipantCanBeIssued(bool timeout)
    {
        int issued = 0, deletions = 0;
        var revoked = new List<string>();
        var handler = new Handler
        {
            Respond = request =>
        {
            if (request.Method == HttpMethod.Delete)
            {
                revoked.Add(request.Headers.Authorization.Parameter);
                if (++deletions < 3)
                {
                    if (timeout) throw new TaskCanceledException("Network timeout");
                    return Json("{}", HttpStatusCode.ServiceUnavailable);
                }
                return Json("{}", HttpStatusCode.NoContent);
            }
            if (request.RequestUri.AbsolutePath == "/viewer-credentials")
                return Json(ViewerJson("viewer_" + ++issued, DateTimeOffset.UtcNow.AddHours(1)), HttpStatusCode.Created);
            return Json("{\"id\":\"shared-room\",\"state\":\"Waiting\",\"presentationId\":\"p1\"}");
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler))
        {
            await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            await api.LeaveViewerAsync(CancellationToken.None);
            Assert.That(api.HasViewerCredential("shared-room"), Is.False);
            var error = Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None));
            Assert.That(error.Code, Is.EqualTo("viewer-revocation-pending"));
            Assert.That(issued, Is.EqualTo(1));
            await api.LeaveViewerAsync(CancellationToken.None);
            Assert.That(revoked, Is.EqualTo(new[] { "viewer_1", "viewer_1", "viewer_1" }));
            await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            Assert.That(issued, Is.EqualTo(2));
        }
    }

    [TestCase(HttpStatusCode.Unauthorized)]
    [TestCase(HttpStatusCode.Gone)]
    public async Task AlreadyInvalidRevocationDoesNotBlockAnotherJoin(HttpStatusCode status)
    {
        int issued = 0;
        var handler = new Handler
        {
            Respond = request =>
        {
            if (request.Method == HttpMethod.Delete) return Json("{}", status);
            if (request.RequestUri.AbsolutePath == "/viewer-credentials")
                return Json(ViewerJson("viewer_" + ++issued, DateTimeOffset.UtcNow.AddHours(1)), HttpStatusCode.Created);
            return Json("{\"id\":\"shared-room\",\"state\":\"Waiting\",\"presentationId\":\"p1\"}");
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler))
        {
            await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            await api.LeaveViewerAsync(CancellationToken.None);
            await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            Assert.That(issued, Is.EqualTo(2));
        }
    }

    [Test]
    public void AnonymousViewerCanConfirmARoomWithoutDeviceAuthorization()
    {
        var host = new GameObject("Anonymous onboarding");
        var head = new GameObject("Head");
        var handler = new Handler { Respond = request => throw new InvalidOperationException("No HTTP before confirmation") };
        try
        {
            var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler);
            var view = host.AddComponent<QuestOnboardingView>();
            view.Configure(null, null, null, head.transform, api);
            view.FindButton("Audience").onClick.Invoke();
            foreach (char letter in "ABCDEFGH") view.FindButton("Key " + letter).onClick.Invoke();
            view.FindButton("Continue").onClick.Invoke();
            Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Join));
            Assert.That(view.FindButton("Authorize"), Is.Null);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); UnityEngine.Object.DestroyImmediate(head); }
    }

    private static string ViewerJson(string token, DateTimeOffset expiry) => "{\"token\":\"" + token + "\",\"expiresAt\":\"" + expiry.ToString("O") + "\",\"sessionId\":\"shared-room\",\"participantId\":\"anonymous_one\"}";

    [Test]
    public async Task SavesAnApprovedAccountAndRestoresItAfterRestart()
    {
        var time = DateTimeOffset.UtcNow;
        var store = new Store();
        var handler = new Handler
        {
            Respond = request => request.RequestUri.AbsolutePath.EndsWith("/code")
            ? Json("{\"device_code\":\"temporary-device-code\",\"user_code\":\"ABCD-EFGH\",\"verification_uri_complete\":\"https://web.example/device?user_code=ABCD-EFGH\",\"expires_in\":300,\"interval\":1}")
            : Json("{\"access_token\":\"approved-account\",\"token_type\":\"Bearer\",\"expires_in\":3600}")
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store, now: () => time))
        {
            await api.BeginAuthorizationAsync(CancellationToken.None);
            time = time.AddSeconds(1);
            Assert.That(await api.PollAuthorizationAsync(CancellationToken.None), Is.True);
        }
        Assert.That(store.Records["https://api.example/|unity"].token, Is.EqualTo("approved-account"));
        Assert.That(store.Records["https://api.example/|unity"].expiresAt, Is.EqualTo(time.AddHours(1).ToUnixTimeSeconds()));
        using (var restored = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", credentialStore: store, now: () => time))
            Assert.That(await restored.CredentialAsync(CancellationToken.None), Is.EqualTo("approved-account"));
    }

    [Test]
    public void RemovesExpiredSavedCredentialsOnLoadAndWhileRunning()
    {
        var time = DateTimeOffset.UtcNow;
        var store = new Store();
        const string scope = "https://api.example/|unity";
        store.Save(scope, new QuestAccountCredential("expired-account", time.AddSeconds(-1)));
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", credentialStore: store, now: () => time))
            Assert.That(api.IsAuthenticated, Is.False);
        Assert.That(store.Records, Is.Empty);
        store.Save(scope, new QuestAccountCredential("expiring-account", time.AddSeconds(10)));
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", credentialStore: store, now: () => time))
        {
            time = time.AddSeconds(11);
            Assert.That(api.IsAuthenticated, Is.False);
            Assert.That(store.Records, Is.Empty);
        }
    }

    [Test]
    public void AnAccount401DeletesTheSavedCredential()
    {
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("revoked-account", DateTimeOffset.UtcNow.AddHours(1)));
        var handler = new Handler { Respond = request => Json("{}", HttpStatusCode.Unauthorized) };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store))
        {
            var error = Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.ListRoomsAsync(CancellationToken.None));
            Assert.That(error.Code, Is.EqualTo("authentication-required"));
            Assert.That(api.IsAuthenticated, Is.False);
            Assert.That(store.Records, Is.Empty);
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task ViewerRefreshExchangesOnlyItsOwnCredentialAndPreservesTheAccount(bool rejected)
    {
        var time = DateTimeOffset.UtcNow;
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("saved-account", time.AddHours(1)));
        string revoked = null;
        var handler = new Handler
        {
            Respond = request =>
        {
            string path = request.RequestUri.AbsolutePath;
            if (request.Method == HttpMethod.Delete) { revoked = request.Headers.Authorization?.Parameter; return Json("{}", HttpStatusCode.NoContent); }
            if (path == "/viewer-credentials") { Assert.That(request.Headers.Authorization, Is.Null); return Json(ViewerJson("viewer_original", time.AddSeconds(60)), HttpStatusCode.Created); }
            Assert.That(request.Headers.Authorization?.Parameter, Is.EqualTo("viewer_original"));
            if (path.EndsWith("/refresh")) return rejected ? Json("{}", HttpStatusCode.Unauthorized) : Json(ViewerJson("viewer_renewed", time.AddHours(1)));
            return Json("{\"id\":\"shared-room\",\"state\":\"Waiting\",\"presentationId\":\"p1\"}");
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store, now: () => time))
        {
            await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            time = time.AddSeconds(31);
            if (rejected)
            {
                var error = Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.ViewerCredentialAsync("shared-room", CancellationToken.None));
                Assert.That(error.Code, Is.EqualTo("viewer-authentication-required"));
                Assert.That(revoked, Is.EqualTo("viewer_original"));
            }
            else
            {
                Assert.That(await api.ViewerCredentialAsync("shared-room", CancellationToken.None), Is.EqualTo("viewer_renewed"));
                await api.LeaveViewerAsync(CancellationToken.None);
                Assert.That(revoked, Is.EqualTo("viewer_renewed"));
            }
            Assert.That(api.IsAuthenticated, Is.True);
            Assert.That(store.Records["https://api.example/|unity"].token, Is.EqualTo("saved-account"));
        }
    }

    [Test]
    public void RevokesAnIssuedViewerCredentialWhenInitialRoomLoadingFails()
    {
        bool revoked = false;
        var handler = new Handler
        {
            Respond = request =>
        {
            if (request.Method == HttpMethod.Delete) { revoked = true; return Json("{}", HttpStatusCode.NoContent); }
            return request.RequestUri.AbsolutePath == "/viewer-credentials"
                ? Json(ViewerJson("viewer_failed", DateTimeOffset.UtcNow.AddHours(1)), HttpStatusCode.Created)
                : Json("{}", HttpStatusCode.NotFound);
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler))
        {
            Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None));
            Assert.That(revoked, Is.True);
            Assert.That(api.HasViewerCredential("shared-room"), Is.False);
        }
    }

    private sealed class DeferredHandler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Respond;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Respond(request, token);
    }

    [Test]
    public void InvalidCredentialsReleaseTheirLeaseBeforeAnyHttpRequest()
    {
        bool released = false;
        var connection = new PresentationControlPlaneConnection(new Uri("https://api.example"), "shared-room",
            _ => Task.FromResult("unused"), credentialLeaseProvider: _ => Task.FromResult(new PresentationCredentialLease(string.Empty, () => released = true)));
        using (var client = new HttpClient(new Handler { Respond = _ => throw new AssertionException("Invalid credentials must not reach HTTP") }))
            Assert.ThrowsAsync<PresentationConnectionException>(() => connection.LoadDeliveryAsync(client, CancellationToken.None));
        Assert.That(released, Is.True);
    }

    [TestCase("response")]
    [TestCase("send")]
    [TestCase("cancel")]
    public async Task ViewerRenewalWaitsForAnAuthenticatedRequestAndItsLeaseIsReleasedOnFailure(string failure)
    {
        var time = DateTimeOffset.UtcNow;
        bool refreshed = false;
        var handler = new Handler
        {
            Respond = request =>
        {
            if (request.Method == HttpMethod.Delete) return Json("{}", HttpStatusCode.NoContent);
            if (request.RequestUri.AbsolutePath.EndsWith("/refresh"))
            { refreshed = true; return Json(ViewerJson("viewer_renewed", time.AddHours(1))); }
            if (request.RequestUri.AbsolutePath == "/viewer-credentials")
                return Json(ViewerJson("viewer_original", time.AddMinutes(1)), HttpStatusCode.Created);
            return Json("{\"id\":\"shared-room\",\"state\":\"Waiting\",\"presentationId\":\"p1\"}");
        }
        };
        var started = new TaskCompletionSource<bool>();
        var finish = new TaskCompletionSource<HttpResponseMessage>();
        var deliveryHandler = new DeferredHandler
        {
            Respond = (request, token) =>
        {
            Assert.That(request.Headers.Authorization.Parameter, Is.EqualTo("viewer_original"));
            started.TrySetResult(true);
            return DelayedResponse(finish.Task, token);
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, now: () => time))
        using (var client = new HttpClient(deliveryHandler))
        using (var cancellation = new CancellationTokenSource())
        {
            await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            var connection = new PresentationControlPlaneConnection(api.Origin, "shared-room",
                token => api.ViewerCredentialAsync("shared-room", token),
                credentialLeaseProvider: token => api.AcquireViewerCredentialAsync("shared-room", token));
            Task delivery = connection.LoadDeliveryAsync(client, cancellation.Token);
            await started.Task;
            time = time.AddSeconds(31);
            Task<string> renewal = api.ViewerCredentialAsync("shared-room", CancellationToken.None);
            bool rotatedDuringRequest = refreshed;
            if (failure == "cancel") cancellation.Cancel();
            else if (failure == "send") finish.SetException(new HttpRequestException("Connection lost"));
            else finish.SetResult(Json("{}"));
            try { await delivery; Assert.Fail("Invalid delivery must fail"); }
            catch (PresentationConnectionException) { }
            catch (HttpRequestException) { }
            catch (OperationCanceledException) { }
            Assert.That(await Task.WhenAny(renewal, Task.Delay(5000)), Is.SameAs(renewal), "A failed request must release its credential lease.");
            Assert.That(await renewal, Is.EqualTo("viewer_renewed"));
            Assert.That(rotatedDuringRequest, Is.False, "Rotation must wait until the request finishes using its bearer.");
        }
    }

    [Test]
    public async Task RevokesACredentialFromALateIssuanceResponseAfterCancellation()
    {
        var issued = new TaskCompletionSource<HttpResponseMessage>();
        bool revoked = false;
        var handler = new DeferredHandler
        {
            Respond = (request, token) =>
        {
            if (request.Method == HttpMethod.Delete) { revoked = true; return Task.FromResult(Json("{}", HttpStatusCode.NoContent)); }
            return issued.Task;
        }
        };
        using (var cancellation = new CancellationTokenSource())
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler))
        {
            Task joining = api.JoinSessionAsync("ABCD-EFGH", cancellation.Token);
            cancellation.Cancel();
            issued.SetResult(Json(ViewerJson("viewer_cancelled", DateTimeOffset.UtcNow.AddHours(1)), HttpStatusCode.Created));
            try { await joining; Assert.Fail("A cancelled join must not succeed"); }
            catch (OperationCanceledException) { }
            Assert.That(revoked, Is.True);
            Assert.That(api.HasViewerCredential("shared-room"), Is.False);
        }
    }

    [Test]
    public void PresenterCanSelectAnExistingRoomAndStillChooseNewRoomCreation()
    {
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("saved-account", DateTimeOffset.UtcNow.AddHours(1)));
        var handler = new Handler
        {
            Respond = request =>
        {
            Assert.That(request.Method, Is.EqualTo(HttpMethod.Get));
            Assert.That(request.Headers.Authorization?.Parameter, Is.EqualTo("saved-account"));
            switch (request.RequestUri.AbsolutePath)
            {
                case "/sessions": return Json("{\"sessions\":[{\"id\":\"console-room\",\"state\":\"Presenting\",\"presentationId\":\"p1\"}],\"nextCursor\":null}");
                case "/sessions/console-room": return Json("{\"id\":\"console-room\",\"state\":\"Presenting\",\"presentationId\":\"p1\"}");
                case "/sessions/console-room/join-code": return Json("{\"joinCode\":\"ABCD-EFGH\"}");
                case "/presentations": return Json("{\"presentations\":[{\"id\":\"p1\",\"name\":\"Published deck\"}]}");
                default: throw new InvalidOperationException("Unexpected request");
            }
        }
        };
        var host = new GameObject("Presenter onboarding");
        var head = new GameObject("Head");
        try
        {
            var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store);
            var view = host.AddComponent<QuestOnboardingView>();
            view.Configure(null, null, null, head.transform, api);
            view.FindButton("Presenter").onClick.Invoke();
            Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Rooms));
            view.FindButton("Room 0").onClick.Invoke();
            Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Preparation));
            Assert.That(view.SharedRoomCode, Is.EqualTo("ABCDEFGH"));
            view.FindButton("Back").onClick.Invoke();
            view.FindButton("NewRoom").onClick.Invoke();
            Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Presentations));
            view.FindButton("Presentation 0").onClick.Invoke();
            Assert.That(view.Flow.Page, Is.EqualTo(QuestOnboardingPage.Preparation));
        }
        finally { UnityEngine.Object.DestroyImmediate(host); UnityEngine.Object.DestroyImmediate(head); }
    }

    private static async Task<HttpResponseMessage> DelayedResponse(Task<HttpResponseMessage> response, CancellationToken token)
    {
        var cancelled = new TaskCompletionSource<HttpResponseMessage>();
        using (token.Register(() => cancelled.TrySetCanceled()))
            return await await Task.WhenAny(response, cancelled.Task);
    }

    [Test]
    public async Task DisposalCollectsAndRevokesALateIssuedCredential()
    {
        var issued = new TaskCompletionSource<HttpResponseMessage>();
        bool revoked = false;
        var handler = new DeferredHandler
        {
            Respond = (request, token) =>
        {
            if (request.Method == HttpMethod.Delete) { revoked = true; return Task.FromResult(Json("{}", HttpStatusCode.NoContent)); }
            return DelayedResponse(issued.Task, token);
        }
        };
        var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler);
        Task joining = api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
        api.Dispose();
        issued.SetResult(Json(ViewerJson("viewer_disposed", DateTimeOffset.UtcNow.AddHours(1)), HttpStatusCode.Created));
        try { await joining; Assert.Fail("A disposed API must not accept a late join"); }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        Assert.That(revoked, Is.True);
    }

    [Test]
    public async Task LeavingDuringRenewalRevokesTheReturnedReplacementCredential()
    {
        var renewed = new TaskCompletionSource<HttpResponseMessage>();
        var started = new TaskCompletionSource<bool>();
        string revoked = null;
        var handler = new DeferredHandler
        {
            Respond = (request, token) =>
        {
            if (request.Method == HttpMethod.Delete)
            {
                revoked = request.Headers.Authorization?.Parameter;
                return Task.FromResult(Json("{}", revoked == "viewer_replacement" ? HttpStatusCode.NoContent : HttpStatusCode.Unauthorized));
            }
            if (request.RequestUri.AbsolutePath.EndsWith("/refresh"))
            {
                started.TrySetResult(true);
                return DelayedResponse(renewed.Task, token);
            }
            return Task.FromResult(request.RequestUri.AbsolutePath == "/viewer-credentials"
                ? Json(ViewerJson("viewer_original", DateTimeOffset.UtcNow.AddSeconds(2)), HttpStatusCode.Created)
                : Json("{\"id\":\"shared-room\",\"state\":\"Waiting\",\"presentationId\":\"p1\"}"));
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler))
        {
            await api.JoinSessionAsync("ABCD-EFGH", CancellationToken.None);
            Assert.That(await Task.WhenAny(started.Task, Task.Delay(5000)), Is.SameAs(started.Task));
            Task leaving = api.LeaveViewerAsync(CancellationToken.None);
            await Task.Delay(50);
            bool leftBeforeResponse = leaving.IsCompleted;
            renewed.SetResult(Json(ViewerJson("viewer_replacement", DateTimeOffset.UtcNow.AddHours(1))));
            await leaving;
            Assert.That(leftBeforeResponse, Is.False);
            Assert.That(revoked, Is.EqualTo("viewer_replacement"));
            Assert.That(api.HasViewerCredential("shared-room"), Is.False);
        }
    }

    [Test]
    public void JoiningAgainStopsThePreviousConnectionBeforeIssuingANewParticipant()
    {
        var host = new GameObject("Retry join");
        var head = new GameObject("Head");
        var entry = host.AddComponent<QuestPresentationEntry>();
        var session = host.AddComponent<QuestPresentationSession>();
        bool stoppedAtIssuance = false;
        var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
        typeof(QuestPresentationEntry).GetField("lifetime", flags).SetValue(entry, new CancellationTokenSource());
        typeof(QuestPresentationSession).GetField("entry", flags).SetValue(session, entry);
        var handler = new Handler
        {
            Respond = request =>
        {
            stoppedAtIssuance = !entry.IsRunning;
            return Json("{}", HttpStatusCode.ServiceUnavailable);
        }
        };
        try
        {
            var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler);
            var view = host.AddComponent<QuestOnboardingView>();
            view.Configure(session, entry, null, head.transform, api);
            view.Flow.SelectRole(QuestOnboardingRole.Audience);
            view.Flow.GoTo(QuestOnboardingPage.Join);
            typeof(QuestOnboardingView).GetField("roomCode", flags).SetValue(view, "ABCDEFGH");
            typeof(QuestOnboardingView).GetField("ownsConnection", flags).SetValue(view, true);
            view.Refresh();
            view.FindButton("Join").onClick.Invoke();
            Assert.That(stoppedAtIssuance, Is.True);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); UnityEngine.Object.DestroyImmediate(head); }
    }

    [Test]
    public async Task CreatingANewRoomUsesTheAuthenticatedAccountAndRetainsItsInvitation()
    {
        var store = new Store();
        store.Save("https://api.example/|unity", new QuestAccountCredential("saved-account", DateTimeOffset.UtcNow.AddHours(1)));
        var handler = new Handler
        {
            Respond = request =>
        {
            Assert.That(request.Method, Is.EqualTo(HttpMethod.Post));
            Assert.That(request.RequestUri.AbsolutePath, Is.EqualTo("/sessions"));
            Assert.That(request.Headers.Authorization?.Parameter, Is.EqualTo("saved-account"));
            return Json("{\"session\":{\"id\":\"new-room\",\"presentationId\":\"p1\",\"state\":\"Waiting\"},\"joinCode\":\"ABCD-EFGH\"}", HttpStatusCode.Created);
        }
        };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unity", handler, credentialStore: store))
        {
            var room = await api.CreateSessionAsync("p1", CancellationToken.None);
            Assert.That(room.SessionId, Is.EqualTo("new-room"));
            Assert.That(room.JoinCode, Is.EqualTo("ABCD-EFGH"));
            Assert.That(room.State, Is.EqualTo("Waiting"));
        }
    }

    [Test]
    public void CredentialJavaPluginIsIncludedForAndroidAndExcludedFromTheEditor()
    {
        var importer = UnityEditor.AssetImporter.GetAtPath("Assets/Plugins/Android/QuestCredentialStorage.java") as UnityEditor.PluginImporter;
        Assert.That(importer, Is.Not.Null);
        Assert.That(importer.GetCompatibleWithPlatform(UnityEditor.BuildTarget.Android), Is.True);
        Assert.That(importer.GetCompatibleWithEditor(), Is.False);
    }
}

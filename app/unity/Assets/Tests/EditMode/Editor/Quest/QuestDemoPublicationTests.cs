using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;

public sealed class QuestDemoPublicationTests
{
    private sealed class Handler : HttpMessageHandler
    {
        public QuestDemoPresentationBuild Build;
        public bool Published, RejectAsset;
        public string PublishedBuildId;
        public readonly List<string> Requests = new List<string>();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            string path = Uri.UnescapeDataString(request.RequestUri.AbsolutePath);
            if (path == "/api/auth/device/code")
                return Json(HttpStatusCode.OK, "{\"device_code\":\"device-secret\",\"user_code\":\"ABCD\",\"verification_uri_complete\":\"https://web.example/device?user_code=ABCD\",\"expires_in\":1800,\"interval\":1}");
            if (path == "/api/auth/device/token")
                return Json(HttpStatusCode.OK, "{\"access_token\":\"presenter-secret\",\"token_type\":\"Bearer\",\"expires_in\":3600}");
            Assert.That(request.Headers.Authorization?.ToString(), Is.EqualTo("Bearer presenter-secret"));
            Requests.Add(request.Method + " " + path);
            if (path == "/presentations")
                return Json(HttpStatusCode.Created, "{\"id\":\"" + Build.PresentationId + "\"}");
            if (path.EndsWith("/publication"))
                return Json(Published ? HttpStatusCode.OK : HttpStatusCode.NotFound, Published ? Publication() : "{}");
            if (path.EndsWith("/builds"))
            {
                string json = await request.Content.ReadAsStringAsync();
                var envelope = JsonUtility.FromJson<Envelope>(json);
                Assert.That(envelope.definitionJson, Is.EqualTo(Build.DefinitionJson));
                Assert.That(envelope.renderBundleJson, Is.EqualTo(Build.RenderBundleJson));
                Assert.That(envelope.assetSetJson, Is.EqualTo(Build.AssetSetJson));
                Assert.That(envelope.buildManifestJson, Is.EqualTo(Build.BuildManifestJson));
                return Json(HttpStatusCode.Created, "{\"buildId\":\"" + Build.BuildId + "\"}");
            }
            if (request.Method == HttpMethod.Put)
            {
                var asset = Array.Find(Build.Assets, value => path.EndsWith("/assets/" + value.AssetId));
                Assert.That(asset, Is.Not.Null);
                Assert.That(await request.Content.ReadAsByteArrayAsync(), Is.EqualTo(asset.Bytes));
                Assert.That(request.Content.Headers.ContentType.MediaType, Is.EqualTo(asset.MediaType));
                return Json(RejectAsset ? HttpStatusCode.UnprocessableEntity : HttpStatusCode.NoContent, "");
            }
            if (path.EndsWith("/publications"))
            {
                Assert.That(await request.Content.ReadAsStringAsync(), Does.Contain("\"expectedPublicationFence\":null"));
                Published = true;
                return Json(HttpStatusCode.Created, Publication());
            }
            if (path == "/sessions")
            {
                Assert.That(await request.Content.ReadAsStringAsync(), Does.Contain(Build.PresentationId));
                return Json(HttpStatusCode.Created, "{\"session\":{\"id\":\"test-room\"},\"joinCode\":\"ABCD-2345\"}");
            }
            throw new AssertionException("Unexpected request: " + path);
        }
        private string Publication() => "{\"presentationId\":\"" + Build.PresentationId + "\",\"buildId\":\"" + (PublishedBuildId ?? Build.BuildId) + "\"}";
        private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
            new HttpResponseMessage(status) { Content = new StringContent(body) };
    }
    [Serializable] private sealed class Envelope
    {
        public string definitionJson, renderBundleJson, assetSetJson, buildManifestJson;
    }

    private static async Task Authenticate(QuestOnboardingApi api)
    {
        await api.BeginAuthorizationAsync(CancellationToken.None);
        await Task.Delay(1100);
        Assert.That(await api.PollAuthorizationAsync(CancellationToken.None), Is.True);
    }

    [Test]
    public async Task PublishesBundledBytesBeforeCreatingAShareableRoom()
    {
        var build = QuestDemoPresentation.Load("quest-demo-publication-test");
        var handler = new Handler { Build = build };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unframe-unity", handler))
        {
            await Authenticate(api);
            await api.PublishDemoAsync(build, CancellationToken.None);
            var room = await api.CreateSessionAsync(build.PresentationId, CancellationToken.None);
            Assert.That(room.JoinCode, Is.EqualTo("ABCD-2345"));
            Assert.That(handler.Requests[0], Is.EqualTo("POST /presentations"));
            Assert.That(handler.Requests[2], Is.EqualTo("POST /presentations/" + build.PresentationId + "/builds"));
            Assert.That(handler.Requests.Count, Is.EqualTo(build.Assets.Length + 5));
            Assert.That(handler.Requests[handler.Requests.Count - 2], Does.EndWith("/publications"));
            Assert.That(handler.Requests[handler.Requests.Count - 1], Is.EqualTo("POST /sessions"));
        }
    }

    [Test]
    public async Task RetryReusesThePublishedBuildWithoutRepublishingAnActivePresentation()
    {
        var handler = new Handler { Build = QuestDemoPresentation.Load("quest-demo-retry-test"), Published = true };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unframe-unity", handler))
        {
            await Authenticate(api);
            await api.PublishDemoAsync(handler.Build, CancellationToken.None);
            Assert.That(handler.Requests, Has.Count.EqualTo(2));
            Assert.That(handler.Requests[1], Does.EndWith("/publication"));
        }
    }

    [Test]
    public async Task FailedAssetUploadDoesNotPublishOrCreateARoom()
    {
        var handler = new Handler { Build = QuestDemoPresentation.Load("quest-demo-failed-test"), RejectAsset = true };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unframe-unity", handler))
        {
            await Authenticate(api);
            Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.PublishDemoAsync(handler.Build, CancellationToken.None));
            Assert.That(handler.Published, Is.False);
            Assert.That(handler.Requests.Exists(value => value.EndsWith("/sessions")), Is.False);
        }
    }

    [Test]
    public async Task DifferentPublishedBuildIsRejectedWithoutOverwritingIt()
    {
        var handler = new Handler { Build = QuestDemoPresentation.Load("quest-demo-conflict-test"), Published = true, PublishedBuildId = "other-build" };
        using (var api = new QuestOnboardingApi(new Uri("https://api.example"), new Uri("https://web.example"), "unframe-unity", handler))
        {
            await Authenticate(api);
            var error = Assert.ThrowsAsync<QuestOnboardingApiException>(() => api.PublishDemoAsync(handler.Build, CancellationToken.None));
            Assert.That(error.Code, Is.EqualTo("invalid-response"));
            Assert.That(handler.Requests, Has.Count.EqualTo(2));
        }
    }
}

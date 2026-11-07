using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationControlPlaneConnectionEditModeTests
{
    private sealed class Worker : HttpMessageHandler
    {
        internal Func<HttpRequestMessage, HttpResponseMessage> Respond;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            return Task.FromResult(Respond(request));
        }
    }

    [TestCase(HttpStatusCode.Unauthorized, "authentication-required")]
    [TestCase(HttpStatusCode.Forbidden, "session-access-denied")]
    [TestCase(HttpStatusCode.NotFound, "session-not-found")]
    [TestCase(HttpStatusCode.ServiceUnavailable, "service-unavailable")]
    public void HttpFailuresExposeSafeActionableCodes(HttpStatusCode status, string code)
    {
        var worker = new Worker
        {
            Respond = _ => new HttpResponseMessage(status)
            { Content = new StringContent("secret credential and signed URL") }
        };
        using (var client = new HttpClient(worker))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session", _ => Task.FromResult("private-token"));
            var error = Assert.ThrowsAsync<PresentationConnectionException>(() => connection.LoadDeliveryAsync(client, CancellationToken.None));
            Assert.That(error.ErrorCode, Is.EqualTo(code));
            Assert.That(error.ToString(), Does.Not.Contain("secret").And.Not.Contain("private-token"));
        }
    }

    [TestCase("session_ended", "session-ended")]
    [TestCase("other", "request-rejected")]
    public void GoneResponseRequiresTheSessionEndedCode(string code, string expected)
    {
        var worker = new Worker
        {
            Respond = _ => new HttpResponseMessage(HttpStatusCode.Gone)
            { Content = new StringContent("{\"error\":{\"code\":\"" + code + "\"}}", System.Text.Encoding.UTF8, "application/json") }
        };
        using (var client = new HttpClient(worker))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session", _ => Task.FromResult("token"));
            Assert.That(Assert.ThrowsAsync<PresentationConnectionException>(() => connection.LoadDeliveryAsync(client, CancellationToken.None)).ErrorCode, Is.EqualTo(expected));
        }
    }

    private sealed class StalledStream : MemoryStream
    {
        public bool Cancelled;
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken token)
        {
            try { await Task.Delay(Timeout.Infinite, token); return 0; }
            catch (OperationCanceledException) { Cancelled = true; throw; }
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task ControlPlaneDeadlineIncludesTheResponseBody(bool bootstrap)
    {
        var stream = new StalledStream();
        var worker = new Worker
        {
            Respond = _ =>
            {
                var content = new StreamContent(stream);
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(bootstrap ? "application/json" : "application/x-protobuf");
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
            }
        };
        using (var client = new HttpClient(worker))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session", _ => Task.FromResult("token"), requestTimeout: TimeSpan.FromMilliseconds(100));
            var method = typeof(PresentationControlPlaneConnection).GetMethod("LoadBootstrapAsync", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            Task request = bootstrap ? (Task)method.Invoke(connection, new object[] { client, new DeliveryManifest(), CancellationToken.None })
                : connection.LoadDeliveryAsync(client, CancellationToken.None);
            Assert.That(await Task.WhenAny(request, Task.Delay(3000)), Is.SameAs(request));
            Assert.That(request.IsCanceled, Is.True);
            Assert.That(stream.Cancelled, Is.True);
        }
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task CredentialDeadlineStopsWaitingAndReleasesALateLease(bool bootstrap)
    {
        var pending = new TaskCompletionSource<PresentationCredentialLease>(TaskCreationOptions.RunContinuationsAsynchronously);
        var released = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        int requests = 0;
        using (var client = new HttpClient(new Worker { Respond = _ => { requests++; return new HttpResponseMessage(HttpStatusCode.Unauthorized); } }))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session",
                _ => Task.FromResult("unused"), credentialLeaseProvider: _ => pending.Task,
                requestTimeout: TimeSpan.FromMilliseconds(100));
            var method = typeof(PresentationControlPlaneConnection).GetMethod("LoadBootstrapAsync", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            Task request = bootstrap ? (Task)method.Invoke(connection, new object[] { client, new DeliveryManifest(), CancellationToken.None })
                : connection.LoadDeliveryAsync(client, CancellationToken.None);
            try
            {
                Assert.That(await Task.WhenAny(request, Task.Delay(3000)), Is.SameAs(request), "The request must finish before credential rotation responds.");
                Assert.That(request.IsCanceled, Is.True);
                Assert.That(requests, Is.Zero);
            }
            finally
            {
                pending.TrySetResult(new PresentationCredentialLease("late-token", () => released.TrySetResult(true)));
                try { await request; }
                catch (OperationCanceledException) { }
                catch (PresentationConnectionException) { }
                Assert.That(await Task.WhenAny(released.Task, Task.Delay(3000)), Is.SameAs(released.Task), "Late credentials must not keep the rotation gate locked.");
            }
        }
    }

    [Test]
    public async Task LocalCancellationStopsWaitingForABearerProviderThatCompletesLater()
    {
        var pending = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        int requests = 0;
        using (var cancellation = new CancellationTokenSource())
        using (var client = new HttpClient(new Worker { Respond = _ => { requests++; return new HttpResponseMessage(HttpStatusCode.Unauthorized); } }))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session", _ => pending.Task);
            Task request = connection.LoadDeliveryAsync(client, cancellation.Token);
            cancellation.Cancel();
            try
            {
                Assert.That(await Task.WhenAny(request, Task.Delay(3000)), Is.SameAs(request));
                Assert.That(request.IsCanceled, Is.True);
                Assert.That(requests, Is.Zero);
            }
            finally
            {
                pending.TrySetException(new InvalidOperationException("Credential renewal failed after cancellation."));
                try { await request; }
                catch (OperationCanceledException) { }
                catch (PresentationConnectionException) { }
            }
        }
    }

    [Test]
    public void CredentialProviderPreservesTheSessionEndedReason()
    {
        using (var client = new HttpClient(new Worker { Respond = _ => throw new AssertionException("HTTP must not start after terminal credential failure.") }))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session",
                _ => throw new PresentationConnectionException("session-ended"));
            Assert.That(Assert.ThrowsAsync<PresentationConnectionException>(() => connection.LoadDeliveryAsync(client, CancellationToken.None)).ErrorCode, Is.EqualTo("session-ended"));
        }
    }

    [TestCase("runtime_unavailable", "runtime-unavailable")]
    [TestCase("conflict", "session-not-available")]
    [TestCase("session_ended", "session-not-available")]
    public void ConflictResponseDistinguishesTemporaryRuntimeUnavailability(string code, string expected)
    {
        var worker = new Worker
        {
            Respond = _ => new HttpResponseMessage(HttpStatusCode.Conflict)
            { Content = new StringContent("{\"error\":{\"code\":\"" + code + "\",\"message\":\"private details\"}}", System.Text.Encoding.UTF8, "application/json") }
        };
        using (var client = new HttpClient(worker))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session", _ => Task.FromResult("private-token"));
            var error = Assert.ThrowsAsync<PresentationConnectionException>(() => connection.LoadDeliveryAsync(client, CancellationToken.None));
            Assert.That(error.ErrorCode, Is.EqualTo(expected));
            Assert.That(error.ToString(), Does.Not.Contain("private"));
        }
    }

    [TestCase("runtime")]
    [TestCase("busy")]
    [TestCase("unavailable")]
    [TestCase("network")]
    [TestCase("timeout")]
    public async Task TemporaryControlPlaneFailuresKeepRetryingUntilLocalCancellation(string failure)
    {
        int requests = 0;
        using (var cancellation = new CancellationTokenSource())
        {
            var worker = new Worker
            {
                Respond = _ =>
                {
                    requests++;
                    if (requests == 2)
                    {
                        cancellation.Cancel();
                        cancellation.Token.ThrowIfCancellationRequested();
                    }
                    if (failure == "network") throw new HttpRequestException("offline");
                    if (failure == "timeout") throw new TaskCanceledException("request timeout");
                    if (failure == "busy") return new HttpResponseMessage(HttpStatusCode.TooManyRequests);
                    if (failure == "unavailable") return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                    return new HttpResponseMessage(HttpStatusCode.Conflict)
                    { Content = new StringContent("{\"error\":{\"code\":\"runtime_unavailable\"}}", System.Text.Encoding.UTF8, "application/json") };
                }
            };
            var gameObject = new UnityEngine.GameObject("runtime-recovery-test");
            Task run = null;
            try
            {
                var runtime = gameObject.AddComponent<PresentationBakedRuntime>();
                var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session", _ => Task.FromResult("private-token"), httpHandlerFactory: () => worker);
                run = connection.RunAsync(runtime, cancellation.Token);
                Task completed = await Task.WhenAny(run, Task.Delay(TimeSpan.FromSeconds(15)));
                Assert.That(completed, Is.SameAs(run));
                Assert.That(run.Exception, Is.Null);
                Assert.That(run.IsCanceled, Is.True);
                Assert.That(requests, Is.EqualTo(2));
            }
            finally
            {
                cancellation.Cancel();
                if (run != null)
                {
                    try { await run; }
                    catch (OperationCanceledException) { }
                }
                UnityEngine.Object.DestroyImmediate(gameObject);
            }
        }
        await Task.CompletedTask;
    }

    [Test]
    public void ControlPlaneConnectionRejectsAnInsecureOrigin()
    {
        Assert.Throws<ArgumentException>(() => new PresentationControlPlaneConnection(new Uri("http://localhost/"), "session", _ => Task.FromResult("token")));
        Assert.Throws<ArgumentException>(() => new PresentationControlPlaneConnection(new Uri("https://example.com/api/"), "session", _ => Task.FromResult("token")));
    }

    [Test]
    public async Task DeliveryRequestPinsCapabilityAndUsesAFreshProcessCredential()
    {
        DeliveryManifest manifest = PresentationTextureResidencyEditModeTests.BakedDelivery();
        manifest.CapabilityProfile.CapabilityProfileId = "quest-presentation-v2";
        manifest.ProjectionProfile.Key.CapabilityProfileId = "quest-presentation-v2";
        string session = manifest.SessionId;
        int credentials = 0;
        Worker worker = new Worker
        {
            Respond = request =>
            {
                Assert.That(request.Method, Is.EqualTo(HttpMethod.Post));
                Assert.That(request.RequestUri.AbsolutePath, Is.EqualTo("/sessions/" + Uri.EscapeDataString(session) + "/delivery"));
                Assert.That(request.Headers.Authorization.Scheme, Is.EqualTo("Bearer"));
                Assert.That(request.Headers.Authorization.Parameter, Is.EqualTo("credential-" + credentials));
                Assert.That(request.Content.ReadAsStringAsync().GetAwaiter().GetResult(), Is.EqualTo("{\"capabilityProfileId\":\"quest-presentation-v2\"}"));
                ByteArrayContent content = new ByteArrayContent(manifest.ToByteArray());
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/x-protobuf");
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
            }
        };
        using (HttpClient client = new HttpClient(worker))
        {
            PresentationControlPlaneConnection connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), manifest.SessionId,
                _ => Task.FromResult("credential-" + ++credentials));
            Assert.That((await connection.LoadDeliveryAsync(client, CancellationToken.None)).Publication, Is.EqualTo(manifest.Publication));
            await connection.LoadDeliveryAsync(client, CancellationToken.None);
            Assert.That(credentials, Is.EqualTo(2));
            manifest.SessionId = "session:other";
            Assert.ThrowsAsync<InvalidOperationException>(async () => await connection.LoadDeliveryAsync(client, CancellationToken.None));
        }
    }
    [Test]
    public async Task BootstrapUsesPostAndSignalsPublicationReload()
    {
        DeliveryManifest manifest = PresentationTextureResidencyEditModeTests.BakedDelivery();
        Worker worker = new Worker
        {
            Respond = request =>
            {
                Assert.That(request.Method, Is.EqualTo(HttpMethod.Post));
                Assert.That(request.RequestUri.AbsolutePath, Does.EndWith("/bootstrap"));
                string json = "{\"endpoint\":\"https://runtime.example.com/\",\"runtimeId\":\"runtime\",\"runtimeKind\":\"Cloud\",\"fingerprint\":null,\"credential\":\"test-only\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"publicationFence\":{\"presentationId\":\"different\",\"publicationEpoch\":1,\"publicationManifestHash\":\"different\"}}";
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
            }
        };
        using (HttpClient client = new HttpClient(worker))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), manifest.SessionId, _ => Task.FromResult("test-only"));
            var method = typeof(PresentationControlPlaneConnection).GetMethod("LoadBootstrapAsync", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            var exception = Assert.ThrowsAsync<PresentationDeliveryReloadRequiredException>(async () =>
                await (Task)method.Invoke(connection, new object[] { client, manifest, CancellationToken.None }));
            Assert.That(exception.Reason, Is.EqualTo(Unframe.Realtime.ResyncReason.PublicationFenceChanged));
        }
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExplicitLocalCancellationWaitsForRunCleanupBeforeRemovingItsDurableSelection()
    {
        string directory = Path.Combine(Path.GetTempPath(), "unframe-local-cancel-" + Guid.NewGuid().ToString("N"));
        try
        {
            DeliveryManifest delivery = PresentationTextureResidencyEditModeTests.BakedDelivery();
            using (var cache = new PresentationEncodedAssetCache(Path.Combine(directory, "cache"), 1024, 0, () => 4096))
            using (var host = new PresentationRuntimeHost(Path.Combine(directory, "selections.json"), cache))
            using (var run = new CancellationTokenSource())
            {
                host.PrepareDelivery(delivery);
                var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), delivery.SessionId,
                    _ => Task.FromResult("test-only"), host);
                var finished = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                Type type = typeof(PresentationControlPlaneConnection);
                type.GetField("selectedParticipantId", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .SetValue(connection, delivery.ProjectionInstance.ParticipantId);
                type.GetField("activeRun", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .SetValue(connection, run);
                type.GetField("runFinished", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .SetValue(connection, finished);
                Task cancellation = connection.CancelLocalSelectionAsync();
                Assert.That(run.IsCancellationRequested, Is.True);
                Assert.That(host.SelectionCount, Is.EqualTo(1));
                Assert.That(cancellation.IsCompleted, Is.False);
                finished.SetResult(true);
                await cancellation;
                Assert.That(host.SelectionCount, Is.Zero);
            }
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Test]
    public async Task ExplicitCancellationBeforeDeliveryStopsLoadingWithoutCreatingASelection()
    {
        string directory = Path.Combine(Path.GetTempPath(), "unframe-local-cancel-" + Guid.NewGuid().ToString("N"));
        try
        {
            using (var cache = new PresentationEncodedAssetCache(Path.Combine(directory, "cache"), 1024, 0, () => 4096))
            using (var host = new PresentationRuntimeHost(Path.Combine(directory, "selections.json"), cache))
            using (var run = new CancellationTokenSource())
            {
                var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), "session",
                    _ => Task.FromResult("test-only"), host);
                var finished = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                Type type = typeof(PresentationControlPlaneConnection);
                type.GetField("activeRun", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).SetValue(connection, run);
                type.GetField("runFinished", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).SetValue(connection, finished);
                Task cancellation = connection.CancelLocalSelectionAsync();
                Assert.That(run.IsCancellationRequested, Is.True);
                finished.SetResult(true);
                await cancellation;
                Assert.That(host.SelectionCount, Is.Zero);
            }
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

}

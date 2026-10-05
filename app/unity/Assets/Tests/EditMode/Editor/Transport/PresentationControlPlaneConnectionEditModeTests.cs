using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Google.Protobuf;
using NUnit.Framework;
using Unframe.Delivery.V2;
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
        manifest.CapabilityProfile.CapabilityProfileId = "quest-baked-web-v1";
        manifest.ProjectionProfile.Key.CapabilityProfileId = "quest-baked-web-v1";
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
                Assert.That(request.Content.ReadAsStringAsync().GetAwaiter().GetResult(), Is.EqualTo("{\"capabilityProfileId\":\"quest-baked-web-v1\"}"));
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
                string json = "{\"endpoint\":\"https://runtime.example.com/\",\"runtimeId\":\"runtime\",\"runtimeKind\":\"Cloud\",\"credential\":\"test-only\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"publicationFence\":{\"presentationId\":\"different\",\"publicationEpoch\":1,\"publicationManifestHash\":\"different\"}}";
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
            }
        };
        using (HttpClient client = new HttpClient(worker))
        {
            var connection = new PresentationControlPlaneConnection(new Uri("https://api.example.com/"), manifest.SessionId, _ => Task.FromResult("test-only"));
            var method = typeof(PresentationControlPlaneConnection).GetMethod("LoadBootstrapAsync", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            var exception = Assert.ThrowsAsync<PresentationDeliveryReloadRequiredException>(async () =>
                await (Task)method.Invoke(connection, new object[] { client, manifest, CancellationToken.None }));
            Assert.That(exception.Reason, Is.EqualTo(Unframe.Realtime.V2.ResyncReason.PublicationFenceChanged));
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

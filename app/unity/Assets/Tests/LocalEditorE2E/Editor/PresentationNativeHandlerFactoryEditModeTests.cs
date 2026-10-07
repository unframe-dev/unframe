using System;
using System.Collections;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationNativeHandlerFactoryEditModeTests
{
    private sealed class RejectingHandler : HttpMessageHandler
    {
        internal int Sends;
        internal bool Released;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Sends++;
            Assert.That(Uri.UnescapeDataString(request.RequestUri.AbsolutePath), Is.EqualTo("/sessions/session:unit/delivery"));
            Assert.That(request.Headers.Authorization.Scheme, Is.EqualTo("Bearer"));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new ByteArrayContent(Array.Empty<byte>()) });
        }
        protected override void Dispose(bool disposing) { Released = true; base.Dispose(disposing); }
    }

    [UnityTest]
    public IEnumerator ControlPlaneUsesAndDisposesTheSuppliedHandlerWithoutAcceptingRejectedDelivery()
    {
        string directory = Path.Combine(Path.GetTempPath(), "unframe-handler-test-" + Guid.NewGuid().ToString("N"));
        var root = new GameObject("native handler test");
        var handler = new RejectingHandler();
        try
        {
            using (var cache = new PresentationEncodedAssetCache(Path.Combine(directory, "cache")))
            using (var host = new PresentationRuntimeHost(Path.Combine(directory, "selection.json"), cache))
            {
                var runtime = root.AddComponent<PresentationBakedRuntime>();
                var connection = new PresentationControlPlaneConnection(new Uri("https://localhost/"), "session:unit",
                    token => Task.FromResult("unit-test-token"), host, () => handler);
                Task run = connection.RunAsync(runtime, CancellationToken.None);
                while (!run.IsCompleted) yield return null;
                Assert.That(run.IsFaulted, Is.True);
                Assert.That(run.Exception.InnerException, Is.InstanceOf<InvalidOperationException>());
                Assert.That(handler.Sends, Is.EqualTo(1));
                Assert.That(handler.Released, Is.True);
                Assert.That(runtime.Delivery, Is.Null);
                Assert.That(runtime.SessionReady, Is.False);
            }
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(root);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}

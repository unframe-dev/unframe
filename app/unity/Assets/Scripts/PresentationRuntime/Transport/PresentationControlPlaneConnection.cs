using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using Unframe.Realtime;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationControlPlaneConnection
    {
        [Serializable]
        private sealed class Publication
        {
            public string presentationId;
            public ulong publicationEpoch;
            public string publicationManifestHash;
        }
        [Serializable]
        private sealed class Bootstrap
        {
            public string endpoint;
            public string fingerprint;
            public string runtimeId;
            public string runtimeKind;
            public ulong assignmentEpoch;
            public string credential;
            public string expiresAt;
            public string projectionProfileId;
            public Publication publicationFence;
        }

        private readonly Uri controlPlane;
        private readonly string sessionId;
        private readonly Func<CancellationToken, Task<string>> credentialProvider;
        private readonly PresentationRuntimeHost runtimeHost;
        private readonly object runGate = new object();
        private CancellationTokenSource activeRun;
        private TaskCompletionSource<bool> runFinished;
        private string selectedParticipantId;
        private bool localCancellation;

        public PresentationControlPlaneConnection(Uri controlPlane, string sessionId, Func<CancellationToken, Task<string>> credentialProvider,
            PresentationRuntimeHost runtimeHost = null)
        {
            if (controlPlane == null || !controlPlane.IsAbsoluteUri || controlPlane.Scheme != "https"
                || controlPlane.AbsolutePath != "/" || !string.IsNullOrEmpty(controlPlane.UserInfo)
                || !string.IsNullOrEmpty(controlPlane.Query) || !string.IsNullOrEmpty(controlPlane.Fragment)
                || string.IsNullOrEmpty(sessionId) || credentialProvider == null)
                throw new ArgumentException("An authenticated HTTPS Control Plane origin and session are required.");
            this.controlPlane = controlPlane;
            this.sessionId = sessionId;
            this.credentialProvider = credentialProvider;
            this.runtimeHost = runtimeHost;
        }

        public async Task RunAsync(PresentationBakedRuntime runtime, CancellationToken token)
        {
            if (runtime == null) throw new ArgumentNullException(nameof(runtime));
            PresentationRuntimeHost host = runtimeHost ?? PresentationRuntimeHost.Shared;
            using (CancellationTokenSource lifetime = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                var finished = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                lock (runGate)
                {
                    if (activeRun != null || localCancellation) throw new InvalidOperationException("A local presentation run is already active or cancelling.");
                    activeRun = lifetime;
                    runFinished = finished;
                }
                try
                {
                    using (HttpClient client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(30) })
                    {
                        for (int attempt = 0; ; attempt++)
                        {
                            try
                            {
                                DeliveryManifest delivery = await LoadDeliveryAsync(client, lifetime.Token);
                                host.PrepareDelivery(delivery);
                                lock (runGate) selectedParticipantId = delivery.ProjectionInstance.ParticipantId;
                                Bootstrap initial = await LoadBootstrapAsync(client, delivery, lifetime.Token);
                                string endpoint = initial.endpoint;
                                string fingerprint = initial.fingerprint;
                                string runtimeId = initial.runtimeId;
                                initial.credential = null;
                                async Task<string> RefreshCredential(CancellationToken cancellation)
                                {
                                    Bootstrap current = await LoadBootstrapAsync(client, delivery, cancellation);
                                    if (current.endpoint != endpoint || current.fingerprint != fingerprint || current.runtimeId != runtimeId)
                                        throw new PresentationDeliveryReloadRequiredException(ResyncReason.ProjectionChanged);
                                    return current.credential;
                                }
                                await runtime.RunAsync(delivery, new Uri(endpoint), RefreshCredential, lifetime.Token, fingerprint, host.EncodedCache);
                                return;
                            }
                            catch (PresentationDeliveryReloadRequiredException) when (attempt < 5)
                            {
                                await Task.Delay(Math.Min(5000, 250 * (1 << attempt)), lifetime.Token);
                            }
                        }
                    }
                }
                finally
                {
                    lock (runGate) activeRun = null;
                    finished.TrySetResult(true);
                }
            }
        }

        public async Task CancelLocalSelectionAsync()
        {
            CancellationTokenSource lifetime;
            Task stopped;
            lock (runGate)
            {
                if (localCancellation || activeRun == null && string.IsNullOrWhiteSpace(selectedParticipantId))
                    throw new InvalidOperationException("No local selection is available for cancellation.");
                localCancellation = true;
                lifetime = activeRun;
                stopped = runFinished?.Task ?? Task.CompletedTask;
            }
            try { lifetime?.Cancel(); }
            catch (ObjectDisposedException) { }
            await stopped;
            string participantId;
            lock (runGate) participantId = selectedParticipantId;
            if (!string.IsNullOrWhiteSpace(participantId))
                (runtimeHost ?? PresentationRuntimeHost.Shared).RemoveConfirmedSelection(sessionId, participantId);
            lock (runGate)
            {
                selectedParticipantId = null;
                localCancellation = false;
            }
        }

        public async Task<DeliveryManifest> LoadDeliveryAsync(HttpClient client, CancellationToken token)
        {
            using (HttpRequestMessage request = await RequestAsync(HttpMethod.Post, "delivery", token))
            {
                request.Content = new StringContent("{\"capabilityProfileId\":\"quest-baked-web-v1\"}", System.Text.Encoding.UTF8, "application/json");
                using (HttpResponseMessage response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token))
                {
                    if (!response.IsSuccessStatusCode || response.Content.Headers.ContentType?.MediaType != "application/x-protobuf")
                        throw new InvalidOperationException("Control Plane Delivery request failed.");
                    byte[] bytes = await ReadBoundedAsync(response.Content, 16 * 1024 * 1024, token);
                    DeliveryManifest delivery = DeliveryManifest.Parser.ParseFrom(bytes);
                    PresentationRuntimeDataStore validator = new PresentationRuntimeDataStore();
                    if (delivery.SessionId != sessionId || delivery.CapabilityProfile?.CapabilityProfileId != "quest-baked-web-v1"
                        || !validator.TryReceiveDelivery(delivery, out _))
                        throw new InvalidOperationException("Control Plane Delivery is incompatible.");
                    return delivery;
                }
            }
        }

        private async Task<Bootstrap> LoadBootstrapAsync(HttpClient client, DeliveryManifest delivery, CancellationToken token)
        {
            using (HttpRequestMessage request = await RequestAsync(HttpMethod.Post, "bootstrap", token))
            using (HttpResponseMessage response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token))
            {
                if (!response.IsSuccessStatusCode || response.Content.Headers.ContentType?.MediaType != "application/json")
                    throw new InvalidOperationException("Control Plane bootstrap request failed.");
                byte[] bytes = await ReadBoundedAsync(response.Content, 64 * 1024, token);
                Bootstrap result = JsonUtility.FromJson<Bootstrap>(System.Text.Encoding.UTF8.GetString(bytes));
                if (result == null || result.publicationFence == null || string.IsNullOrWhiteSpace(result.credential)
                    || string.IsNullOrWhiteSpace(result.runtimeId) || result.runtimeKind != "Cloud" && result.runtimeKind != "VenueEdge"
                    || !Uri.TryCreate(result.endpoint, UriKind.Absolute, out Uri endpoint) || endpoint.Scheme != "https" || !string.IsNullOrEmpty(endpoint.UserInfo)
                    || !DateTimeOffset.TryParse(result.expiresAt, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out DateTimeOffset expiry)
                    || expiry <= DateTimeOffset.UtcNow)
                    throw new InvalidOperationException("Control Plane bootstrap descriptor is incompatible.");
                if (result.publicationFence.presentationId != delivery.Publication.PresentationId
                    || result.publicationFence.publicationEpoch != delivery.Publication.PublicationEpoch
                    || result.publicationFence.publicationManifestHash != delivery.Publication.PublicationManifestHash)
                    throw new PresentationDeliveryReloadRequiredException(ResyncReason.PublicationFenceChanged);
                if (result.assignmentEpoch != delivery.ProjectionInstance.AssignmentEpoch
                    || result.projectionProfileId != delivery.ProjectionProfile.ProjectionProfileId)
                    throw new PresentationDeliveryReloadRequiredException(ResyncReason.ProjectionChanged);
                return result;
            }
        }

        private async Task<HttpRequestMessage> RequestAsync(HttpMethod method, string resource, CancellationToken token)
        {
            string bearer = await credentialProvider(token);
            if (string.IsNullOrWhiteSpace(bearer)) throw new InvalidOperationException("Control Plane credential is unavailable.");
            HttpRequestMessage request = new HttpRequestMessage(method, new Uri(controlPlane, "sessions/" + Uri.EscapeDataString(sessionId) + "/" + resource));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            return request;
        }

        private static async Task<byte[]> ReadBoundedAsync(HttpContent content, int limit, CancellationToken token)
        {
            if (content.Headers.ContentLength > limit) throw new InvalidOperationException("Control Plane response exceeds its limit.");
            using (System.IO.Stream stream = await content.ReadAsStreamAsync())
            using (System.IO.MemoryStream output = new System.IO.MemoryStream())
            {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = await stream.ReadAsync(buffer, 0, buffer.Length, token)) != 0)
                {
                    if (output.Length + count > limit) throw new InvalidOperationException("Control Plane response exceeds its limit.");
                    output.Write(buffer, 0, count);
                }
                return output.ToArray();
            }
        }
    }
}

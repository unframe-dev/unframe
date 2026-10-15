using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Google.Protobuf;
using Unframe.Preview;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    [Serializable]
    public sealed class PresentationPreviewEvent
    {
        public string kind;
        public string requestId;
        public string buildIdentity;
        public string message;
    }

    public sealed class UnframePreview : MonoBehaviour
    {
        [Serializable]
        private sealed class Configuration { public string token; }
        private PresentationPreviewTransaction transaction;
        private string bearer;
        private long generation;
        private string latestRequest;
        public event Action<PresentationPreviewEvent> Notification;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void UnframePreviewNotify(string payload);
#endif

        private void Awake() { EnsureTransaction(); }
        private void EnsureTransaction() { if (transaction == null) transaction = new PresentationPreviewTransaction(transform); }

        public void Configure(string json)
        {
            try
            {
                EnsureTransaction();
                Configuration configuration = JsonUtility.FromJson<Configuration>(json);
                if (String.IsNullOrEmpty(configuration?.token)) throw new ArgumentException();
                Invalidate("");
                bearer = configuration.token;
            }
            catch (Exception) { Emit("failed", null, null, "preview.configuration-invalid"); }
        }

        public async void Prepare(string json)
        {
            long expected = ++generation;
            string requestId = null;
            try
            {
                EnsureTransaction();
                transaction.Invalidate();
                latestRequest = null;
                if (String.IsNullOrEmpty(bearer)) throw new InvalidOperationException("preview.not-configured");
                LocalPreviewEnvelope envelope = JsonParser.Default.Parse<LocalPreviewEnvelope>(json);
                requestId = envelope.RequestId;
                latestRequest = requestId;
                if (!PresentationLocalPreviewAdapter.TryCreate(envelope, out PresentationLocalPreviewInput input, out string error))
                    throw new InvalidOperationException(error);
                var provider = new PresentationPreviewAssetProvider(input, bearer);
                await transaction.PrepareAsync(envelope, provider.GetAsync, CancellationToken.None);
                if (expected != generation) return;
                Emit("prepared", requestId, null, null);
            }
            catch (Exception exception)
            {
                if (expected == generation)
                    Emit("failed", requestId, null, exception is OperationCanceledException ? "preview.cancelled"
                        : exception is InvalidOperationException ? exception.Message : "preview.input-invalid");
            }
        }

        public void Commit(string requestId)
        {
            try
            {
                if (requestId != latestRequest) throw new InvalidOperationException("preview.prepared-request-mismatch");
                string identity = transaction.Commit(requestId);
                latestRequest = null;
                PresentationPreviewCamera camera = Camera.main?.GetComponent<PresentationPreviewCamera>();
                camera?.Frame(transform);
                Emit("committed", requestId, identity, null);
            }
            catch (Exception exception)
            {
                Emit("failed", requestId, null, exception is InvalidOperationException ? exception.Message : "preview.commit-failed");
            }
        }

        public void Discard(string requestId)
        {
            if (transaction != null && transaction.Discard(requestId)) { generation++; latestRequest = null; }
        }
        public void Invalidate(string unused)
        {
            generation++;
            latestRequest = null;
            transaction?.Invalidate();
        }
        private void Emit(string kind, string requestId, string identity, string message)
        {
            var notification = new PresentationPreviewEvent { kind = kind, requestId = requestId, buildIdentity = identity, message = message };
            Notification?.Invoke(notification);
#if UNITY_WEBGL && !UNITY_EDITOR
            UnframePreviewNotify(JsonUtility.ToJson(notification));
#endif
        }
        private void OnDisable() { Invalidate(""); }
        private void OnDestroy() { transaction?.Dispose(); transaction = null; bearer = null; }
    }
}

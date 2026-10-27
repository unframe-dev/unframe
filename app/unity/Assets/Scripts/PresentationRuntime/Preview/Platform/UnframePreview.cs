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
        public string sequence;
        public string outcome;
        public string phase;
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
                Emit("prepared", requestId, input.BuildIdentity, null);
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

        public void Playback(string json) { ApplyPlayback(json, false); }
        public void Restore(string json) { ApplyPlayback(json, true); }

        private void ApplyPlayback(string json, bool restoring)
        {
            string requestId = null;
            string sequence = null;
            string phase = restoring ? "restore" : "apply";
            try
            {
                EnsureTransaction();
                LocalPreviewPlaybackState state = JsonParser.Default.Parse<LocalPreviewPlaybackState>(json);
                requestId = state.RequestId;
                sequence = state.Sequence.ToString(System.Globalization.CultureInfo.InvariantCulture);
                string error;
                bool applied = restoring
                    ? transaction.TryRestore(state, Time.realtimeSinceStartupAsDouble, out error)
                    : transaction.TryPlayback(state, Time.realtimeSinceStartupAsDouble, out error);
                if (!applied)
                {
                    Emit("failed", requestId, null, error, sequence, transaction.PlaybackRejected ? "rejected" : "failed", phase);
                    return;
                }
                Emit(restoring ? "restored" : "playback", requestId, null, null, sequence);
            }
            catch (Exception)
            {
                Emit("failed", requestId, null, "preview.playback-input-invalid", sequence, "rejected", phase);
            }
        }
        private bool activationBlocked;
        private void Update()
        {
            if (transaction != null && !transaction.TryUpdate(Time.realtimeSinceStartupAsDouble, out string error))
            {
                bool activationRequired = error == "video-user-activation-required";
                if (!activationRequired || !activationBlocked)
                    Emit("failed", transaction.PlaybackRequestId, null, error,
                        transaction.PlaybackSequence.ToString(System.Globalization.CultureInfo.InvariantCulture), activationRequired ? "rejected" : "failed", "update");
                activationBlocked = activationRequired;
                return;
            }
            activationBlocked = false;
        }

        public void Discard(string requestId)
        {
            if (transaction != null && transaction.Discard(requestId)) { generation++; latestRequest = null; }
        }
        public void Invalidate(string unused)
        {
            generation++;
            latestRequest = null;
            activationBlocked = false;
            transaction?.Invalidate();
        }
        private void Emit(string kind, string requestId, string identity, string message, string sequence = null, string outcome = null, string phase = null)
        {
            var notification = new PresentationPreviewEvent { kind = kind, requestId = requestId, buildIdentity = identity, message = message, sequence = sequence, outcome = outcome, phase = phase };
            Notification?.Invoke(notification);
#if UNITY_WEBGL && !UNITY_EDITOR
            UnframePreviewNotify(JsonUtility.ToJson(notification));
#endif
        }
        private void OnDisable() { Invalidate(""); }
        private void OnDestroy() { transaction?.Dispose(); transaction = null; bearer = null; }
    }
}

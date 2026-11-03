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
        [Serializable]
        private sealed class SpatialIdentity { public string requestId; public string sequence; }
        [Serializable]
        private sealed class InteractionEvent { public string requestId; public string surfaceId; public string interactionId; }
        [Serializable]
        private sealed class PresenterPositionEvent { public string requestId; public double[] position; }
        private PresentationPreviewTransaction transaction;
        private string bearer;
        private long generation;
        private string latestRequest;
        private PresentationPreviewSpatial spatial;
        private bool spatialReady;
        private string view = "perspective";
        public event Action<PresentationPreviewEvent> Notification;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void UnframePreviewNotify(string payload);
        [DllImport("__Internal")]
        private static extern void UnframePreviewPresenterMove(string payload);
        [DllImport("__Internal")]
        private static extern void UnframePreviewInteraction(string payload);
#endif

        private void Awake() { EnsureTransaction(); }
        private void EnsureTransaction()
        {
            if (transaction == null) transaction = new PresentationPreviewTransaction(transform);
        }
        private void EnsureSpatial()
        {
            if (spatial != null) return;
            spatial = new PresentationPreviewSpatial(transform);
            spatial.PresenterMoved += (requestId, position) =>
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                UnframePreviewPresenterMove(JsonUtility.ToJson(new PresenterPositionEvent { requestId = requestId, position = position }));
#endif
            };
        }

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
                spatialReady = false;
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
                spatialReady = false;
                spatial?.Clear();
                PresentationPreviewCamera camera = Camera.main?.GetComponent<PresentationPreviewCamera>();
                camera?.Frame(transform);
                camera?.SetView(view);
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
                spatialReady = false;
                Emit(restoring ? "restored" : "playback", requestId, null, null, sequence);
            }
            catch (Exception)
            {
                Emit("failed", requestId, null, "preview.playback-input-invalid", sequence, "rejected", phase);
            }
        }
        public void Spatial(string json)
        {
            string requestId = null; string sequence = null;
            try
            {
                SpatialIdentity identity = JsonUtility.FromJson<SpatialIdentity>(json);
                requestId = identity?.requestId; sequence = identity?.sequence;
                if (!PresentationPreviewSpatialState.TryParse(json, out var state))
                    throw new InvalidOperationException("preview.spatial-input-invalid");
                if (transaction == null || transaction.PlaybackFaulted || transaction.LoadedRequestId != state.RequestId
                    || transaction.PlaybackRequestId != state.RequestId || transaction.PlaybackSequence != state.Sequence)
                    throw new InvalidOperationException("preview.spatial-request-mismatch");
                if (!transaction.TryApplySpatial(state, out string error)) throw new InvalidOperationException(error);
                EnsureSpatial();
                spatial.Apply(state);
                PresentationPreviewCamera camera = Camera.main?.GetComponent<PresentationPreviewCamera>();
                camera?.SetSpatialBounds(spatial.Bounds);
                spatial.SetVisible(view == "overhead");
                spatialReady = true;
                Emit("spatial", requestId, null, null, sequence);
            }
            catch (Exception exception)
            {
                Emit("failed", requestId, null, exception is InvalidOperationException ? exception.Message : "preview.spatial-input-invalid", sequence, "rejected", "spatial");
            }
        }
        public void View(string value)
        {
            if (value != "perspective" && value != "overhead") return;
            view = value;
            Camera.main?.GetComponent<PresentationPreviewCamera>()?.SetView(value);
            spatial?.SetVisible(view == "overhead");
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
            if (spatialReady && view == "overhead") spatial?.UpdateInteraction(Camera.main);
            else if (spatialReady && Input.GetMouseButtonDown(0) && Camera.main != null && Camera.main.pixelRect.Contains(Input.mousePosition)
                && transaction.TryPickInteraction(Camera.main.ScreenPointToRay(Input.mousePosition), out string surfaceId, out string interactionId))
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                UnframePreviewInteraction(JsonUtility.ToJson(new InteractionEvent { requestId = transaction.PlaybackRequestId, surfaceId = surfaceId, interactionId = interactionId }));
#endif
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
            activationBlocked = false;
            transaction?.Invalidate();
            spatialReady = false;
            spatial?.Clear();
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
        private void OnDestroy() { spatial?.Dispose(); spatial = null; transaction?.Dispose(); transaction = null; bearer = null; }
    }
}

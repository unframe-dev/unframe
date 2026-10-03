using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Unframe.Delivery.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationRuntimeHost : IDisposable
    {
        public static string ConsumerToken(string sessionId, string participantId)
        {
            if (!PresentationDeliveryCatalog.IsId(sessionId) || !PresentationDeliveryCatalog.IsId(participantId))
                throw new ArgumentException("A session and participant ID are required.");
            return sessionId.Length.ToString(CultureInfo.InvariantCulture) + ":" + sessionId
                + participantId.Length.ToString(CultureInfo.InvariantCulture) + ":" + participantId;
        }
        private static readonly object sharedGate = new object();
        private static PresentationRuntimeHost shared;
        private readonly object gate = new object();
        private readonly SessionSelectionRegistry registry;
        private readonly PresentationEncodedAssetCache cache;
        private bool faulted;
        private bool disposed;

        public static PresentationRuntimeHost Shared
        {
            get
            {
                lock (sharedGate)
                {
                    if (shared == null || shared.disposed)
                        shared = new PresentationRuntimeHost(Path.Combine(Application.persistentDataPath, "unframe", "session-selections.json"),
                            PresentationEncodedAssetCache.Shared);
                    return shared;
                }
            }
        }

        static PresentationRuntimeHost()
        {
            Application.quitting += DisposeShared;
#if UNITY_EDITOR
            UnityEditor.AssemblyReloadEvents.beforeAssemblyReload += DisposeShared;
            UnityEditor.EditorApplication.playModeStateChanged += state =>
            {
                if (state == UnityEditor.PlayModeStateChange.ExitingPlayMode) DisposeShared();
            };
#endif
        }

        private static void DisposeShared()
        {
            lock (sharedGate)
            {
                shared?.Dispose();
                shared = null;
            }
        }

        public int SelectionCount { get { lock (gate) { EnsureReady(); return registry.Selections.Count; } } }
        public PresentationEncodedAssetCache EncodedCache { get { lock (gate) { EnsureReady(); return cache; } } }

        public PresentationRuntimeHost(string registryPath, PresentationEncodedAssetCache cache)
        {
            this.cache = cache ?? throw new ArgumentNullException(nameof(cache));
            registry = new SessionSelectionRegistry(registryPath);
            try { cache.RecoverSessions(registry.Selections.Select(selection => selection.ToCacheSelection()).ToArray()); }
            catch { faulted = true; registry.Dispose(); throw; }
        }

        public void PrepareDelivery(DeliveryManifest delivery)
        {
            if (delivery == null) throw new ArgumentNullException(nameof(delivery));
            PresentationRuntimeDataStore validator = new PresentationRuntimeDataStore();
            if (!validator.TryReceiveDelivery(delivery, out string validationError))
                throw new InvalidOperationException(validationError ?? "Control Plane Delivery is incompatible.");
            var assets = new List<SessionSelectionRegistry.Asset>();
            foreach (TextureResidencyBinding binding in delivery.Residency.Textures.Textures)
            {
                if (!validator.TryGetAsset(binding.AssetId, out AssetAccessBinding asset))
                    throw new InvalidOperationException("Control Plane Delivery asset is missing.");
                assets.Add(new SessionSelectionRegistry.Asset
                {
                    Checksum = asset.Checksum,
                    EncodedSizeBytes = asset.EncodedSizeBytes,
                    MediaType = asset.MediaType,
                });
            }
            var selection = new SessionSelectionRegistry.Selection
            {
                SessionId = delivery.SessionId,
                ParticipantId = delivery.ProjectionInstance.ParticipantId,
                PresentationId = delivery.Publication.PresentationId,
                PublicationEpoch = delivery.Publication.PublicationEpoch,
                PublicationManifestHash = delivery.Publication.PublicationManifestHash,
                AssignmentEpoch = delivery.ProjectionInstance.AssignmentEpoch,
                ProjectionProfileId = delivery.ProjectionProfile.ProjectionProfileId,
                Assets = assets,
            };
            lock (gate)
            {
                EnsureReady();
                try
                {
                    registry.Upsert(selection);
                    if (!cache.ReplaceSelection(selection.ConsumerToken, selection.ToCacheSelection().Assets, out string error))
                        throw new InvalidOperationException(error ?? "asset-cache-selection-invalid");
                }
                catch { faulted = true; throw; }
            }
        }

        public void RemoveConfirmedSelection(string sessionId, string participantId)
        {
            if (string.IsNullOrWhiteSpace(sessionId) || string.IsNullOrWhiteSpace(participantId))
                throw new ArgumentException("A confirmed selection identity is required.");
            lock (gate)
            {
                EnsureReady();
                try
                {
                    registry.Remove(sessionId, participantId);
                    cache.RemoveSelection(ConsumerToken(sessionId, participantId));
                }
                catch { faulted = true; throw; }
            }
        }

        private void EnsureReady()
        {
            if (disposed) throw new ObjectDisposedException(nameof(PresentationRuntimeHost));
            if (faulted || !cache.IsReady) throw new InvalidOperationException("presentation-runtime-host-not-ready");
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (disposed) return;
                disposed = true;
                registry.Dispose();
            }
        }
    }
}

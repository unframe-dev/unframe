using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Unframe.Delivery;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationSceneRenderer : IDisposable
    {
        private PresentationBakedSurfaceRenderer baked;
        private PresentationNativeSurfaceRenderer native;
        public PresentationVideoResidency Videos { get; private set; }
        public PresentationModelResidency Models { get; private set; }
        private PresentationRuntimeAssetFiles files;
        private bool loaded;
        private bool interactionsEnabled;
        public PresentationTextureResidency Textures { get; private set; }

        public bool HasResidentAssets(PresentationRuntimeDataStore store)
        {
            return loaded && files.IsReady && native.IsReady && Models.IsReady
                && store.Delivery?.Residency?.Textures != null && Textures.IsReady(store.Delivery.Residency.Textures.Textures);
        }

        public bool IsReady(PresentationRuntimeDataStore store) => HasResidentAssets(store) && Videos.IsReady(store);

        public async Task LoadAsync(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy,
            Func<AssetAccessBinding, CancellationToken, Task<byte[]>> readAsset, CancellationToken token)
        {
            Dispose();
            if (store?.Delivery == null || hierarchy == null || readAsset == null)
                throw new ArgumentException("A validated Delivery, hierarchy and asset reader are required.");
            if (store.Delivery.ProjectionProfile.LocalOverlays.Count != 0)
                throw new InvalidOperationException("local-overlays-unsupported");
            if (!PresentationRichDeliveryValidation.TryValidateRuntime(store.Delivery, out string validationError))
                throw new InvalidOperationException(validationError);
            files = new PresentationRuntimeAssetFiles();
            Textures = new PresentationTextureResidency();
            baked = new PresentationBakedSurfaceRenderer();
            native = new PresentationNativeSurfaceRenderer();
            Videos = new PresentationVideoResidency { Limits = store.Delivery.CapabilityProfile.Limits.Video };
            Models = new PresentationModelResidency { Limits = store.Delivery.CapabilityProfile.Limits.Model };
            try
            {
                foreach (AssetAccessBinding asset in store.Delivery.AssetAccess)
                {
                    token.ThrowIfCancellationRequested();
                    byte[] bytes = await readAsset(asset, token);
                    files.Add(asset, bytes);
                    foreach (TextureResidencyBinding binding in store.Delivery.Residency.Textures.Textures)
                        if (binding.AssetId == asset.AssetId && !Textures.TryLoad(binding, asset, bytes, out string error))
                            throw new InvalidOperationException(error);
                }
                if (!baked.TryBuild(store, hierarchy, out string buildError)
                    || !native.TryBuild(store, hierarchy, files.Paths, out buildError)) throw new InvalidOperationException(buildError);
                var modelBudget = new PresentationModelTextureBudget
                {
                    Limits = store.Delivery.CapabilityProfile.Limits.Texture,
                    UsedGpuBytes = Textures.ResidentGpuBytes,
                    UsedBindings = (ulong)store.Delivery.Residency.Textures.Textures.Count,
                };
                foreach (ModelResidencyBinding binding in store.Delivery.Residency.Models.Models)
                {
                    if (!store.TryGetAsset(binding.AssetId, out AssetAccessBinding access)
                        || !files.Paths.TryGetValue(binding.AssetId, out string path))
                        throw new InvalidOperationException("model-asset-file-absent");
                    await Models.LoadAsync(binding, access, File.ReadAllBytes(path), token, modelBudget);
                }
                await Models.InstantiateAsync(store, hierarchy, token);
                await Videos.BuildAsync(store, hierarchy, (id, cancellation) =>
                {
                    cancellation.ThrowIfCancellationRequested();
                    if (!store.TryGetAsset(id, out AssetAccessBinding access) || !files.Paths.TryGetValue(id, out string path))
                        throw new InvalidOperationException("video-asset-file-absent");
                    return Task.FromResult(new PresentationPreviewAssetData(File.ReadAllBytes(path), access.MediaType));
                }, token);
                token.ThrowIfCancellationRequested();
                loaded = true;
                if (!IsReady(store)) throw new InvalidOperationException("asset_residency_lost");
            }
            catch { Dispose(); throw; }
        }

        public bool TryRefresh(PresentationRuntimeDataStore store, double time, out string error)
        {
            error = "asset_residency_lost";
            if (!HasResidentAssets(store)) { Disable(); return false; }
            if (baked.TryRefresh(store, Textures, time, out error) && native.TryRefresh(store, time, out error))
            { interactionsEnabled = true; return true; }
            Disable();
            return false;
        }

        public bool TryPickInteraction(Ray ray, PresentationRuntimeDataStore store, out string surfaceId, out string interactionId)
        {
            surfaceId = null;
            interactionId = null;
            if (!loaded || !interactionsEnabled) return false;
            bool picked = baked.TryPickInteraction(ray, store, Textures, out string selectedSurface, out string selectedInteraction, out float nearest);
            bool nativePicked = native.TryPickInteraction(ray, store, out string nativeSurface, out string nativeInteraction, out float nativeDistance);
            if (IsNearer(nativeSurface, nativeDistance, selectedSurface, nearest))
            { picked = nativePicked; selectedSurface = nativeSurface; selectedInteraction = nativeInteraction; nearest = nativeDistance; }
            bool videoPicked = Videos.TryPickInteraction(ray, store, out string videoSurface, out string videoInteraction, out float videoDistance);
            if (IsNearer(videoSurface, videoDistance, selectedSurface, nearest))
            { picked = videoPicked; selectedSurface = videoSurface; selectedInteraction = videoInteraction; }
            if (!picked) return false;
            surfaceId = selectedSurface; interactionId = selectedInteraction;
            return true;
        }

        private static bool IsNearer(string candidate, float distance, string selected, float nearest) =>
            candidate != null && (distance < nearest || distance == nearest && (selected == null || StringComparer.Ordinal.Compare(candidate, selected) < 0));

        public void Disable() { interactionsEnabled = false; baked?.Disable(); native?.Disable(); Videos?.Pause(); }

        public void Dispose()
        {
            loaded = interactionsEnabled = false;
            Videos?.Dispose(); Videos = null;
            Models?.Dispose(); Models = null;
            native?.Dispose(); native = null;
            baked?.Dispose(); baked = null;
            Textures?.Dispose(); Textures = null;
            files?.Dispose(); files = null;
        }
    }
}

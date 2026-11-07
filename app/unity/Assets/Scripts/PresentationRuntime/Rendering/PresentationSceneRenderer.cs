using System;
using System.Collections.Generic;
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
        public PresentationSpatialRenderer Spatial { get; private set; }
        public PresentationVideoResidency Videos { get; private set; }
        public PresentationModelResidency Models { get; private set; }
        private PresentationRuntimeAssetFiles files;
        private bool loaded;
        private ulong modelGpuBytes, modelTextureBindings;
        private bool interactionsEnabled;
        private PresentationTexturePreloader preloader;
        private string renderedGroup;
        private int activatedFrame = -1;
        private ulong preloadGpu, preloadBindings, preloadCpu;
        public PresentationTextureResidency Textures { get; private set; }

        public bool HasResidentAssets(PresentationRuntimeDataStore store)
        {
            return loaded && files.IsReady && native.IsReady && Spatial.IsReady && Models.IsReady
                && store.Delivery?.Residency?.Textures != null && Textures.IsReady(Textures.Bindings);
        }

        public bool IsReady(PresentationRuntimeDataStore store) => HasResidentAssets(store) && Videos.IsReady(store);

        public async Task LoadAsync(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy,
            Func<AssetAccessBinding, CancellationToken, Task<byte[]>> readAsset, CancellationToken token)
        {
            await StopPreloadingAsync();
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
            Spatial = new PresentationSpatialRenderer();
            Videos = new PresentationVideoResidency { Limits = store.Delivery.CapabilityProfile.Limits.Video };
            Models = new PresentationModelResidency { Limits = store.Delivery.CapabilityProfile.Limits.Model };
            try
            {
                foreach (AssetAccessBinding asset in store.Delivery.AssetAccess)
                {
                    token.ThrowIfCancellationRequested();
                    byte[] bytes = await readAsset(asset, token);
                    files.Add(asset, bytes);
                }
                if (!Spatial.TryBuild(store, hierarchy, out string buildError)
                    || !baked.TryBuild(store, hierarchy, out buildError)
                    || !native.TryBuild(store, hierarchy, files.Paths, out buildError)) throw new InvalidOperationException(buildError);
                while (PrepareTextures(store) == null) { token.ThrowIfCancellationRequested(); await Task.Yield(); }
                var modelBudget = new PresentationModelTextureBudget
                {
                    Limits = store.Delivery.CapabilityProfile.Limits.Texture,
                    UsedGpuBytes = store.Delivery.Residency.Textures.MaximumResidentGpuBytes,
                    UsedBindings = store.Delivery.Residency.Textures.MaximumResidentTextureBindings,
                };
                foreach (ModelResidencyBinding binding in store.Delivery.Residency.Models.Models)
                {
                    if (!store.TryGetAsset(binding.AssetId, out AssetAccessBinding access)
                        || !files.Paths.TryGetValue(binding.AssetId, out string path))
                        throw new InvalidOperationException("model-asset-file-absent");
                    await Models.LoadAsync(binding, access, File.ReadAllBytes(path), token, modelBudget);
                }
                modelGpuBytes = modelBudget.UsedGpuBytes - store.Delivery.Residency.Textures.MaximumResidentGpuBytes;
                modelTextureBindings = modelBudget.UsedBindings - store.Delivery.Residency.Textures.MaximumResidentTextureBindings;
                await Models.InstantiateAsync(store, hierarchy, token);
                await Videos.BuildAsync(store, hierarchy, (id, cancellation) =>
                {
                    cancellation.ThrowIfCancellationRequested();
                    if (!store.TryGetAsset(id, out AssetAccessBinding access) || !files.Paths.TryGetValue(id, out string path))
                        throw new InvalidOperationException("video-asset-file-absent");
                    return Task.FromResult(new PresentationPreviewAssetData(File.ReadAllBytes(path), access.MediaType));
                }, token);
                token.ThrowIfCancellationRequested();
                native.GetTextureUsage(out ulong nativeGpu, out ulong nativeBindings);
                // Video residency has its own limits, independent of the PNG/model texture budget.
                preloadGpu = checked(modelGpuBytes + nativeGpu);
                preloadBindings = checked(modelTextureBindings + nativeBindings);
                preloadCpu = checked(nativeGpu + store.Delivery.Residency.Models.TotalEncodedBytes + store.Delivery.Residency.Video.TotalEncodedBytes
                    + store.Delivery.Residency.Video.MaximumDecodedFrameBytes);
                foreach (var asset in store.Delivery.AssetAccess)
                    if (asset.MediaType == "font/ttf" || asset.MediaType == "font/otf") preloadCpu = checked(preloadCpu + asset.EncodedSizeBytes);
                preloader = new PresentationTexturePreloader(store.Delivery.Residency.Textures, Textures, (binding, cancellation) =>
                {
                    if (!store.TryGetAsset(binding.AssetId, out var access) || !files.Paths.TryGetValue(binding.AssetId, out string path))
                        throw new InvalidOperationException("texture-asset-file-absent");
                    var selected = binding.Clone(); var currentAccess = access.Clone();
                    return Task.Run(() =>
                    {
                        cancellation.ThrowIfCancellationRequested();
                        byte[] bytes = File.ReadAllBytes(path);
                        if (!PresentationTextureResidency.TryPrepare(selected, currentAccess, bytes, out byte[] rgba, cancellation))
                            throw new InvalidOperationException("asset-texture-residency-failed");
                        return rgba;
                    }, cancellation);
                });
                loaded = true;
                if (!IsReady(store)) throw new InvalidOperationException("asset_residency_lost");
            }
            catch { Dispose(); throw; }
        }

        public bool TryRefresh(PresentationRuntimeDataStore store, double time, out string error)
        {
            error = "asset_residency_lost";
            if (!HasResidentAssets(store)) { Disable(); return false; }
            try
            {
                var required = PrepareTextures(store);
                if (required == null) { interactionsEnabled = false; error = null; return true; }
                if (baked.TryRefresh(store, Textures, time, out error) && native.TryRefresh(store, time, out error))
                {
                    string groupId = store.Progression?.CurrentGroupId ?? store.Delivery.Residency.Textures.InitialGroupId;
                    preloader.Activate(groupId);
                    if (renderedGroup != groupId) { renderedGroup = groupId; activatedFrame = Time.frameCount; }
                    interactionsEnabled = true;
                    if (!Application.isPlaying || Time.frameCount != activatedFrame)
                        _ = preloader.WarmNextAsync(store.Delivery.CapabilityProfile.Limits.Texture, preloadGpu, preloadBindings, preloadCpu);
                    return true;
                }
            }
            catch (Exception exception) when (exception is InvalidOperationException || exception is IOException)
            { error = exception.Message; return false; }
            Disable();
            return false;
        }

        private List<TextureResidencyBinding> PrepareTextures(PresentationRuntimeDataStore store)
        {
            // GroupExited arrives before GroupEntered; retain the current window until initialization completes.
            if (store.Progression?.CurrentGroupId == "") return null;
            var required = PresentationTextureWindow.Select(store.Delivery.Residency.Textures, store.Progression?.CurrentGroupId);
            string groupId = store.Progression?.CurrentGroupId ?? store.Delivery.Residency.Textures.InitialGroupId;
            ulong otherGpu = preloader == null ? modelGpuBytes : preloadGpu;
            ulong otherBindings = preloader == null ? modelTextureBindings : preloadBindings;
            if (preloader != null && !preloader.PrepareForeground(groupId, required, store.Delivery.CapabilityProfile.Limits.Texture,
                otherGpu, otherBindings)) return null;
            bool ready = PresentationTextureWindow.Prepare(Textures, required, store.Delivery.CapabilityProfile.Limits.Texture,
                otherGpu, otherBindings, () => baked.DetachTextures(), binding =>
                {
                    if (!store.TryGetAsset(binding.AssetId, out var access) || !files.Paths.TryGetValue(binding.AssetId, out string path))
                        return false;
                    return Textures.TryLoad(binding, access, File.ReadAllBytes(path), out _);
                });
            return ready ? required : null;
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

        public void Disable() { interactionsEnabled = false; baked?.Disable(); native?.Disable(); Spatial?.Disable(); Videos?.Pause(); }

        public Task StopPreloadingAsync() => preloader?.StopAsync() ?? Task.CompletedTask;

        public void Dispose()
        {
            loaded = interactionsEnabled = false;
            preloader?.Dispose(); preloader = null;
            renderedGroup = null; activatedFrame = -1;
            preloadGpu = preloadBindings = preloadCpu = 0;
            modelGpuBytes = modelTextureBindings = 0;
            Videos?.Dispose(); Videos = null;
            Models?.Dispose(); Models = null;
            native?.Dispose(); native = null;
            Spatial?.Dispose(); Spatial = null;
            baked?.Dispose(); baked = null;
            Textures?.Dispose(); Textures = null;
            files?.Dispose(); files = null;
        }
    }
}

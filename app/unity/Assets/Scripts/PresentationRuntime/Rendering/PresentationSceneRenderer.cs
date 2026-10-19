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
        private PresentationVideoSurfaceRenderer video;
        private PresentationModelRenderer models;
        private PresentationRuntimeAssetFiles files;
        private bool loaded;
        public PresentationTextureResidency Textures { get; private set; }

        public bool IsReady(PresentationRuntimeDataStore store)
        {
            return loaded && files.IsReady && native.IsReady && video.IsReady && models.IsReady
                && store.Delivery?.Residency?.Textures != null && Textures.IsReady(store.Delivery.Residency.Textures.Textures);
        }

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
            video = new PresentationVideoSurfaceRenderer();
            models = new PresentationModelRenderer();
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
                await models.LoadAsync(store, hierarchy, (asset, cancellation) =>
                {
                    cancellation.ThrowIfCancellationRequested();
                    if (!files.Paths.TryGetValue(asset.AssetId, out string path)) throw new InvalidOperationException("model-asset-file-absent");
                    return Task.FromResult(File.ReadAllBytes(path));
                }, token);
                await video.BuildAsync(store, hierarchy, files.Paths, token);
                token.ThrowIfCancellationRequested();
                loaded = true;
                if (!IsReady(store)) throw new InvalidOperationException("asset_residency_lost");
            }
            catch { Dispose(); throw; }
        }

        public bool TryRefresh(PresentationRuntimeDataStore store, double time, out string error)
        {
            error = "asset_residency_lost";
            if (!IsReady(store)) { Disable(); return false; }
            if (baked.TryRefresh(store, Textures, time, out error) && native.TryRefresh(store, time, out error)
                && video.TryRefresh(store, time, out error) && models.TryRefresh(store, time, out error)) return true;
            Disable();
            return false;
        }

        public bool TryPickInteraction(Ray ray, PresentationRuntimeDataStore store, out string surfaceId, out string interactionId)
        {
            surfaceId = null;
            interactionId = null;
            return loaded && baked.TryPickInteraction(ray, store, Textures, out surfaceId, out interactionId);
        }

        public void Disable() { baked?.Disable(); native?.Disable(); video?.Disable(); models?.Disable(); }

        public void Dispose()
        {
            loaded = false;
            video?.Dispose(); video = null;
            models?.Dispose(); models = null;
            native?.Dispose(); native = null;
            baked?.Dispose(); baked = null;
            Textures?.Dispose(); Textures = null;
            files?.Dispose(); files = null;
        }
    }
}

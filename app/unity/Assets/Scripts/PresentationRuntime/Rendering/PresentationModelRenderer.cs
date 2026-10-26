using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationModelRenderer : IDisposable
    {
        private sealed class Instance
        {
            internal string NodeId;
            internal GameObject Root;
            internal GltfImport Import;
            internal Animation Animation;
            internal AnimationClip[] Clips;
            internal UnityEngine.Transform[] Transforms;
            internal UnityEngine.Vector3[] Positions;
            internal UnityEngine.Quaternion[] Rotations;
            internal UnityEngine.Vector3[] Scales;
            internal SkinnedMeshRenderer[] Skins;
            internal float[][] BlendShapes;
            internal Texture2D[] Textures;
        }
        private readonly List<Instance> instances = new List<Instance>();

        public bool IsReady
        {
            get
            {
                foreach (Instance instance in instances)
                {
                    if (instance.Root == null || instance.Import == null || instance.Textures == null) return false;
                    foreach (Texture2D texture in instance.Textures) if (texture == null) return false;
                    foreach (MeshFilter mesh in instance.Root.GetComponentsInChildren<MeshFilter>(true))
                        if (mesh.sharedMesh == null) return false;
                    foreach (SkinnedMeshRenderer mesh in instance.Root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                        if (mesh.sharedMesh == null) return false;
                    foreach (Renderer renderer in instance.Root.GetComponentsInChildren<Renderer>(true))
                        foreach (Material material in renderer.sharedMaterials)
                            if (material == null) return false;
                }
                return true;
            }
        }

        public async Task LoadAsync(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy,
            Func<AssetAccessBinding, CancellationToken, Task<byte[]>> getBytes, CancellationToken token)
        {
            Dispose();
            if (!PresentationModelAssetValidation.ValidatePlan(store?.Delivery)) throw new InvalidOperationException("model-residency-plan-invalid");
            try
            {
                foreach (ProjectedNodeDefinition node in store.Nodes)
                {
                    if (node.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Model) continue;
                    token.ThrowIfCancellationRequested();
                    if (!store.TryGetModel(node.Model.ModelAssetId, out ModelResidencyBinding binding)
                        || !store.TryGetAsset(binding.AssetId, out AssetAccessBinding access)
                        || !hierarchy.Registry.TryGet(node.NodeId, out GameObject host))
                        throw new InvalidOperationException("model-asset-binding-absent");
                    byte[] bytes = await getBytes(access, token);
                    if (!PresentationModelAssetValidation.ValidateBinary(bytes, binding, access))
                        throw new InvalidOperationException("model-binary-invalid-or-external-resource");
                    var instance = new Instance { NodeId = node.NodeId, Root = new GameObject("Model " + node.NodeId), Import = new GltfImport() };
                    instances.Add(instance);
                    instance.Root.transform.SetParent(host.transform, false);
                    // glTFast reflects X; the presentation coordinate contract reflects Z.
                    instance.Root.transform.localRotation = UnityEngine.Quaternion.Euler(0, 180, 0);
                    if (!await instance.Import.Load(bytes, importSettings: new ImportSettings { AnimationMethod = AnimationMethod.Legacy }, cancellationToken: token))
                        throw new InvalidOperationException("model-import-failed");
                    token.ThrowIfCancellationRequested();
                    var importedTextures = new List<Texture2D>();
                    for (int index = 0; index < instance.Import.TextureCount; index++)
                    {
                        Texture2D texture = instance.Import.GetTexture(index);
                        if (texture != null) importedTextures.Add(texture);
                    }
                    instance.Textures = importedTextures.ToArray();
                    if (!await instance.Import.InstantiateSceneAsync(instance.Root.transform, instance.Import.DefaultSceneIndex ?? 0, token)) throw new InvalidOperationException("model-scene-instantiate-failed");
                    token.ThrowIfCancellationRequested();
                    instance.Animation = instance.Root.GetComponentInChildren<Animation>(true);
                    instance.Clips = instance.Import.GetAnimationClips();
                    if (instance.Animation != null)
                    {
                        instance.Animation.Stop();
                        instance.Animation.enabled = false;
                        for (int index = 0; index < instance.Clips.Length; index++)
                            for (int slot = 0; slot < 2; slot++)
                                instance.Animation.AddClip(instance.Clips[index], "presentation-clip-" + index + "-" + slot);
                    }
                    instance.Transforms = instance.Root.GetComponentsInChildren<UnityEngine.Transform>(true);
                    instance.Positions = new UnityEngine.Vector3[instance.Transforms.Length];
                    instance.Rotations = new UnityEngine.Quaternion[instance.Transforms.Length];
                    instance.Scales = new UnityEngine.Vector3[instance.Transforms.Length];
                    for (int i = 0; i < instance.Transforms.Length; i++)
                    {
                        instance.Positions[i] = instance.Transforms[i].localPosition;
                        instance.Rotations[i] = instance.Transforms[i].localRotation;
                        instance.Scales[i] = instance.Transforms[i].localScale;
                    }
                    instance.Skins = instance.Root.GetComponentsInChildren<SkinnedMeshRenderer>(true);
                    instance.BlendShapes = new float[instance.Skins.Length][];
                    for (int skin = 0; skin < instance.Skins.Length; skin++)
                    {
                        int count = instance.Skins[skin].sharedMesh.blendShapeCount;
                        instance.BlendShapes[skin] = new float[count];
                        for (int shape = 0; shape < count; shape++)
                            instance.BlendShapes[skin][shape] = instance.Skins[skin].GetBlendShapeWeight(shape);
                    }
                    foreach (ProjectedModelClipDefinition clip in store.Catalog.ModelClips)
                        if (clip.ModelNodeId == node.NodeId && (clip.ModelAssetId != binding.AssetId || clip.DurationMs == 0 || instance.Animation == null || instance.Clips == null
                            || clip.SourceAnimationIndex >= instance.Clips.Length || Math.Abs(instance.Clips[clip.SourceAnimationIndex].length * 1000d - clip.DurationMs) > 1))
                            throw new InvalidOperationException("model-source-animation-absent");
                }
            }
            catch { Dispose(); throw; }
        }

        public bool TryRefresh(PresentationRuntimeDataStore store, double runtimeTimeMs, out string error)
        {
            error = "model-clip-state-invalid";
            foreach (Instance instance in instances)
            {
                if (!store.TryGetModelClipState(instance.NodeId, out ModelClipRuntimeState state)) continue;
                Restore(instance);
                if (instance.Animation != null) foreach (AnimationState animation in instance.Animation) animation.enabled = false;
                bool valid = true;
                switch (state.StateCase)
                {
                    case ModelClipRuntimeState.StateOneofCase.DefaultPose: break;
                    case ModelClipRuntimeState.StateOneofCase.HeldClip:
                        valid = Pose(store, instance, state.HeldClip.ClipId, state.HeldClip.PositionMs, 1); break;
                    case ModelClipRuntimeState.StateOneofCase.HeldBlend:
                        valid = Pose(store, instance, state.HeldBlend.From.ClipId, state.HeldBlend.From.PositionMs, 1 - state.HeldBlend.ToWeight)
                            && Pose(store, instance, state.HeldBlend.To.ClipId, state.HeldBlend.To.PositionMs, state.HeldBlend.ToWeight, 1); break;
                    case ModelClipRuntimeState.StateOneofCase.Active:
                        RuntimeRunSnapshot active = null;
                        foreach (RuntimeRunSnapshot run in store.ActiveRuns)
                            if (run.RunCase == RuntimeRunSnapshot.RunOneofCase.ModelClip && run.RunId.Equals(state.Active.RunId)) { active = run; break; }
                        if (active == null) { valid = false; break; }
                        ModelClipRunSnapshot model = active.ModelClip;
                        if (model.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single)
                            valid = Playback(store, instance, model.Single, runtimeTimeMs, 1);
                        else if (model.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Crossfade)
                        {
                            var blend = model.Crossfade;
                            double weight = Ease((float)Math.Clamp(ClockPosition(blend.TransitionClock, runtimeTimeMs, 1) / blend.DurationMs, 0, 1), blend.Easing);
                            double fromTime = blend.FromIsHeld ? ClockPosition(blend.From.Playback, 0, 0) : SamplePositionMs(blend.From, runtimeTimeMs, Duration(store, instance, blend.From.ClipId));
                            valid = Pose(store, instance, blend.From.ClipId, fromTime, 1 - weight)
                                && Playback(store, instance, blend.To, runtimeTimeMs, weight, 1);
                        }
                        else valid = false;
                        break;
                    default: valid = false; break;
                }
                if (!valid) { Disable(); return false; }
                instance.Animation?.Sample();
            }
            error = null;
            return true;
        }

        private static void Restore(Instance instance)
        {
            for (int i = 0; i < instance.Transforms.Length; i++)
            {
                instance.Transforms[i].localPosition = instance.Positions[i];
                instance.Transforms[i].localRotation = instance.Rotations[i];
                instance.Transforms[i].localScale = instance.Scales[i];
            }
            for (int skin = 0; skin < instance.Skins.Length; skin++)
                for (int shape = 0; shape < instance.BlendShapes[skin].Length; shape++)
                    instance.Skins[skin].SetBlendShapeWeight(shape, instance.BlendShapes[skin][shape]);
        }

        private static double Duration(PresentationRuntimeDataStore store, Instance instance, string clipId)
        {
            return store.TryGetModelClip(instance.NodeId, clipId, out ProjectedModelClipDefinition definition) ? definition.DurationMs : 0;
        }
        private static bool Playback(PresentationRuntimeDataStore store, Instance instance, ClipPlayback playback, double now, double weight, int slot = 0)
        {
            return Pose(store, instance, playback.ClipId, SamplePositionMs(playback, now, Duration(store, instance, playback.ClipId)), weight, slot);
        }
        private static bool Pose(PresentationRuntimeDataStore store, Instance instance, string clipId, double positionMs, double weight, int slot = 0)
        {
            if (instance.Animation == null || !store.TryGetModelClip(instance.NodeId, clipId, out ProjectedModelClipDefinition definition)
                || instance.Clips == null || definition.SourceAnimationIndex >= instance.Clips.Length) return false;
            AnimationState state = instance.Animation["presentation-clip-" + definition.SourceAnimationIndex + "-" + slot];
            if (state == null) return false;
            state.enabled = true;
            state.weight = (float)weight;
            state.time = (float)(positionMs / 1000);
            state.wrapMode = WrapMode.ClampForever;
            return true;
        }
        private static float Ease(float progress, Easing easing)
        {
            switch (easing)
            {
                case Easing.CubicIn: return progress * progress * progress;
                case Easing.CubicOut: return 1f - Mathf.Pow(1f - progress, 3f);
                case Easing.CubicInOut: return progress < 0.5f ? 4f * progress * progress * progress : 1f - Mathf.Pow(2f - 2f * progress, 3f) / 2f;
                default: return progress;
            }
        }
        public static double SamplePositionMs(ClipPlayback playback, double runtimeTimeMs, double durationMs)
        {
            double position = Math.Max(0, ClockPosition(playback.Playback, runtimeTimeMs, playback.Speed));
            return durationMs <= 0 ? 0 : playback.Loop ? position % durationMs : Math.Min(position, durationMs);
        }
        private static double ClockPosition(PlaybackClock clock, double now, double speed)
        {
            if (clock?.ClockCase == PlaybackClock.ClockOneofCase.Paused) return clock.Paused.PositionMs;
            if (clock?.ClockCase == PlaybackClock.ClockOneofCase.Playing)
                return clock.Playing.PositionAtReferenceMs + Math.Max(0, now - clock.Playing.ReferenceRuntimeTimeMs) * speed;
            return 0;
        }

        public static bool IsSelfContainedBinary(byte[] bytes)
        {
            try
            {
                if (bytes == null || bytes.Length < 20 || BitConverter.ToUInt32(bytes, 0) != 0x46546c67 || BitConverter.ToUInt32(bytes, 4) != 2
                    || BitConverter.ToUInt32(bytes, 8) != bytes.Length || BitConverter.ToUInt32(bytes, 16) != 0x4e4f534a) return false;
                uint length = BitConverter.ToUInt32(bytes, 12);
                if (length > bytes.Length - 20 || length % 4 != 0) return false;
                JObject json = JObject.Parse(Encoding.UTF8.GetString(bytes, 20, (int)length));
                if ((string)json["asset"]?["version"] != "2.0") return false;
                // Delivery authorizes one binary asset. The importer must never resolve secondary resources.
                foreach (JToken token in json.Descendants())
                    if (token is JProperty property && property.Name == "uri") return false;
                return true;
            }
            catch (Exception exception) when (exception is ArgumentException || exception is Newtonsoft.Json.JsonException) { return false; }
        }
        public void Disable()
        {
            foreach (Instance instance in instances)
                foreach (Renderer renderer in instance.Root.GetComponentsInChildren<Renderer>(true)) renderer.enabled = false;
        }
        public void Dispose()
        {
            foreach (Instance instance in instances) { PresentationTextureResidency.Destroy(instance.Root); instance.Import.Dispose(); }
            instances.Clear();
        }
    }
}

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using GLTFast;
using GLTFast.Loading;
using Unframe.Delivery;
using Unframe.Presentation;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationModelResidency : IDisposable
    {
        private sealed class DenyDownloads : IDownloadProvider
        {
            public Task<IDownload> Request(Uri uri) => Task.FromException<IDownload>(new InvalidOperationException("model-external-resource-denied"));
            public Task<ITextureDownload> RequestTexture(Uri uri, bool nonReadable) => Task.FromException<ITextureDownload>(new InvalidOperationException("model-external-resource-denied"));
        }
        private readonly Dictionary<string, GltfImport> imports = new Dictionary<string, GltfImport>();
        private readonly Dictionary<string, GltfImport> checksums = new Dictionary<string, GltfImport>();
        private ulong encoded, nodes, primitives, vertices, triangles;
        private readonly Dictionary<string, ModelResidencyBinding> descriptors = new Dictionary<string, ModelResidencyBinding>();
        public ModelLimits Limits { get; set; } = new ModelLimits
        {
            MaxAssets = 16,
            MaxInstances = 32,
            MaxEncodedBytes = 67108864,
            MaxNodes = 8192,
            MaxPrimitives = 4096,
            MaxVertices = 1000000,
            MaxTriangles = 1000000,
            MaxBonesPerSkin = 256,
            MaxMorphTargetsPerPrimitive = 64,
            MaxAnimationClipsPerAsset = 128
        };
        private readonly Dictionary<string, Dictionary<string, int>> clipIndices = new Dictionary<string, Dictionary<string, int>>();
        private readonly Dictionary<string, string[]> clipNames = new Dictionary<string, string[]>();
        private readonly Dictionary<string, Animation> animations = new Dictionary<string, Animation>();
        private readonly List<GameObject> instances = new List<GameObject>();
        private sealed class Pose
        {
            internal UnityEngine.Transform Transform; internal UnityEngine.Vector3 Position, Scale; internal UnityEngine.Quaternion Rotation;
            internal SkinnedMeshRenderer Mesh; internal float[] Weights;
        }
        private readonly Dictionary<string, List<Pose>> defaults = new Dictionary<string, List<Pose>>();
        private bool disposed;
        public bool IsReady
        {
            get
            {
                if (disposed) return false;
                foreach (GltfImport import in checksums.Values)
                    for (int i = 0; i < import.TextureCount; i++)
                        if (import.GetTexture(i) == null) return false;
                foreach (GameObject instance in instances)
                {
                    if (instance == null) return false;
                    foreach (MeshFilter mesh in instance.GetComponentsInChildren<MeshFilter>(true))
                        if (mesh.sharedMesh == null) return false;
                    foreach (SkinnedMeshRenderer mesh in instance.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                        if (mesh.sharedMesh == null) return false;
                    foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>(true))
                        foreach (Material material in renderer.sharedMaterials)
                            if (material == null) return false;
                }
                return true;
            }
        }
        public async Task LoadAsync(ModelResidencyBinding binding, AssetAccessBinding access, byte[] bytes, CancellationToken token, PresentationModelTextureBudget budget = null)
        {
            if (disposed) throw new ObjectDisposedException(nameof(PresentationModelResidency));
            if (binding == null || bytes == null || bytes.Length > PresentationModelPreflight.MaximumEncodedBytes) throw new InvalidOperationException("asset-model-preflight-invalid");
            bytes = (byte[])bytes.Clone();
            if (access == null || access.AssetId != binding.AssetId || access.Checksum != binding.Checksum || access.MediaType != "model/gltf-binary"
                || access.EncodedSizeBytes != binding.EncodedSizeBytes || !PresentationModelPreflight.TryValidate(bytes, binding, out string error, checksums.ContainsKey(binding.Checksum) ? null : budget, Limits))
                throw new InvalidOperationException("asset-model-preflight-invalid");
            token.ThrowIfCancellationRequested();
            if (checksums.TryGetValue(binding.Checksum, out var shared)) { imports.Add(binding.AssetId, shared); descriptors.Add(binding.AssetId, binding.Clone()); return; }
            encoded = checked(encoded + binding.EncodedSizeBytes); nodes = checked(nodes + binding.NodeCount);
            primitives = checked(primitives + binding.PrimitiveCount); vertices = checked(vertices + binding.VertexCount); triangles = checked(triangles + binding.TriangleCount);
            if (Limits == null || (ulong)checksums.Count >= Limits.MaxAssets || encoded > Limits.MaxEncodedBytes || nodes > Limits.MaxNodes
                || primitives > Limits.MaxPrimitives || vertices > Limits.MaxVertices || triangles > Limits.MaxTriangles
                || binding.MaximumBonesPerSkin > Limits.MaxBonesPerSkin || binding.MaximumMorphTargetsPerPrimitive > Limits.MaxMorphTargetsPerPrimitive
                || binding.AnimationClipCount > Limits.MaxAnimationClipsPerAsset) throw new InvalidOperationException("model-budget-exceeded");
            var importer = new GltfImport(downloadProvider: new DenyDownloads(), deferAgent: new UninterruptedDeferAgent());
            try
            {
                if (!await importer.Load(bytes, importSettings: new ImportSettings
                { AnimationMethod = AnimationMethod.Legacy, GenerateMipMaps = false, TexturesReadable = false }))
                    throw new InvalidOperationException("asset-model-import-failed");
                token.ThrowIfCancellationRequested();
                var importedClips = importer.GetAnimationClips() ?? Array.Empty<AnimationClip>();
                if ((ulong)importedClips.Length != binding.AnimationClipCount) throw new InvalidOperationException("model-animation-metadata-mismatch");
                for (int i = 0; i < importedClips.Length; i++) importedClips[i].name = "clip-" + i;
                if (disposed) throw new OperationCanceledException();
                imports.Add(binding.AssetId, importer);
                checksums.Add(binding.Checksum, importer);
                descriptors.Add(binding.AssetId, binding.Clone());
            }
            catch { importer.Dispose(); throw; }
        }
        public async Task InstantiateAsync(IPresentationRenderView view, PresentationNodeHierarchy hierarchy, CancellationToken token)
        {
            ulong instanceNodes = 0, instancePrimitives = 0, instanceVertices = 0, instanceTriangles = 0;
            foreach (ProjectedNodeDefinition node in view.Catalog.Nodes)
            {
                if (node.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Model) continue;
                token.ThrowIfCancellationRequested();
                if ((ulong)instances.Count >= Limits.MaxInstances) throw new InvalidOperationException("model-instance-budget-exceeded");
                if (!imports.TryGetValue(node.Model.ModelAssetId, out GltfImport importer)
                    || !hierarchy.Registry.TryGet(node.NodeId, out GameObject host)) throw new InvalidOperationException("asset-model-binding-absent");
                var descriptor = descriptors[node.Model.ModelAssetId];
                instanceNodes = checked(instanceNodes + descriptor.NodeCount); instancePrimitives = checked(instancePrimitives + descriptor.PrimitiveCount);
                instanceVertices = checked(instanceVertices + descriptor.VertexCount); instanceTriangles = checked(instanceTriangles + descriptor.TriangleCount);
                if (instanceNodes > Limits.MaxNodes || instancePrimitives > Limits.MaxPrimitives || instanceVertices > Limits.MaxVertices || instanceTriangles > Limits.MaxTriangles)
                    throw new InvalidOperationException("model-instance-budget-exceeded");
                // glTFast owns the imported resources; each node owns a separate scene instance below its spatial wrapper.
                var instance = new GameObject("Model " + node.NodeId);
                instance.transform.SetParent(host.transform, false);
                instances.Add(instance);
                if (!await importer.InstantiateMainSceneAsync(instance.transform)) throw new InvalidOperationException("asset-model-instance-failed");
                token.ThrowIfCancellationRequested();
                if (disposed) { PresentationTextureResidency.Destroy(instance); throw new OperationCanceledException(); }
                Animation animation = instance.GetComponentInChildren<Animation>(true);
                var poses = new List<Pose>();
                foreach (var transform in instance.GetComponentsInChildren<UnityEngine.Transform>(true))
                    poses.Add(new Pose { Transform = transform, Position = transform.localPosition, Rotation = transform.localRotation, Scale = transform.localScale });
                foreach (var mesh in instance.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    var weights = new float[mesh.sharedMesh.blendShapeCount]; for (int i = 0; i < weights.Length; i++) weights[i] = mesh.GetBlendShapeWeight(i);
                    poses.Add(new Pose { Mesh = mesh, Weights = weights });
                }
                defaults.Add(node.NodeId, poses);
                if (animation != null)
                {
                    animation.playAutomatically = false; animation.Stop(); animations.Add(node.NodeId, animation);
                    AnimationClip[] clips = importer.GetAnimationClips(); var names = new string[clips.Length];
                    for (int i = 0; i < clips.Length; i++)
                    {
                        names[i] = clips[i].name;
                        animation.AddClip(clips[i], "__unframe_from_" + i);
                    }
                    clipNames.Add(node.NodeId, names);
                    var indexes = new Dictionary<string, int>();
                    foreach (var clip in view.Catalog.ModelClips)
                    {
                        if (clip.ModelNodeId != node.NodeId) continue;
                        if (clip.ModelAssetId != node.Model.ModelAssetId || clip.SourceAnimationIndex >= clips.Length || indexes.ContainsKey(clip.ClipId)
                            || Math.Abs(clips[(int)clip.SourceAnimationIndex].length * 1000d - clip.DurationMs) > 1)
                            throw new InvalidOperationException("model-clip-catalog-mismatch");
                        indexes.Add(clip.ClipId, (int)clip.SourceAnimationIndex);
                    }
                    clipIndices.Add(node.NodeId, indexes);
                }
            }
        }
        public void ResetPose(string nodeId)
        {
            if (animations.TryGetValue(nodeId, out Animation animation)) animation.Stop();
            if (!defaults.TryGetValue(nodeId, out var poses)) return;
            foreach (var pose in poses)
            {
                if (pose.Transform != null) { pose.Transform.localPosition = pose.Position; pose.Transform.localRotation = pose.Rotation; pose.Transform.localScale = pose.Scale; }
                if (pose.Mesh != null) for (int i = 0; i < pose.Weights.Length; i++) pose.Mesh.SetBlendShapeWeight(i, pose.Weights[i]);
            }
        }
        public bool TrySample(string nodeId, string clipId, double seconds, string previousClipId, double previousSeconds, float weight, out string error)
        {
            error = "model-clip-binding-invalid";
            if (!animations.TryGetValue(nodeId, out Animation animation)) return false;
            if (!clipIndices[nodeId].TryGetValue(clipId, out int index)) return false;
            string[] names = clipNames[nodeId]; foreach (AnimationState state in animation) state.enabled = false;
            if (index >= names.Length) return false;
            void Set(string name, double time, float w) { AnimationState state = animation[name]; state.enabled = true; state.speed = 0; state.time = (float)time; state.weight = w; state.wrapMode = WrapMode.ClampForever; }
            if (previousClipId != null) { if (!clipIndices[nodeId].TryGetValue(previousClipId, out int p) || p >= names.Length) return false; Set("__unframe_from_" + p, previousSeconds, 1 - weight); }
            Set(names[index], seconds, previousClipId == null ? 1 : weight); animation.Sample(); error = null; return true;
        }

        public void Dispose()
        {
            if (disposed) return; disposed = true;
            foreach (GameObject instance in instances) PresentationTextureResidency.Destroy(instance);
            instances.Clear(); animations.Clear(); defaults.Clear(); clipNames.Clear(); clipIndices.Clear();
            foreach (GltfImport importer in checksums.Values) importer.Dispose(); imports.Clear(); checksums.Clear(); descriptors.Clear();
        }
    }
}

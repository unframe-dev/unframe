using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using Unframe.Delivery;
using Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationModelAssetValidation
    {
        public static bool ValidatePlan(DeliveryManifest manifest)
        {
            var plan = manifest?.Residency?.Models;
            if (plan == null) return false;
            if (plan.Models.Count == 0) return plan.ModelInstanceCount == 0 && plan.TotalEncodedBytes == 0 && plan.TotalNodes == 0
                && plan.TotalPrimitives == 0 && plan.TotalVertices == 0 && plan.TotalTriangles == 0;
            var capability = manifest.CapabilityProfile?.Model;
            var limits = manifest.CapabilityProfile?.Limits?.Model;
            if (capability == null || !capability.Supported || capability.ContractVersion != 1
                || !capability.Formats.Contains(ModelFormat.GltfBinary) || limits == null || plan.BudgetTierId != limits.TierId
                || plan.Models.Count > (long)Math.Min(limits.MaxAssets, 32) || plan.ModelInstanceCount > Math.Min(limits.MaxInstances, 128)) return false;
            try
            {
                ulong encoded = 0, nodes = 0, primitives = 0, vertices = 0, triangles = 0, instances = 0;
                var ids = new HashSet<string>();
                foreach (var binding in plan.Models)
                {
                    if (binding == null || !ids.Add(binding.AssetId) || binding.Format != ModelFormat.GltfBinary
                        || binding.MaximumBonesPerSkin > Math.Min(limits.MaxBonesPerSkin, 256)
                        || binding.MaximumMorphTargetsPerPrimitive > Math.Min(limits.MaxMorphTargetsPerPrimitive, 64)
                        || binding.AnimationClipCount > Math.Min(limits.MaxAnimationClipsPerAsset, 128)) return false;
                    foreach (var feature in binding.RequiredFeatures)
                        if (feature == ModelFeature.Unspecified || !Enum.IsDefined(typeof(ModelFeature), feature) || !capability.Features.Contains(feature)) return false;
                    checked { encoded += binding.EncodedSizeBytes; nodes += binding.NodeCount; primitives += binding.PrimitiveCount; vertices += binding.VertexCount; triangles += binding.TriangleCount; }
                }
                foreach (var node in manifest.ProjectionProfile.RuntimeCatalog.Nodes)
                    if (node.Model != null) { if (!ids.Contains(node.Model.ModelAssetId)) return false; instances++; }
                return instances == plan.ModelInstanceCount && encoded == plan.TotalEncodedBytes && nodes == plan.TotalNodes
                    && primitives == plan.TotalPrimitives && vertices == plan.TotalVertices && triangles == plan.TotalTriangles
                    && encoded <= Math.Min(limits.MaxEncodedBytes, 134217728) && nodes <= Math.Min(limits.MaxNodes, 65536)
                    && primitives <= Math.Min(limits.MaxPrimitives, 16384) && vertices <= Math.Min(limits.MaxVertices, 4000000)
                    && triangles <= Math.Min(limits.MaxTriangles, 4000000);
            }
            catch (OverflowException) { return false; }
        }

        public static bool ValidateBinary(byte[] bytes, ModelResidencyBinding binding, AssetAccessBinding access)
        {
            if (binding == null || access == null || bytes == null || binding.AssetId != access.AssetId
                || binding.Checksum != access.Checksum || binding.EncodedSizeBytes != access.EncodedSizeBytes || (ulong)bytes.LongLength != binding.EncodedSizeBytes
                || access.MediaType != "model/gltf-binary" || binding.Format != ModelFormat.GltfBinary || !PresentationModelRenderer.IsSelfContainedBinary(bytes)) return false;
            using (var sha = SHA256.Create())
                if (binding.Checksum != "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant()) return false;
            try
            {
                JObject json = JObject.Parse(Encoding.UTF8.GetString(bytes, 20, checked((int)BitConverter.ToUInt32(bytes, 12))));
                var nodes = json["nodes"] as JArray ?? new JArray();
                var animations = json["animations"] as JArray ?? new JArray();
                if ((ulong)nodes.Count > binding.NodeCount || (ulong)animations.Count > binding.AnimationClipCount) return false;
                // Compressed extensions can expand outside the declared accessors and memory budget.
                if (json["extensionsUsed"] is JArray extensions && extensions.Count != 0)
                    foreach (var extension in extensions) if ((string)extension != "KHR_materials_unlit") return false;
                var required = new HashSet<ModelFeature>();
                if (animations.Count > 0) required.Add(ModelFeature.Animation);
                foreach (JToken skin in json["skins"] as JArray ?? new JArray())
                {
                    required.Add(ModelFeature.Skin);
                    if ((ulong)(skin["joints"] as JArray ?? new JArray()).Count > binding.MaximumBonesPerSkin) return false;
                }
                ulong primitives = 0, vertices = 0, triangles = 0;
                JArray accessors = json["accessors"] as JArray ?? new JArray();
                foreach (JToken mesh in json["meshes"] as JArray ?? new JArray())
                    foreach (JToken primitive in mesh["primitives"] as JArray ?? new JArray())
                    {
                        primitives++;
                        ulong count = AccessorCount(accessors, primitive["attributes"]?["POSITION"]);
                        checked { vertices += count; }
                        ulong indices = primitive["indices"] == null ? count : AccessorCount(accessors, primitive["indices"]);
                        int mode = (int?)primitive["mode"] ?? 4;
                        if (mode < 0 || mode > 6) return false;
                        checked { triangles += mode == 4 ? indices / 3 : mode == 5 || mode == 6 ? indices > 2 ? indices - 2 : 0 : 0; }
                        ulong morphs = (ulong)(primitive["targets"] as JArray ?? new JArray()).Count;
                        if (morphs > 0) required.Add(ModelFeature.MorphTargets);
                        if (morphs > binding.MaximumMorphTargetsPerPrimitive) return false;
                    }
                if (primitives > binding.PrimitiveCount || vertices > binding.VertexCount || triangles > binding.TriangleCount) return false;
                foreach (JToken material in json["materials"] as JArray ?? new JArray())
                {
                    if ((string)material["alphaMode"] == "BLEND") required.Add(ModelFeature.AlphaBlend);
                    if ((string)material["alphaMode"] == "MASK") required.Add(ModelFeature.AlphaMask);
                    if (material["pbrMetallicRoughness"] != null && material["extensions"]?["KHR_materials_unlit"] == null) required.Add(ModelFeature.PbrMetallicRoughness);
                    if (material["extensions"]?["KHR_materials_unlit"] != null) required.Add(ModelFeature.Unlit);
                }
                foreach (ModelFeature feature in required) if (!binding.RequiredFeatures.Contains(feature)) return false;
                // Bound every accessor, including sparse/morph/animation accessors unused by primitives.
                foreach (JToken accessor in accessors)
                    if ((ulong?)accessor["count"] > 4000000 || accessor["sparse"] != null) return false;
                foreach (JToken buffer in json["buffers"] as JArray ?? new JArray())
                    if ((ulong?)buffer["byteLength"] > (ulong)bytes.Length) return false;
                return true;
            }
            catch (Exception exception) when (exception is ArgumentException || exception is OverflowException || exception is Newtonsoft.Json.JsonException || exception is InvalidCastException || exception is InvalidOperationException) { return false; }
        }

        private static ulong AccessorCount(JArray accessors, JToken index)
        {
            if (index == null || (int)index < 0 || (int)index >= accessors.Count) throw new ArgumentException("Model accessor is absent.");
            return (ulong)accessors[(int)index]["count"];
        }
    }
}

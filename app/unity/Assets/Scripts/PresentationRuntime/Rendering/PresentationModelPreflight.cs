using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationModelTextureBudget
    {
        public TextureLimits Limits;
        public ulong UsedGpuBytes;
        public ulong UsedBindings;
    }
    public static class PresentationModelPreflight
    {
        public const int MaximumEncodedBytes = 64 * 1024 * 1024;
        public const long MaximumDecodedAccessorBytes = 64 * 1024 * 1024;
        public static bool TryValidate(byte[] bytes, ModelResidencyBinding binding, out string error, PresentationModelTextureBudget budget = null, ModelLimits limits = null)
        {
            error = "asset-model-preflight-invalid";
            try
            {
                if (bytes == null || binding == null || bytes.Length < 20 || bytes.Length > MaximumEncodedBytes
                    || binding.EncodedSizeBytes != (ulong)bytes.Length || binding.Format != ModelFormat.GltfBinary) return false;
                using (var hash = SHA256.Create())
                    if (binding.Checksum != "sha256:" + BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant()) return false;
                if (Read(bytes, 0) != 0x46546c67 || Read(bytes, 4) != 2 || Read(bytes, 8) != bytes.Length
                    || Read(bytes, 16) != 0x4e4f534a) return false;
                int length = checked((int)Read(bytes, 12));
                if (length <= 0 || length > 4 * 1024 * 1024 || length % 4 != 0 || length > bytes.Length - 20) return false;
                int binOffset = 20 + length, binLength = 0;
                if (binOffset < bytes.Length)
                {
                    if (bytes.Length - binOffset < 8 || Read(bytes, binOffset + 4) != 0x004e4942) return false;
                    binLength = checked((int)Read(bytes, binOffset)); binOffset += 8;
                    if (binLength % 4 != 0 || binLength != bytes.Length - binOffset) return false;
                }
                JObject root;
                string json = new UTF8Encoding(false, true).GetString(bytes, 20, length);
                using (var input = new StringReader(json))
                using (var reader = new JsonTextReader(input) { MaxDepth = 64, DateParseHandling = DateParseHandling.None })
                {
                    int tokens = 0; while (reader.Read())
                    {
                        if (++tokens > 1000000 || reader.TokenType == JsonToken.Float && (double.IsNaN(Convert.ToDouble(reader.Value)) || double.IsInfinity(Convert.ToDouble(reader.Value)))) return false;
                    }
                }
                using (var input = new StringReader(json))
                using (var reader = new JsonTextReader(input) { MaxDepth = 64, DateParseHandling = DateParseHandling.None })
                {
                    root = JObject.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
                    while (reader.Read()) if (reader.TokenType != JsonToken.Comment) return false;
                }
                foreach (var property in root.Descendants())
                    if (property is JProperty field && field.Name == "extensions")
                        foreach (var extension in ((JObject)field.Value).Properties()) if (extension.Name != "KHR_materials_unlit") return false;
                if ((string)root["asset"]?["version"] != "2.0") return false;
                foreach (JToken ext in Array(root, "extensionsUsed")) if ((string)ext != "KHR_materials_unlit") return false;
                foreach (JToken ext in Array(root, "extensionsRequired")) if ((string)ext != "KHR_materials_unlit") return false;
                JArray buffers = Array(root, "buffers"), views = Array(root, "bufferViews"), accessors = Array(root, "accessors");
                if (buffers.Count > 1) return false;
                foreach (JToken buffer in buffers)
                    if (buffer["uri"] != null || Number(buffer, "byteLength") > binLength || Number(buffer, "byteLength") < binLength - 3) return false;
                foreach (JToken view in views)
                {
                    if (Number(view, "buffer") != 0 || Number(view, "byteOffset", 0) + Number(view, "byteLength") > binLength) return false;
                    long stride = Number(view, "byteStride", 0);
                    if (stride != 0 && (stride < 4 || stride > 252 || stride % 4 != 0)) return false;
                }
                foreach (var material in Array(root, "materials")) foreach (var descendant in ((JObject)material).Descendants())
                        if (descendant is JProperty property && (property.Name == "baseColorTexture" || property.Name == "metallicRoughnessTexture" || property.Name == "normalTexture"
                            || property.Name == "occlusionTexture" || property.Name == "emissiveTexture") && Number(property.Value, "texCoord", 0) != 0) return false;
                long decoded = 0;
                foreach (JToken accessor in accessors)
                {
                    long count = Number(accessor, "count"), component = Number(accessor, "componentType");
                    string type = (string)accessor["type"];
                    int dimensions = type == "SCALAR" ? 1 : type == "VEC2" ? 2 : type == "VEC3" ? 3 : type == "VEC4" || type == "MAT2" ? 4 : type == "MAT3" ? 9 : type == "MAT4" ? 16 : 0;
                    int size = component == 5120 || component == 5121 ? 1 : component == 5122 || component == 5123 ? 2 : component == 5125 || component == 5126 ? 4 : 0;
                    if (dimensions == 0 || size == 0 || count <= 0) return false;
                    long expanded = checked(count * dimensions * Math.Max(size, 4));
                    decoded = checked(decoded + expanded);
                    if (decoded > MaximumDecodedAccessorBytes) return false;
                    if (accessor["bufferView"] != null)
                    {
                        JToken view = At(views, Number(accessor, "bufferView"));
                        long element = type == "MAT2" ? ((size * 2 + 3) / 4 * 4) * 2 : type == "MAT3" ? ((size * 3 + 3) / 4 * 4) * 3 : size * dimensions, stride = Number(view, "byteStride", element);
                        if (stride < element || checked(Number(accessor, "byteOffset", 0) + (count - 1) * stride + element) > Number(view, "byteLength")) return false;
                    }
                    // Sparse values are expanded by glTFast; validate their source ranges before import.
                    if (accessor["sparse"] is JObject sparse)
                    {
                        long sparseCount = Number(sparse, "count");
                        if (sparseCount <= 0 || sparseCount > count) return false;
                        long indexType = Number(sparse["indices"], "componentType");
                        int indexSize = indexType == 5121 ? 1 : indexType == 5123 ? 2 : indexType == 5125 ? 4 : 0;
                        if (indexSize == 0 || !Range(sparse["indices"], views, checked(sparseCount * indexSize))
                            || !Range(sparse["values"], views, checked(sparseCount * size * dimensions))) return false;
                    }
                }
                JArray nodes = Array(root, "nodes"), meshes = Array(root, "meshes"), skins = Array(root, "skins"), animations = Array(root, "animations");
                ulong meshPrimitives = 0, meshVertices = 0, meshTriangles = 0; long geometryBytes = 0;
                foreach (var mesh in meshes) foreach (var primitive in Array(mesh, "primitives"))
                    {
                        if (Number(primitive, "mode", 4) != 4) return false;
                        foreach (var attribute in ((JObject)primitive["attributes"]).Properties())
                            if (!SupportedAttribute(attribute.Name)) return false;
                        foreach (var target in Array(primitive, "targets")) foreach (var attribute in ((JObject)target).Properties())
                                if (attribute.Name != "POSITION" && attribute.Name != "NORMAL" && attribute.Name != "TANGENT") return false;
                        long count = Number(At(accessors, Number(primitive["attributes"], "POSITION")), "count");
                        long indices = primitive["indices"] == null ? count : Number(At(accessors, Number(primitive, "indices")), "count");
                        long targets = Array(primitive, "targets").Count;
                        var targetNames = mesh["extras"]?["targetNames"];
                        if (targetNames != null && (!(targetNames is JArray) || ((JArray)targetNames).Count != targets)) return false;
                        meshPrimitives++; meshVertices = checked(meshVertices + (ulong)count); meshTriangles = checked(meshTriangles + (ulong)(indices / 3));
                        geometryBytes = checked(geometryBytes + count * (160 + targets * 48) + indices * 4);
                        if (geometryBytes > MaximumDecodedAccessorBytes || limits != null && ((ulong)targets > limits.MaxMorphTargetsPerPrimitive
                            || meshPrimitives > limits.MaxPrimitives || meshVertices > limits.MaxVertices || meshTriangles > limits.MaxTriangles)) return false;
                    }
                if (nodes.Count > 100000 || (ulong)animations.Count != binding.AnimationClipCount) return false;
                var selected = new HashSet<int>(); var pending = new Stack<int>();
                JArray scenes = Array(root, "scenes");
                foreach (JToken node in Array(At(scenes, Number(root, "scene")), "nodes")) pending.Push(checked((int)(long)node));
                while (pending.Count > 0)
                {
                    int index = pending.Pop(); At(nodes, index); if (!selected.Add(index)) return false;
                    foreach (var child in Array(nodes[index], "children")) pending.Push(checked((int)(long)child));
                }
                if ((ulong)selected.Count != binding.NodeCount) return false;
                var sceneRoots = new HashSet<int>(); foreach (var node in Array(At(scenes, Number(root, "scene")), "nodes")) sceneRoots.Add((int)(long)node);
                long animationBytes = 0;
                foreach (var animation in animations) foreach (var channel in Array(animation, "channels"))
                    {
                        var target = channel["target"]; string path = (string)target?["path"];
                        int targetIndex = checked((int)Number(target, "node")); JToken targetNode = At(nodes, targetIndex);
                        if (sceneRoots.Contains(targetIndex) && (path == "translation" || path == "rotation")) return false;
                        JToken sampler = At(Array(animation, "samplers"), Number(channel, "sampler"));
                        JToken input = At(accessors, Number(sampler, "input")), output = At(accessors, Number(sampler, "output"));
                        long keys = Number(input, "count"), width, copies = 1;
                        string outputType;
                        if (path == "translation" || path == "scale") { width = 3; outputType = "VEC3"; }
                        else if (path == "rotation") { width = 4; outputType = "VEC4"; }
                        else if (path == "weights")
                        {
                            JToken mesh = At(meshes, Number(targetNode, "mesh")); JArray parts = Array(mesh, "primitives");
                            if (parts.Count == 0) return false; width = Array(parts[0], "targets").Count; if (width <= 0) return false;
                            foreach (var primitive in parts) if (Array(primitive, "targets").Count != width) return false;
                            var names = mesh["extras"]?["targetNames"];
                            if (names != null && (!(names is JArray) || ((JArray)names).Count != width)) return false;
                            copies = parts.Count; outputType = "SCALAR";
                        }
                        else return false;
                        string interpolation = sampler["interpolation"] == null ? "LINEAR" : (string)sampler["interpolation"];
                        if (interpolation != "LINEAR" && interpolation != "STEP" && interpolation != "CUBICSPLINE") return false;
                        long outputCount = checked(keys * (path == "weights" ? width : 1) * (interpolation == "CUBICSPLINE" ? 3 : 1));
                        if ((string)input["type"] != "SCALAR" || Number(input, "componentType") != 5126 || Number(output, "componentType") != 5126
                            || (string)output["type"] != outputType || Number(output, "count") != outputCount) return false;
                        animationBytes = checked(animationBytes + keys * width * copies * 64);
                        if (animationBytes > MaximumDecodedAccessorBytes) return false;
                    }
                long bones = 0, primitives = 0, vertices = 0, triangles = 0, morphs = 0;
                foreach (JToken skin in skins) if (limits != null && (ulong)Array(skin, "joints").Count > limits.MaxBonesPerSkin) return false;
                foreach (int selectedIndex in selected)
                {
                    JToken node = nodes[selectedIndex];
                    if (node["skin"] != null) bones = Math.Max(bones, Array(At(skins, Number(node, "skin")), "joints").Count);
                    if (node["mesh"] == null) continue;
                    foreach (JToken primitive in Array(At(meshes, Number(node, "mesh")), "primitives"))
                    {
                        if (Number(primitive, "mode", 4) != 4) return false;
                        long count = Number(At(accessors, Number(primitive["attributes"], "POSITION")), "count");
                        long indices = primitive["indices"] == null ? count : Number(At(accessors, Number(primitive, "indices")), "count");
                        if (indices % 3 != 0) return false;
                        primitives++; vertices += count; triangles += indices / 3; morphs = Math.Max(morphs, Array(primitive, "targets").Count);
                    }
                }
                if ((ulong)primitives != binding.PrimitiveCount || (ulong)vertices != binding.VertexCount || (ulong)triangles != binding.TriangleCount
                    || (ulong)bones != binding.MaximumBonesPerSkin || (ulong)morphs != binding.MaximumMorphTargetsPerPrimitive) return false;
                var parents = new int[nodes.Count]; for (int i = 0; i < parents.Length; i++) parents[i] = -1;
                for (int i = 0; i < nodes.Count; i++) foreach (JToken child in Array(nodes[i], "children"))
                    { int c = checked((int)(long)child); if (c < 0 || c >= nodes.Count || parents[c] != -1) return false; parents[c] = i; }
                for (int i = 0; i < nodes.Count; i++) { int depth = 0; for (int p = i; p != -1; p = parents[p]) if (++depth > 256) return false; }

                long pixels = 0; ulong gpu = 0, bindings = 0;
                JArray images = Array(root, "images"), textures = Array(root, "textures");
                var variantCounts = new long[images.Count];
                foreach (var texture in textures) { long source = Number(texture, "source"); if (source >= images.Count) return false; variantCounts[(int)source]++; }
                for (int imageIndex = 0; imageIndex < images.Count; imageIndex++)
                {
                    JToken image = images[imageIndex];
                    long variants = Math.Max(1, variantCounts[imageIndex]) * 2;
                    if (image["uri"] != null) return false;
                    JToken view = At(views, Number(image, "bufferView"));
                    int start = checked(binOffset + (int)Number(view, "byteOffset", 0)), count = checked((int)Number(view, "byteLength"));
                    if (!TryImageSize(bytes, start, count, out int width, out int height) || width > 2048 || height > 2048) return false;
                    if (budget != null && (budget.Limits == null || (ulong)width > budget.Limits.MaxTextureWidth || (ulong)height > budget.Limits.MaxTextureHeight
                        || (ulong)width * (ulong)height > budget.Limits.MaxTexturePixels)) return false;
                    bindings = checked(bindings + (ulong)variants);
                    gpu = checked(gpu + (ulong)width * (ulong)height * 4 * (ulong)variants);
                    pixels = checked(pixels + (long)width * height);
                    if (pixels > 16 * 1024 * 1024) return false;
                }
                if (budget != null)
                {
                    ulong totalGpu = checked(budget.UsedGpuBytes + gpu), totalBindings = checked(budget.UsedBindings + bindings);
                    ulong cpu = checked((ulong)bytes.Length + (ulong)decoded + (ulong)geometryBytes + (ulong)animationBytes + gpu + (ulong)pixels * 8);
                    if (totalGpu > budget.Limits.MaxGpuBytes || totalBindings > budget.Limits.MaxTextureBindings || cpu > budget.Limits.MaxSerialLoadCpuBytes) return false;
                    budget.UsedGpuBytes = totalGpu; budget.UsedBindings = totalBindings;
                }
                error = null; return true;
            }
            catch (Exception exception) when (exception is JsonException || exception is ArgumentException || exception is InvalidOperationException || exception is OverflowException || exception is IndexOutOfRangeException || exception is InvalidCastException) { return false; }
        }
        private static bool SupportedAttribute(string name)
        {
            if (name == "POSITION" || name == "NORMAL" || name == "TANGENT" || name == "COLOR_0" || name == "JOINTS_0" || name == "WEIGHTS_0") return true;
            return name.Length == 10 && name.StartsWith("TEXCOORD_", StringComparison.Ordinal) && name[9] >= '0' && name[9] <= '7';
        }
        private static bool Range(JToken item, JArray views, long size) => checked(Number(item, "byteOffset", 0) + size) <= Number(At(views, Number(item, "bufferView")), "byteLength");
        private static JArray Array(JToken obj, string name) => obj[name] == null ? new JArray() : obj[name] as JArray ?? throw new ArgumentException(name);
        private static JToken At(JArray array, long index) => index >= 0 && index < array.Count ? array[(int)index] : throw new ArgumentException("index");
        private static long Number(JToken obj, string name, long fallback = -1)
        {
            JToken token = obj?[name]; if (token == null && fallback >= 0) return fallback;
            if (token?.Type != JTokenType.Integer) throw new ArgumentException(name);
            long value = (long)token; if (value < 0 || value > int.MaxValue) throw new ArgumentException(name); return value;
        }
        private static uint Read(byte[] bytes, int offset) => (uint)(bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24);
        private static int Big(byte[] bytes, int offset) => checked((int)((uint)bytes[offset] << 24 | (uint)bytes[offset + 1] << 16 | (uint)bytes[offset + 2] << 8 | bytes[offset + 3]));
        private static bool TryImageSize(byte[] bytes, int start, int length, out int width, out int height)
        {
            width = height = 0; int end = checked(start + length);
            if (start < 0 || end > bytes.Length || length < 24) return false;
            if (bytes[start] == 137 && bytes[start + 1] == 80 && bytes[start + 2] == 78 && bytes[start + 3] == 71)
            { width = Big(bytes, start + 16); height = Big(bytes, start + 20); return width > 0 && height > 0; }
            if (bytes[start] != 255 || bytes[start + 1] != 216) return false;
            int p = start + 2;
            while (p + 4 < end)
            {
                if (bytes[p++] != 255) return false; while (p < end && bytes[p] == 255) p++;
                if (p >= end) return false; int marker = bytes[p++]; if (marker == 217 || marker == 218) return false;
                if (marker == 1 || marker >= 208 && marker <= 215) continue;
                int n = bytes[p] * 256 + bytes[p + 1]; if (n < 2 || p + n > end) return false;
                if (marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207)
                { if (n < 8) return false; height = bytes[p + 3] * 256 + bytes[p + 4]; width = bytes[p + 5] * 256 + bytes[p + 6]; return width > 0 && height > 0; }
                p += n;
            }
            return false;
        }
    }
}

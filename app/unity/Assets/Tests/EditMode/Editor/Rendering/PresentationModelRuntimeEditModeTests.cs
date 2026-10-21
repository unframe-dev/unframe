using System;
using System.IO;
using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.TestTools;
using Unframe.Presentation;
using Unframe.Preview;
using Unframe.Realtime;
using System.Security.Cryptography;
using System.Text;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Unity.PresentationRuntime;

public class PresentationModelRuntimeEditModeTests
{
    internal static byte[] Glb(string json, byte[] bin = null)
    {
        byte[] text = Encoding.UTF8.GetBytes(json.PadRight((Encoding.UTF8.GetByteCount(json) + 3) / 4 * 4));
        bin = bin ?? Array.Empty<byte>();
        using (var stream = new MemoryStream())
        using (var writer = new BinaryWriter(stream))
        {
            writer.Write(0x46546c67u); writer.Write(2u); writer.Write((uint)(20 + text.Length + (bin.Length > 0 ? 8 + bin.Length : 0)));
            writer.Write((uint)text.Length); writer.Write(0x4e4f534au); writer.Write(text);
            if (bin.Length > 0) { writer.Write((uint)bin.Length); writer.Write(0x004e4942u); writer.Write(bin); }
            return stream.ToArray();
        }
    }
    internal static ModelResidencyBinding Binding(byte[] bytes)
    {
        using (var sha = SHA256.Create()) return new ModelResidencyBinding
        {
            AssetId = "model:one",
            Checksum = "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(),
            EncodedSizeBytes = (ulong)bytes.Length,
            Format = ModelFormat.GltfBinary,
            NodeCount = 1,
        };
    }
    [UnityTest]
    public IEnumerator PreviewImportsRealMeshAndDisposesReplacedScene()
    {
        byte[] bytes = Resources.Load<TextAsset>("PresentationFixtures/Model").bytes;
        var binding = Binding(bytes); binding.NodeCount = 3; binding.PrimitiveCount = 1; binding.VertexCount = 3;
        binding.TriangleCount = 1; binding.MaximumBonesPerSkin = 1; binding.MaximumMorphTargetsPerPrimitive = 1; binding.AnimationClipCount = 2;
        Assert.That(PresentationModelPreflight.TryValidate(bytes, binding, out var error), Is.True, error);
        var envelope = PresentationPreviewTestFixture.Create();
        envelope.Projection.ModelResidency = new ModelResidencyPlan { BudgetTierId = "local-web-preview", Models = { binding } };
        envelope.Projection.RuntimeCatalog.Nodes.Add(new ProjectedNodeDefinition { NodeId = "node:model", Owner = new ResourceOwner { Presentation = new PresentationResourceOwner() }, Parent = new SpatialParent { Stage = new StageParent() }, Model = new ModelNode { ModelAssetId = binding.AssetId } });
        envelope.Projection.RuntimeCatalog.ModelClips.Add(new ProjectedModelClipDefinition { ModelNodeId = "node:model", ModelAssetId = binding.AssetId, ClipId = "wave", DurationMs = 1000 });
        envelope.Projection.RuntimeCatalog.ModelClips.Add(new ProjectedModelClipDefinition { ModelNodeId = "node:model", ModelAssetId = binding.AssetId, ClipId = "clip-1", SourceAnimationIndex = 1, DurationMs = 1000 });
        envelope.Projection.VisibleNodeIds.Add("node:model"); envelope.InitialState.NodeStates.Add(PresentationPreviewTestFixture.Node("node:model"));
        envelope.InitialState.NodeStates[envelope.InitialState.NodeStates.Count - 1].Transform.Position.X = 5;
        envelope.AssetSet = "{\"schemaVersion\":2,\"assets\":{\"model:one\":{\"checksum\":\"" + binding.Checksum + "\",\"mediaType\":\"model/gltf-binary\",\"encodedSizeBytes\":" + bytes.Length + "}}}";
        envelope.Assets.Add(new LocalPreviewAsset { AssetId = binding.AssetId, Reference = "model-reference" });
        var root = new GameObject("Model test");
        using (var transaction = new PresentationPreviewTransaction(root.transform))
        {
            Task<string> prepare = transaction.PrepareAsync(envelope, (_, __, ___) => Task.FromResult(new PresentationPreviewAssetData(bytes, "model/gltf-binary")), CancellationToken.None);
            while (!prepare.IsCompleted) yield return null;
            Assert.That(prepare.IsFaulted, Is.False, prepare.Exception?.ToString()); transaction.Commit(envelope.RequestId);
            var mesh = root.GetComponentInChildren<SkinnedMeshRenderer>(); Assert.That(mesh, Is.Not.Null);
            Assert.That(mesh.sharedMesh.vertexCount, Is.EqualTo(3)); Assert.That(mesh.bones.Length, Is.EqualTo(1));
            Assert.That(mesh.sharedMesh.blendShapeCount, Is.EqualTo(1));
            var material = mesh.sharedMaterial;
            Assert.That(material.GetFloat("_ZWrite"), Is.EqualTo(1), "opaque model preserves depth writes at full opacity");
            var playback = new LocalPreviewPlaybackState
            {
                RequestId = envelope.RequestId,
                Sequence = 1,
                CurrentGroupId = "group:first",
                Clock = new RuntimeClockSnapshot { Paused = new Paused() },
                NodeStates = { envelope.InitialState.Clone().NodeStates },
                SurfaceStates = { envelope.InitialState.Clone().SurfaceStates }
            };
            playback.NodeStates[playback.NodeStates.Count - 1].Opacity = .5;
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(mesh.sharedMaterial.GetColor("baseColorFactor").a, Is.EqualTo(.4f).Within(.001f), "glTF base color participates in node opacity");
            Assert.That(mesh.sharedMaterial.GetFloat("_ZWrite"), Is.EqualTo(0));
            playback.Sequence = 2; playback.NodeStates[playback.NodeStates.Count - 1].Opacity = 1;
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(mesh.sharedMaterial.GetFloat("_ZWrite"), Is.EqualTo(1), "full opacity restores original material state");
            playback.Sequence = 3; playback.ModelClipStates.Add(new ModelClipRuntimeState
            {
                ModelNodeId = "node:model",
                HeldBlend = new BlendHeldPose
                {
                    From = new ClipHeldPose { ClipId = "wave", PositionMs = 500 },
                    To = new ClipHeldPose { ClipId = "clip-1", PositionMs = 500 },
                    ToWeight = .5
                }
            });
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(mesh.bones[0].localPosition.y, Is.EqualTo(0).Within(.001f));
            Assert.That(mesh.GetBlendShapeWeight(0), Is.EqualTo(.375f).Within(.001f), "held crossfade reconstructs its mixed morph pose");
            playback.Sequence = 4; playback.ModelClipStates[0].HeldClip = new ClipHeldPose { ClipId = "wave", PositionMs = 1000 };
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(mesh.bones[0].localPosition.y, Is.EqualTo(2).Within(.001f));
            playback.Sequence = 5; playback.ModelClipStates[0].DefaultPose = new DefaultModelPose();
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(mesh.bones[0].localPosition.y, Is.EqualTo(0).Within(.001f), "default restores imported pose");
            var runId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 1 };
            playback.Sequence = 6; playback.Clock.RuntimeTimeMs = 250;
            playback.ModelClipStates[0].Active = new ModelClipActive { RunId = runId };
            playback.ActiveRuns.Add(new RuntimeRunSnapshot
            {
                RunId = runId,
                Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
                Cause = new RuntimeRunCause { CueId = "cue:clip", CauseEventId = "event:clip" },
                Completion = RunCompletion.NonBlocking,
                ModelClip = new ModelClipRunSnapshot
                {
                    ModelNodeId = "node:model",
                    Single = new ClipPlayback
                    {
                        ClipId = "wave",
                        Speed = 2,
                        Loop = true,
                        Playback = new PlaybackClock { Playing = new PlayingClock() }
                    }
                }
            });
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(mesh.bones[0].localPosition.y, Is.EqualTo(1).Within(.001f), "clip speed samples the logical clock");
            Assert.That(transaction.TryUpdate(100, out error), Is.True, error);
            Assert.That(mesh.bones[0].localPosition.y, Is.EqualTo(1).Within(.001f), "global paused clock retains pose");
            playback.Sequence = 7; playback.Clock.Running = new Running();
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(transaction.TryUpdate(.125, out error), Is.True, error);
            Assert.That(mesh.bones[0].localPosition.y, Is.EqualTo(1.5).Within(.001f));
            playback.Sequence = 8; playback.ActiveRuns.Clear();
            playback.ModelClipStates[0].HeldBlend = new BlendHeldPose
            {
                From = new ClipHeldPose { ClipId = "wave", PositionMs = 250 },
                To = new ClipHeldPose { ClipId = "wave", PositionMs = 750 },
                ToWeight = .5
            };
            Assert.That(transaction.TryPlayback(playback, 0, out error), Is.True, error);
            Assert.That(mesh.bones[0].localPosition.y, Is.EqualTo(1).Within(.001f), "same-clip crossfade uses two independent sample clocks");
            Assert.That(root.transform.GetChild(0).Find("Presentation Nodes/node:model").localPosition.x, Is.EqualTo(5));
            var next = PresentationPreviewTestFixture.Create('b');
            prepare = transaction.PrepareAsync(next, (_, __, ___) => Task.FromResult<PresentationPreviewAssetData>(null), CancellationToken.None);
            while (!prepare.IsCompleted) yield return null;
            Assert.That(prepare.IsFaulted, Is.False, prepare.Exception?.ToString()); transaction.Commit(next.RequestId);
            Assert.That(root.GetComponentsInChildren<SkinnedMeshRenderer>(true), Is.Empty);
        }
        UnityEngine.Object.DestroyImmediate(root);
    }
    [Test]
    public void VideoPreflightRejectsForgedDimensionsBeforeDecoderAllocation()
    {
        byte[] bytes = Resources.Load<TextAsset>("PresentationFixtures/Video").bytes;
        var artifact = new VideoArtifact { Codec = VideoCodec.H264, PixelSize = new PixelSize { Width = 320, Height = 180 }, HasAudio = true, DurationMs = 6000 };
        Assert.That(PresentationVideoPreflight.TryValidate(bytes, artifact, out var error), Is.True, error);
        artifact.PixelSize.Width = 1; artifact.PixelSize.Height = 1;
        Assert.That(PresentationVideoPreflight.TryValidate(bytes, artifact, out _), Is.False);
        Assert.That(PresentationVideoPreflight.TryValidate(new byte[100], artifact, out _), Is.False);
        artifact.PixelSize.Width = 320; artifact.PixelSize.Height = 180;
        artifact.DurationMs = 1;
        Assert.That(PresentationVideoPreflight.TryValidate(bytes, artifact, out _), Is.False, "movie duration must match the artifact");
        artifact.DurationMs = 6000;
        byte[] cropped = (byte[])bytes.Clone();
        int avc = Tag(cropped, "avc1");
        cropped[avc + 30] = 0; cropped[avc + 31] = 192;
        int track = Tag(cropped, "tkhd");
        int trackSize = (cropped[track - 4] << 24) | (cropped[track - 3] << 16) | (cropped[track - 2] << 8) | cropped[track - 1];
        int heightOffset = track - 4 + trackSize - 4;
        cropped[heightOffset] = 0; cropped[heightOffset + 1] = 192; cropped[heightOffset + 2] = cropped[heightOffset + 3] = 0;
        artifact.PixelSize.Height = 192;
        Assert.That(PresentationVideoPreflight.TryValidate(cropped, artifact, out _), Is.False, "SPS crop remains authoritative when container dimensions agree with a forged artifact");
        byte[] malformed = (byte[])bytes.Clone(); int configuration = Tag(malformed, "avcC");
        malformed[configuration + 10] = malformed[configuration + 11] = 255;
        artifact.PixelSize.Height = 180;
        Assert.That(PresentationVideoPreflight.TryValidate(malformed, artifact, out _), Is.False, "truncated SPS ranges are rejected");
    }
    private static int Tag(byte[] bytes, string name)
    {
        byte[] tag = Encoding.ASCII.GetBytes(name);
        for (int i = 4; i < bytes.Length - 4; i++)
            if (bytes[i] == tag[0] && bytes[i + 1] == tag[1] && bytes[i + 2] == tag[2] && bytes[i + 3] == tag[3])
            {
                if (name == "avc1" && (i + 32 >= bytes.Length || bytes[i + 28] != 1 || bytes[i + 29] != 64)) continue;
                return i;
            }
        throw new InvalidOperationException("fixture tag absent");
    }
    [TestCase("JOINTS_1")]
    [TestCase("TEXCOORD_8")]
    [TestCase("COLOR_1")]
    public void RejectsAttributesOutsideTheSupportedImportSubset(string attribute)
    {
        byte[] original = Resources.Load<TextAsset>("PresentationFixtures/Model").bytes;
        int jsonLength = BitConverter.ToInt32(original, 12), binOffset = 20 + jsonLength;
        var json = Newtonsoft.Json.Linq.JObject.Parse(Encoding.UTF8.GetString(original, 20, jsonLength));
        var attributes = (Newtonsoft.Json.Linq.JObject)json["meshes"][0]["primitives"][0]["attributes"];
        attributes[attribute] = attributes["POSITION"].DeepClone();
        byte[] bin = new byte[BitConverter.ToInt32(original, binOffset)]; System.Array.Copy(original, binOffset + 8, bin, 0, bin.Length);
        byte[] bytes = Glb(json.ToString(Newtonsoft.Json.Formatting.None), bin);
        var binding = Binding(bytes); binding.NodeCount = 3; binding.PrimitiveCount = 1; binding.VertexCount = 3;
        binding.TriangleCount = 1; binding.MaximumBonesPerSkin = 1; binding.MaximumMorphTargetsPerPrimitive = 1; binding.AnimationClipCount = 2;
        Assert.That(PresentationModelPreflight.TryValidate(bytes, binding, out _), Is.False);
    }
    [Test]
    public void RejectsSharedSamplerCurveFanoutBeforeImport()
    {
        var json = new StringBuilder("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"children\":[");
        for (int i = 1; i <= 400; i++) { if (i > 1) json.Append(','); json.Append(i); }
        json.Append("]}"); for (int i = 0; i < 400; i++) json.Append(",{}");
        json.Append("],\"buffers\":[{\"byteLength\":16000}],\"bufferViews\":[{\"buffer\":0,\"byteLength\":4000},{\"buffer\":0,\"byteOffset\":4000,\"byteLength\":12000}],\"accessors\":[{\"bufferView\":0,\"componentType\":5126,\"count\":1000,\"type\":\"SCALAR\"},{\"bufferView\":1,\"componentType\":5126,\"count\":1000,\"type\":\"VEC3\"}],\"animations\":[{\"samplers\":[{\"input\":0,\"output\":1}],\"channels\":[");
        for (int i = 1; i <= 400; i++) { if (i > 1) json.Append(','); json.Append("{\"sampler\":0,\"target\":{\"node\":").Append(i).Append(",\"path\":\"translation\"}}"); }
        json.Append("]}]}");
        byte[] bytes = Glb(json.ToString(), new byte[16000]); var binding = Binding(bytes); binding.NodeCount = 401; binding.AnimationClipCount = 1;
        Assert.That(PresentationModelPreflight.TryValidate(bytes, binding, out _), Is.False);
    }
    [Test]
    public void RejectsUnusedMeshMorphAmplificationBeforeImport()
    {
        byte[] bytes = Glb("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{}],\"buffers\":[{\"byteLength\":12000000}],\"bufferViews\":[{\"buffer\":0,\"byteLength\":12000000}],\"accessors\":[{\"bufferView\":0,\"componentType\":5126,\"count\":1000000,\"type\":\"VEC3\"}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"targets\":[{\"POSITION\":0},{\"POSITION\":0}]}]}]}", new byte[12000000]);
        Assert.That(PresentationModelPreflight.TryValidate(bytes, Binding(bytes), out _), Is.False);
    }
    [Test]
    public void VideoFitsPreserveAspectOrCropTheSourceRectangle()
    {
        Assert.That(PresentationVideoLayout.TryCalculate(320, 180, 2, 2, SurfaceFit.Contain, out var size, out var uv), Is.True);
        Assert.That(size.x, Is.EqualTo(2)); Assert.That(size.y, Is.EqualTo(1.125)); Assert.That(uv, Is.EqualTo(new Rect(0, 0, 1, 1)));
        Assert.That(PresentationVideoLayout.TryCalculate(320, 180, 2, 2, SurfaceFit.Cover, out size, out uv), Is.True);
        Assert.That(size, Is.EqualTo(new UnityEngine.Vector2(2, 2))); Assert.That(uv.width, Is.EqualTo(.5625)); Assert.That(uv.x, Is.EqualTo(.21875));
        Assert.That(PresentationVideoLayout.TryCalculate(320, 180, 2, 2, SurfaceFit.Stretch, out size, out uv), Is.True);
        Assert.That(size, Is.EqualTo(new UnityEngine.Vector2(2, 2))); Assert.That(uv, Is.EqualTo(new Rect(0, 0, 1, 1)));
        Assert.That(PresentationVideoLayout.TryCalculate(320, 180, 2, 2, SurfaceFit.Unspecified, out _, out _), Is.False);
    }
    [Test]
    public void RejectsChecksumAndSelfReportedNodeCountMismatchBeforeImport()
    {
        byte[] bytes = Glb("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{}]}");
        var binding = Binding(bytes);
        Assert.That(PresentationModelPreflight.TryValidate(bytes, binding, out _), Is.True);
        binding.NodeCount = 2;
        Assert.That(PresentationModelPreflight.TryValidate(bytes, binding, out _), Is.False);
        binding.NodeCount = 1; bytes[bytes.Length - 1] ^= 1;
        Assert.That(PresentationModelPreflight.TryValidate(bytes, binding, out _), Is.False);
    }
    [TestCase("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{}],\"accessors\":[{\"componentType\":5126,\"type\":\"MAT4\",\"count\":2147483647}]}")]
    [TestCase("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"children\":[0]}]}")]
    [TestCase("{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{}],\"buffers\":[{\"uri\":\"https://example.test/a.bin\",\"byteLength\":4}]}")]
    public void RejectsUnboundedAccessorCyclesAndExternalResources(string json)
    {
        byte[] bytes = Glb(json);
        Assert.That(PresentationModelPreflight.TryValidate(bytes, Binding(bytes), out _), Is.False);
    }
}

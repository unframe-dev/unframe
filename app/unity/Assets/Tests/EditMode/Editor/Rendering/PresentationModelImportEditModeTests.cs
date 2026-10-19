using System;
using System.Collections;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class PresentationModelImportEditModeTests
{
    [UnityTest]
    public IEnumerator BinaryTriangleIsRenderedAndAnimationUsesRuntimeClock()
    {
        yield return new EnterPlayMode();
        yield return ImportInPlayMode();
        yield return new ExitPlayMode();
    }

    private static IEnumerator ImportInPlayMode()
    {
        byte[] bytes = Triangle();
        DeliveryManifest manifest = Manifest(bytes);
        var store = new PresentationRuntimeDataStore();
        Assert.That(store.TryReceiveDelivery(manifest, out string error), Is.True, error);
        var root = new GameObject("Model Test");
        var hierarchy = new PresentationNodeHierarchy();
        var renderer = new PresentationModelRenderer();
        try
        {
            Assert.That(hierarchy.TryReplace(store, root.transform, out error), Is.True, error);
            Task load = renderer.LoadAsync(store, hierarchy, (_, token) => Task.FromResult(bytes), CancellationToken.None);
            while (!load.IsCompleted) yield return null;
            if (load.IsFaulted) throw load.Exception;
            Assert.That(renderer.IsReady, Is.True);
            Assert.That(hierarchy.Registry.TryGet("node:cube", out GameObject host), Is.True);
            MeshFilter mesh = host.GetComponentInChildren<MeshFilter>(true);
            Assert.That(mesh, Is.Not.Null);
            Assert.That(mesh.sharedMesh.vertexCount, Is.EqualTo(3));
            Assert.That(mesh.sharedMesh.triangles.Length, Is.EqualTo(3));
            var snapshot = Snapshot();
            var runId = new RuntimeRunId { AssignmentEpoch = 1, RunSequence = 99 };
            snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ModelClipStates.Add(new ModelClipRuntimeState
            { ModelNodeId = "node:cube", Active = new ModelClipActive { RunId = runId.Clone() } });
            snapshot.ConnectionSnapshot.Snapshot.RuntimeView.ActiveRuns.Add(new RuntimeRunSnapshot
            {
                RunId = runId, Owner = new RuntimeRunOwner { Presentation = new PresentationRunOwner() },
                Cause = new RuntimeRunCause { CueId = "cue:wave", CauseEventId = "event:wave" }, Completion = RunCompletion.NonBlocking,
                ModelClip = new ModelClipRunSnapshot { ModelNodeId = "node:cube", Single = new ClipPlayback
                { ClipId = "wave", Speed = 1, Playback = new PlaybackClock { Playing = new PlayingClock() } } },
            });
            Assert.That(store.TryReceiveControl(snapshot, out error), Is.True, error);
            Assert.That(renderer.TryRefresh(store, 500, out error), Is.True, error);
            UnityEngine.Vector3 position = host.transform.InverseTransformPoint(mesh.transform.position);
            Assert.That(position.x, Is.EqualTo(1).Within(0.01));
            Assert.That(renderer.TryRefresh(store, 750, out error), Is.True, error);
            Assert.That(host.transform.InverseTransformPoint(mesh.transform.position).x, Is.EqualTo(1.5).Within(0.01));
            UnityEngine.Object.DestroyImmediate(mesh.sharedMesh);
            Assert.That(renderer.IsReady, Is.False);
        }
        finally { renderer.Dispose(); hierarchy.Clear(); UnityEngine.Object.Destroy(root); }
    }

    [Test]
    public void BinaryMetadataAndChecksumMustMatchDeclaredResidency()
    {
        byte[] bytes = Triangle();
        DeliveryManifest manifest = Manifest(bytes);
        var binding = manifest.Residency.Models.Models[0];
        var access = manifest.AssetAccess[0];
        Assert.That(PresentationModelAssetValidation.ValidatePlan(manifest), Is.True);
        Assert.That(PresentationModelAssetValidation.ValidateBinary(bytes, binding, access), Is.True);
        binding.VertexCount = 2;
        Assert.That(PresentationModelAssetValidation.ValidateBinary(bytes, binding, access), Is.False);
        binding.VertexCount = 3;
        binding.AnimationClipCount = 0;
        Assert.That(PresentationModelAssetValidation.ValidateBinary(bytes, binding, access), Is.False);
        binding.AnimationClipCount = 1;
        bytes[bytes.Length - 1] ^= 1;
        Assert.That(PresentationModelAssetValidation.ValidateBinary(bytes, binding, access), Is.False);
        manifest.CapabilityProfile.Limits.Model.MaxInstances = 0;
        Assert.That(PresentationModelAssetValidation.ValidatePlan(manifest), Is.False);
    }

    private static DeliveryManifest Manifest(byte[] bytes)
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseDelivery(PresentationTestFixtures.Load("LocalDelivery").text,
            out DeliveryManifest manifest, out string error), Is.True, error);
        string checksum;
        using (var sha = SHA256.Create()) checksum = "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        manifest.CapabilityProfile.Model = new ModelCapability { Supported = true, ContractVersion = 1,
            Formats = { ModelFormat.GltfBinary }, Features = { ModelFeature.Animation } };
        manifest.CapabilityProfile.Limits = new CapabilityLimits { Model = new ModelLimits
        { TierId = "model-test", MaxAssets = 1, MaxInstances = 1, MaxEncodedBytes = 10000, MaxNodes = 1, MaxPrimitives = 1, MaxVertices = 3, MaxTriangles = 1, MaxAnimationClipsPerAsset = 1 } };
        manifest.AssetAccess[0] = new AssetAccessBinding { AssetId = "asset:storyboard-cube", Checksum = checksum,
            EncodedSizeBytes = (ulong)bytes.Length, MediaType = "model/gltf-binary", Url = "https://example.com/model.glb", ExpiresAtUnixMs = ulong.MaxValue };
        manifest.Residency.Models = new ModelResidencyPlan { BudgetTierId = "model-test", ModelInstanceCount = 1,
            TotalEncodedBytes = (ulong)bytes.Length, TotalNodes = 1, TotalPrimitives = 1, TotalVertices = 3, TotalTriangles = 1,
            Models = { new ModelResidencyBinding { AssetId = "asset:storyboard-cube", Checksum = checksum, Format = ModelFormat.GltfBinary,
            EncodedSizeBytes = (ulong)bytes.Length, NodeCount = 1, PrimitiveCount = 1, VertexCount = 3, TriangleCount = 1, AnimationClipCount = 1,
            RequiredFeatures = { ModelFeature.Animation } } } };
        manifest.ProjectionProfile.RuntimeCatalog.ModelClips.Add(new ProjectedModelClipDefinition
        { ModelNodeId = "node:cube", ModelAssetId = "asset:storyboard-cube", ClipId = "wave", SourceAnimationIndex = 0, DurationMs = 1000 });
        return manifest;
    }
    private static ControlServerItem Snapshot()
    {
        Assert.That(PresentationContractJsonFixtureLoader.TryParseControlItem(PresentationTestFixtures.Load("LocalSnapshot").text,
            out ControlServerItem snapshot, out string error), Is.True, error);
        return snapshot;
    }
    private static byte[] Triangle()
    {
        const string json = @"{""asset"":{""version"":""2.0""},""scene"":0,""scenes"":[{""nodes"":[0]}],""nodes"":[{""name"":""Animated triangle"",""mesh"":0}],""meshes"":[{""primitives"":[{""attributes"":{""POSITION"":0},""indices"":1}]}],""buffers"":[{""byteLength"":76}],""bufferViews"":[{""buffer"":0,""byteOffset"":0,""byteLength"":36},{""buffer"":0,""byteOffset"":36,""byteLength"":6},{""buffer"":0,""byteOffset"":44,""byteLength"":8},{""buffer"":0,""byteOffset"":52,""byteLength"":24}],""accessors"":[{""bufferView"":0,""componentType"":5126,""count"":3,""type"":""VEC3"",""min"":[0,0,0],""max"":[1,1,0]},{""bufferView"":1,""componentType"":5123,""count"":3,""type"":""SCALAR""},{""bufferView"":2,""componentType"":5126,""count"":2,""type"":""SCALAR"",""min"":[0],""max"":[1]},{""bufferView"":3,""componentType"":5126,""count"":2,""type"":""VEC3""}],""animations"":[{""name"":""wave"",""samplers"":[{""input"":2,""output"":3,""interpolation"":""LINEAR""}],""channels"":[{""sampler"":0,""target"":{""node"":0,""path"":""translation""}}]}]}";
        byte[] encoded = Encoding.UTF8.GetBytes(json.PadRight((json.Length + 3) / 4 * 4));
        using (var stream = new MemoryStream())
        using (var writer = new BinaryWriter(stream))
        {
            writer.Write(0x46546c67u); writer.Write(2u); writer.Write((uint)(28 + encoded.Length + 76));
            writer.Write((uint)encoded.Length); writer.Write(0x4e4f534au); writer.Write(encoded);
            writer.Write(76u); writer.Write(0x004e4942u);
            foreach (float value in new[] { 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f }) writer.Write(value);
            writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)2); writer.Write((ushort)0);
            writer.Write(0f); writer.Write(1f);
            foreach (float value in new[] { 0f, 0f, 0f, 2f, 0f, 0f }) writer.Write(value);
            return stream.ToArray();
        }
    }
}

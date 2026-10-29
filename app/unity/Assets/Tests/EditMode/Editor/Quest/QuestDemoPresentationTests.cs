using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

public sealed class QuestDemoPresentationTests
{
    [Test]
    public void RebindsTheCompiledDemoWithoutInvalidatingItsCrossArtifactHashes()
    {
        var build = QuestDemoPresentation.Load("quest-demo-test-presentation");
        var definition = JObject.Parse(build.DefinitionJson);
        var bundle = JObject.Parse(build.RenderBundleJson);
        var manifest = JObject.Parse(build.BuildManifestJson);
        Assert.That(build.PresentationId, Is.EqualTo("quest-demo-test-presentation"));
        Assert.That(definition.Value<string>("presentationId"), Is.EqualTo(build.PresentationId));
        Assert.That(manifest.Value<string>("presentationId"), Is.EqualTo(build.PresentationId));
        Assert.That(manifest.Value<string>("buildId"), Is.EqualTo(build.BuildId));
        Assert.That(bundle.Value<string>("definitionHash"), Is.EqualTo(Hash(Encoding.UTF8.GetBytes(build.DefinitionJson))));
        Assert.That(manifest.Value<string>("definitionHash"), Is.EqualTo(bundle.Value<string>("definitionHash")));
        Assert.That(manifest.Value<string>("renderBundleHash"), Is.EqualTo(Hash(Encoding.UTF8.GetBytes(build.RenderBundleJson))));
        Assert.That(manifest.Value<string>("assetSetHash"), Is.EqualTo(Hash(Encoding.UTF8.GetBytes(build.AssetSetJson))));
        Assert.That(definition["scene"]["surfaces"].Children().Any(), Is.True);
        Assert.That(build.Assets.Length, Is.GreaterThan(0));
        string output = Environment.GetEnvironmentVariable("UNFRAME_QUEST_DEMO_VERIFICATION_FILE");
        if (!String.IsNullOrEmpty(output))
            File.WriteAllText(output, new JObject {
                ["definition"] = definition, ["renderBundle"] = bundle,
                ["assetSet"] = JObject.Parse(build.AssetSetJson), ["buildManifest"] = manifest
            }.ToString(Formatting.None));
    }

    [Test]
    public void IncludesAllActualAssetBytesWithMatchingChecksumsAndSizes()
    {
        var build = QuestDemoPresentation.Load("quest-demo-test-assets");
        var assets = (JObject)JObject.Parse(build.AssetSetJson)["assets"];
        Assert.That(build.Assets.Select(asset => asset.AssetId), Is.EquivalentTo(assets.Properties().Select(asset => asset.Name)));
        foreach (var asset in build.Assets)
        {
            Assert.That(asset.Bytes.LongLength, Is.EqualTo(assets[asset.AssetId].Value<long>("encodedSizeBytes")));
            Assert.That(Hash(asset.Bytes), Is.EqualTo(assets[asset.AssetId].Value<string>("checksum")));
            Assert.That(asset.MediaType, Is.EqualTo(assets[asset.AssetId].Value<string>("mediaType")));
        }
    }

    [Test]
    public void LoadingForAnotherRoomDoesNotMutateTheBundledTemplateOrOtherBuild()
    {
        string original = Resources.Load<TextAsset>("QuestDemoPresentation/definition").text;
        var first = QuestDemoPresentation.Load("quest-demo-first");
        var second = QuestDemoPresentation.Load("quest-demo-second");
        var repeated = QuestDemoPresentation.Load("quest-demo-first");
        Assert.That(first.BuildId, Is.Not.EqualTo(second.BuildId));
        Assert.That(first.BuildManifestJson, Is.EqualTo(repeated.BuildManifestJson));
        Assert.That(Resources.Load<TextAsset>("QuestDemoPresentation/definition").text, Is.EqualTo(original));
        first.Assets[0].Bytes[0] ^= 1;
        Assert.That(repeated.Assets[0].Bytes[0], Is.Not.EqualTo(first.Assets[0].Bytes[0]));
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("bad/id")]
    [TestCase("bad\"id")]
    public void RejectsInvalidPresentationIds(string id)
    {
        Assert.Throws<ArgumentException>(() => QuestDemoPresentation.Load(id));
    }

    private static string Hash(byte[] bytes)
    {
        using (var sha = SHA256.Create())
            return "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }
}

using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;

public sealed class QuestDemoPresentationAsset
{
    public string AssetId { get; internal set; }
    public string MediaType { get; internal set; }
    public byte[] Bytes { get; internal set; }
}

public sealed class QuestDemoPresentationBuild
{
    public string PresentationId { get; internal set; }
    public string Title { get; internal set; }
    public string BuildId { get; internal set; }
    public string DefinitionJson { get; internal set; }
    public string RenderBundleJson { get; internal set; }
    public string AssetSetJson { get; internal set; }
    public string BuildManifestJson { get; internal set; }
    public QuestDemoPresentationAsset[] Assets { get; internal set; }
}

public static class QuestDemoPresentation
{
    public const string DisplayTitle = "仮プレゼン（接続確認）";
    private const string ResourceRoot = "QuestDemoPresentation/";

    [Serializable]
    private sealed class AssetRecord
    {
        public string assetId;
        public string mediaType;
        public string resourcePath;
        public string checksum;
        public int encodedSizeBytes;
    }

    [Serializable]
    private sealed class Manifest
    {
        public int schemaVersion;
        public string presentationId;
        public string buildId;
        public string title;
        public string definitionHash;
        public string renderBundleHash;
        public string assetSetHash;
        public string buildManifestHash;
        public AssetRecord[] assets;
    }

    public static QuestDemoPresentationBuild Load(string presentationId)
    {
        if (presentationId == null || !Regex.IsMatch(presentationId, @"\A[A-Za-z0-9_-]{1,128}\z"))
            throw new ArgumentException("A presentation identifier is required.", nameof(presentationId));
        var manifest = JsonUtility.FromJson<Manifest>(Encoding.UTF8.GetString(Read(ResourceRoot + "manifest")));
        if (manifest == null || manifest.schemaVersion != 1 || String.IsNullOrWhiteSpace(manifest.title)
            || manifest.assets == null || manifest.assets.Length == 0) throw InvalidDemo();
        string definition = ReadJson("definition", manifest.definitionHash);
        string bundle = ReadJson("render-bundle", manifest.renderBundleHash);
        string assetSet = ReadJson("asset-set", manifest.assetSetHash);
        string buildManifest = ReadJson("build-manifest", manifest.buildManifestHash);

        // Preserve the compiler's canonical number and Unicode encoding when binding the template to a new identity.
        definition = ReplaceField(definition, "presentationId", manifest.presentationId, presentationId);
        string definitionHash = Hash(Encoding.UTF8.GetBytes(definition));
        bundle = ReplaceField(bundle, "definitionHash", manifest.definitionHash, definitionHash);
        string bundleHash = Hash(Encoding.UTF8.GetBytes(bundle));
        string buildId = "quest-demo-build-" + Hash(Encoding.UTF8.GetBytes(definitionHash + "\n" + bundleHash + "\n" + manifest.assetSetHash)).Substring(7);
        buildManifest = ReplaceField(buildManifest, "presentationId", manifest.presentationId, presentationId);
        buildManifest = ReplaceField(buildManifest, "buildId", manifest.buildId, buildId);
        buildManifest = ReplaceField(buildManifest, "definitionHash", manifest.definitionHash, definitionHash);
        buildManifest = ReplaceField(buildManifest, "renderBundleHash", manifest.renderBundleHash, bundleHash);

        var assets = new QuestDemoPresentationAsset[manifest.assets.Length];
        for (int index = 0; index < assets.Length; index++)
        {
            var record = manifest.assets[index];
            if (record == null || record.resourcePath == null
                || !Regex.IsMatch(record.resourcePath, @"\AQuestDemoPresentation/asset-[0-9]{3}\z")) throw InvalidDemo();
            byte[] bytes = Read(record.resourcePath);
            if (bytes.Length != record.encodedSizeBytes || Hash(bytes) != record.checksum) throw InvalidDemo();
            assets[index] = new QuestDemoPresentationAsset { AssetId = record.assetId, MediaType = record.mediaType, Bytes = bytes };
        }
        return new QuestDemoPresentationBuild {
            PresentationId = presentationId, Title = DisplayTitle, BuildId = buildId,
            DefinitionJson = definition, RenderBundleJson = bundle, AssetSetJson = assetSet,
            BuildManifestJson = buildManifest, Assets = assets,
        };
    }

    private static byte[] Read(string resourcePath)
    {
        var resource = Resources.Load<TextAsset>(resourcePath);
        if (resource == null) throw InvalidDemo();
        return resource.bytes;
    }

    private static string ReadJson(string name, string checksum)
    {
        byte[] bytes = Read(ResourceRoot + name);
        if (Hash(bytes) != checksum) throw InvalidDemo();
        return Encoding.UTF8.GetString(bytes);
    }

    private static string ReplaceField(string json, string field, string original, string replacement)
    {
        if (String.IsNullOrEmpty(original) || !Regex.IsMatch(original, @"\A[A-Za-z0-9._:/-]+\z")) throw InvalidDemo();
        string token = "\"" + field + "\":\"" + original + "\"";
        int offset = json.IndexOf(token, StringComparison.Ordinal);
        if (offset < 0 || json.IndexOf(token, offset + token.Length, StringComparison.Ordinal) >= 0) throw InvalidDemo();
        return json.Substring(0, offset) + "\"" + field + "\":\"" + replacement + "\"" + json.Substring(offset + token.Length);
    }

    private static string Hash(byte[] bytes)
    {
        using (var sha = SHA256.Create())
            return "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    private static InvalidOperationException InvalidDemo() => new InvalidOperationException("The bundled demo presentation is invalid.");
}

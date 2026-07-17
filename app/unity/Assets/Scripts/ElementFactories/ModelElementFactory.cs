using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.Networking;

#if UNITY_EDITOR
using UnityEditor;
#endif

public class ModelElementFactory : MonoBehaviour
{
    [SerializeField] private GameObject localTestModelPrefab;
    [SerializeField] private int modelRequestTimeoutSeconds = 30;
    [SerializeField] private string editorFbxCacheDirectory = "Assets/Generated/RemoteModels";
    [SerializeField] private Color fallbackModelMaterialColor = Color.white;

    private static readonly Regex ReferencedTextureRegex = new Regex(
        @"[A-Za-z0-9_\-./\\% ]+\.(?:png|jpg|jpeg|tga)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled
    );

    public GameObject Create(ManifestElement element, Transform parent, int elementOrder = 0)
    {
        if (element == null)
        {
            Debug.LogError("ModelElementFactory: element is null");
            return null;
        }

        ManifestAsset asset = ResolveModelAsset(element);
        bool hasRemoteModel = asset != null && !string.IsNullOrEmpty(asset.url);

        GameObject modelObject = !hasRemoteModel && localTestModelPrefab != null
            ? Instantiate(localTestModelPrefab, parent)
            : new GameObject();

        modelObject.name = $"Model_{element.id}";

        if (hasRemoteModel || localTestModelPrefab == null)
        {
            modelObject.transform.SetParent(parent, false);
        }

        TransformApplier.ApplyModelContainer(modelObject, element.transform, elementOrder);

        if (hasRemoteModel)
        {
            RemoteModelAsset remoteAsset = modelObject.GetComponent<RemoteModelAsset>();
            if (remoteAsset == null)
            {
                remoteAsset = modelObject.AddComponent<RemoteModelAsset>();
            }

            remoteAsset.MarkPending(asset);

            if (!IsSupportedFbxAsset(asset))
            {
                remoteAsset.MarkUnsupported(
                    $"Unsupported remote model asset. filename={asset.filename}, mimeType={asset.mimeType}"
                );
                Debug.LogWarning($"ModelElementFactory: unsupported remote model asset: {asset.url}");
                return modelObject;
            }

            if (Application.isPlaying)
            {
                remoteAsset.MarkDownloading();
                StartCoroutine(LoadRemoteFbx(element, asset, modelObject, remoteAsset));
            }
        }

        return modelObject;
    }

    public static bool IsSupportedFbxAsset(ManifestAsset asset)
    {
        if (asset == null)
        {
            return false;
        }

        return HasFbxExtension(asset.filename) || HasFbxExtension(asset.url);
    }

    public static string ResolveEditorFbxCacheAssetPath(ManifestAsset asset, string cacheDirectory)
    {
        string directory = string.IsNullOrEmpty(cacheDirectory)
            ? "Assets/Generated/RemoteModels"
            : cacheDirectory.TrimEnd('/');

        string key = !string.IsNullOrEmpty(asset?.assetId)
            ? asset.assetId
            : HashForPath(asset?.url ?? asset?.filename ?? "remote-model");

        return $"{directory}/{SanitizeFileToken(key)}.fbx";
    }

    public static ManifestAsset ResolveModelAsset(ManifestElement element)
    {
        if (element == null)
        {
            return null;
        }

        if (element.asset != null && !string.IsNullOrEmpty(element.asset.url))
        {
            return element.asset;
        }

        if (string.IsNullOrEmpty(element.src))
        {
            return element.asset;
        }

        return new ManifestAsset
        {
            assetId = element.assetId,
            url = element.src,
            filename = element.displayName,
            mimeType = ResolveMimeType(element.displayName, element.src),
            sizeBytes = 0
        };
    }

    private IEnumerator LoadRemoteFbx(
        ManifestElement element,
        ManifestAsset asset,
        GameObject target,
        RemoteModelAsset remoteAsset
    )
    {
#if UNITY_EDITOR
        string assetPath = ResolveEditorFbxCacheAssetPath(asset, editorFbxCacheDirectory);
        string fullPath = Path.GetFullPath(assetPath);
        string directoryPath = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(directoryPath))
        {
            Directory.CreateDirectory(directoryPath);
        }

        remoteAsset.MarkDownloading();

        using UnityWebRequest request = UnityWebRequest.Get(asset.url);
        request.downloadHandler = new DownloadHandlerFile(fullPath);
        request.timeout = modelRequestTimeoutSeconds;

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            string error = $"{request.responseCode} / {request.error}";
            remoteAsset.MarkFailed(error);
            yield break;
        }

        ExtractEmbeddedPngTextures(assetPath, fullPath);
        yield return DownloadReferencedTextures(asset.url, assetPath, fullPath);
        ImportFbxAsset(assetPath);

        GameObject importedModel = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
        if (importedModel == null)
        {
            string error = $"Downloaded FBX could not be imported: {assetPath}";
            remoteAsset.MarkFailed(error);
            Debug.LogError($"ModelElementFactory: {error}");
            yield break;
        }

        if (target == null)
        {
            yield break;
        }

        GameObject loadedObject = Instantiate(importedModel, target.transform);
        loadedObject.name = $"LoadedFbx_{element.id}";
        loadedObject.transform.localPosition = Vector3.zero;
        loadedObject.transform.localRotation = Quaternion.identity;
        loadedObject.transform.localScale = Vector3.one;

        AssignTexturesFromModelDirectory(loadedObject, assetPath);

        EnsureRenderableMaterials(loadedObject);

        FitLoadedModelToManifestBounds(loadedObject, element.transform);

        remoteAsset.MarkLoaded(assetPath);
#else
        remoteAsset.MarkUnsupported(
            "Raw FBX runtime loading is not supported by Unity without a runtime importer. " +
            "Use the editor import path or convert generated models to a runtime-loadable format."
        );
        yield break;
#endif
    }

    private void EnsureRenderableMaterials(GameObject root)
    {
        Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
        foreach (Renderer renderer in renderers)
        {
            Material[] materials = renderer.sharedMaterials;
            if (materials == null || materials.Length == 0)
            {
                renderer.sharedMaterial = CreateFallbackModelMaterial();
                continue;
            }

            bool changed = false;
            for (int i = 0; i < materials.Length; i++)
            {
                if (!NeedsFallbackMaterial(materials[i]))
                {
                    continue;
                }

                materials[i] = CreateFallbackModelMaterial();
                changed = true;
            }

            if (changed)
            {
                renderer.sharedMaterials = materials;
            }
        }
    }

    private bool NeedsFallbackMaterial(Material material)
    {
        if (material == null)
        {
            return true;
        }

        if (HasTexture(material))
        {
            return false;
        }

        Color color = ResolveMaterialColor(material);
        return IsDefaultGray(color) || material.name.Contains("Default-Material");
    }

    private Material CreateFallbackModelMaterial()
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null)
        {
            shader = Shader.Find("Standard");
        }

        if (shader == null)
        {
            shader = Shader.Find("Sprites/Default");
        }

        Material material = new Material(shader);

        ApplyMaterialColor(material, fallbackModelMaterialColor);
        return material;
    }

#if UNITY_EDITOR
private IEnumerator DownloadReferencedTextures(string modelUrl, string modelAssetPath, string modelFullPath)
{
    HashSet<string> textureReferences = FindReferencedTexturePaths(modelFullPath);

    if (textureReferences.Count == 0)
    {
        yield break;
    }

    string fullDirectory = Path.GetDirectoryName(modelFullPath);
    string assetDirectory = Path.GetDirectoryName(modelAssetPath)?.Replace("\\", "/");

    if (string.IsNullOrEmpty(fullDirectory) || string.IsNullOrEmpty(assetDirectory))
    {
        Debug.LogWarning(
            $"ModelElementFactory: invalid texture directory. fullDirectory={fullDirectory}, assetDirectory={assetDirectory}"
        );
        yield break;
    }

    foreach (string textureReference in textureReferences)
    {
        string fileName = Path.GetFileName(textureReference.Replace("\\", "/"));
        if (string.IsNullOrEmpty(fileName))
        {
            continue;
        }

        string textureAssetPath = $"{assetDirectory}/{fileName}";
        string textureFullPath = Path.Combine(fullDirectory, fileName);
        string textureUrl = ResolveRelativeAssetUrl(modelUrl, textureReference);


        if (File.Exists(textureFullPath))
        {
            Debug.Log($"ModelElementFactory: texture already exists: {textureAssetPath}");
            AssetDatabase.ImportAsset(textureAssetPath, ImportAssetOptions.ForceUpdate);
            continue;
        }

        using UnityWebRequest request = UnityWebRequest.Get(textureUrl);
        request.downloadHandler = new DownloadHandlerFile(textureFullPath);
        request.timeout = modelRequestTimeoutSeconds;

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            if (File.Exists(textureFullPath))
            {
                File.Delete(textureFullPath);
            }

            Debug.LogWarning(
                $"ModelElementFactory: failed to download referenced texture: {textureUrl} / {request.responseCode} / {request.error}"
            );
            continue;
        }


        AssetDatabase.ImportAsset(textureAssetPath, ImportAssetOptions.ForceUpdate);
    }
}


    private static void ExtractEmbeddedPngTextures(string modelAssetPath, string modelFullPath)
    {
        if (string.IsNullOrEmpty(modelAssetPath) || string.IsNullOrEmpty(modelFullPath))
        {
            return;
        }

        if (!File.Exists(modelFullPath))
        {
            Debug.LogWarning($"ModelElementFactory: FBX file not found for embedded texture extraction: {modelFullPath}");
            return;
        }

        string fullDirectory = Path.GetDirectoryName(modelFullPath);
        string assetDirectory = Path.GetDirectoryName(modelAssetPath)?.Replace("\\", "/");

        if (string.IsNullOrEmpty(fullDirectory) || string.IsNullOrEmpty(assetDirectory))
        {
            Debug.LogWarning(
                $"ModelElementFactory: invalid embedded texture directory. fullDirectory={fullDirectory}, assetDirectory={assetDirectory}"
            );
            return;
        }

        byte[] fbxBytes = File.ReadAllBytes(modelFullPath);

        List<string> textureNames = FindReferencedTextureFileNames(fbxBytes);
        if (textureNames.Count == 0)
        {
            Debug.LogWarning("ModelElementFactory: no referenced texture names found in FBX");
            return;
        }

        List<byte[]> embeddedPngs = ExtractPngByteArrays(fbxBytes);
        Debug.Log($"ModelElementFactory: embedded PNG count={embeddedPngs.Count}");

        if (embeddedPngs.Count == 0)
        {
            Debug.LogWarning("ModelElementFactory: no embedded PNG data found in FBX");
            return;
        }

        int count = Mathf.Min(textureNames.Count, embeddedPngs.Count);

        for (int i = 0; i < count; i++)
        {
            string fileName = Path.GetFileName(textureNames[i].Replace("\\", "/"));
            if (string.IsNullOrEmpty(fileName))
            {
                fileName = $"{i}.png";
            }

            if (!fileName.EndsWith(".png", System.StringComparison.OrdinalIgnoreCase))
            {
                fileName = $"{Path.GetFileNameWithoutExtension(fileName)}.png";
            }

            string textureFullPath = Path.Combine(fullDirectory, fileName);
            string textureAssetPath = $"{assetDirectory}/{fileName}";

            File.WriteAllBytes(textureFullPath, embeddedPngs[i]);

            Debug.Log($"ModelElementFactory: extracted embedded PNG: {textureAssetPath}");

            AssetDatabase.ImportAsset(textureAssetPath, ImportAssetOptions.ForceUpdate);
        }
    }

    private static List<string> FindReferencedTextureFileNames(byte[] fbxBytes)
    {
        List<string> names = new List<string>();

        string text = Encoding.UTF8.GetString(fbxBytes);
        MatchCollection matches = ReferencedTextureRegex.Matches(text);

        foreach (Match match in matches)
        {
            string value = match.Value.Trim();
            string fileName = Path.GetFileName(value.Replace("\\", "/"));

            if (string.IsNullOrEmpty(fileName))
            {
                continue;
            }

            if (!names.Contains(fileName))
            {
                names.Add(fileName);
            }
        }

        return names;
    }

    private static List<byte[]> ExtractPngByteArrays(byte[] bytes)
    {
        List<byte[]> pngs = new List<byte[]>();

        byte[] pngSignature = new byte[]
        {
            0x89, 0x50, 0x4E, 0x47,
            0x0D, 0x0A, 0x1A, 0x0A
        };

        int searchStart = 0;

        while (true)
        {
            int pngStart = IndexOf(bytes, pngSignature, searchStart);
            if (pngStart < 0)
            {
                break;
            }

            int pngEnd = FindPngEnd(bytes, pngStart);
            if (pngEnd < 0)
            {
                break;
            }

            int length = pngEnd - pngStart;
            byte[] pngBytes = new byte[length];
            System.Buffer.BlockCopy(bytes, pngStart, pngBytes, 0, length);

            pngs.Add(pngBytes);

            searchStart = pngEnd;
        }

        return pngs;
    }

    private static int FindPngEnd(byte[] bytes, int pngStart)
    {
        int position = pngStart + 8;

        while (position + 8 <= bytes.Length)
        {
            int chunkLength = ReadBigEndianInt(bytes, position);
            position += 4;

            if (position + 4 > bytes.Length)
            {
                return -1;
            }

            string chunkType = Encoding.ASCII.GetString(bytes, position, 4);
            position += 4;

            int chunkDataAndCrcLength = chunkLength + 4;

            if (position + chunkDataAndCrcLength > bytes.Length)
            {
                return -1;
            }

            position += chunkDataAndCrcLength;

            if (chunkType == "IEND")
            {
                return position;
            }
        }

        return -1;
    }

    private static int ReadBigEndianInt(byte[] bytes, int offset)
    {
        return
            (bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3];
    }

    private static int IndexOf(byte[] source, byte[] pattern, int startIndex)
    {
        for (int i = startIndex; i <= source.Length - pattern.Length; i++)
        {
            bool found = true;

            for (int j = 0; j < pattern.Length; j++)
            {
                if (source[i + j] != pattern[j])
                {
                    found = false;
                    break;
                }
            }

            if (found)
            {
                return i;
            }
        }

        return -1;
    }

    private static void AssignTexturesFromModelDirectory(GameObject root, string modelAssetPath)
    {
        if (root == null || string.IsNullOrEmpty(modelAssetPath))
        {
            return;
        }

        string assetDirectory = Path.GetDirectoryName(modelAssetPath)?.Replace("\\", "/");
        if (string.IsNullOrEmpty(assetDirectory))
        {
            return;
        }

        string[] textureGuids = AssetDatabase.FindAssets("t:Texture2D", new[] { assetDirectory });
        if (textureGuids == null || textureGuids.Length == 0)
        {
            Debug.LogWarning($"ModelElementFactory: no Texture2D assets found in {assetDirectory}");
            return;
        }

        Texture2D texture = null;
        string selectedTexturePath = null;

        foreach (string guid in textureGuids)
        {
            string texturePath = AssetDatabase.GUIDToAssetPath(guid);
            Texture2D candidate = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
            if (candidate == null)
            {
                continue;
            }

            texture = candidate;
            selectedTexturePath = texturePath;
            break;
        }

        if (texture == null)
        {
            return;
        }

        Debug.Log($"ModelElementFactory: assigning texture {selectedTexturePath} to {root.name}");

        Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
        foreach (Renderer renderer in renderers)
        {
            if (renderer == null)
            {
                continue;
            }

            Material[] materials = renderer.sharedMaterials;
            if (materials == null)
            {
                continue;
            }

            bool changed = false;

            for (int i = 0; i < materials.Length; i++)
            {
                Material material = materials[i];

                if (material == null)
                {
                    continue;
                }

                if (material.HasProperty("_BaseMap"))
                {
                    material.SetTexture("_BaseMap", texture);
                    changed = true;
                }

                if (material.HasProperty("_MainTex"))
                {
                    material.SetTexture("_MainTex", texture);
                    changed = true;
                }

                if (material.HasProperty("_BaseColor"))
                {
                    material.SetColor("_BaseColor", Color.white);
                }

                if (material.HasProperty("_Color"))
                {
                    material.SetColor("_Color", Color.white);
                }
            }

            if (changed)
            {
                renderer.sharedMaterials = materials;
            }
        }
    }


    private static void ImportFbxAsset(string assetPath)
    {
        AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate);

        ModelImporter importer = AssetImporter.GetAtPath(assetPath) as ModelImporter;
        if (importer == null)
        {
            return;
        }

        importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
        importer.materialSearch = ModelImporterMaterialSearch.Everywhere;
        importer.materialLocation = ModelImporterMaterialLocation.InPrefab;
        importer.SaveAndReimport();
    }

    private static HashSet<string> FindReferencedTexturePaths(string modelFullPath)
    {
        HashSet<string> texturePaths = new HashSet<string>();
        if (!File.Exists(modelFullPath))
        {
            return texturePaths;
        }

        string text = Encoding.UTF8.GetString(File.ReadAllBytes(modelFullPath));
        MatchCollection matches = ReferencedTextureRegex.Matches(text);
        foreach (Match match in matches)
        {
            string value = match.Value.Trim();
            string fileName = Path.GetFileName(value.Replace("\\", "/"));
            if (string.IsNullOrEmpty(fileName))
            {
                continue;
            }

            texturePaths.Add(value);
        }

        return texturePaths;
    }

    private static string ResolveRelativeAssetUrl(string modelUrl, string relativePath)
    {
        if (!System.Uri.TryCreate(modelUrl, System.UriKind.Absolute, out System.Uri baseUri))
        {
            return relativePath;
        }

        string normalizedPath = relativePath.Replace("\\", "/");
        return new System.Uri(baseUri, normalizedPath).AbsoluteUri;
    }
#endif

    private static bool HasFbxExtension(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        string path = value.Split('?')[0];
        return path.EndsWith(".fbx", System.StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveMimeType(string filename, string url)
    {
        if (HasFbxExtension(filename) || HasFbxExtension(url))
        {
            return "application/octet-stream";
        }

        return null;
    }

    private static void ApplyModelContainerTransform(GameObject obj, ManifestTransform transform)
    {
        TransformApplier.ApplyModelContainer(obj, transform);
    }

    private static float ResolveUniformModelScale(ManifestVector3 scale)
    {
        if (scale == null)
        {
            return 1f;
        }

        float x = Mathf.Abs(scale.x);
        float y = Mathf.Abs(scale.y);
        float z = Mathf.Abs(scale.z);
        if (x <= 0f && y <= 0f && z <= 0f)
        {
            return 1f;
        }

        float rawScale;
        if (z > 0f && !Mathf.Approximately(z, 1f))
        {
            rawScale = Mathf.Max(x, y, z);
            return rawScale;
        }

        if (x > 0f || y > 0f)
        {
            rawScale = Mathf.Max(x, y);
            return rawScale;
        }

        rawScale = z > 0f ? z : 1f;
        return rawScale;
    }

    private static bool HasTexture(Material material)
    {
        return HasTexture(material, "_BaseMap") || HasTexture(material, "_MainTex");
    }

    private static bool HasTexture(Material material, string propertyName)
    {
        return material.HasProperty(propertyName) && material.GetTexture(propertyName) != null;
    }

    private static Color ResolveMaterialColor(Material material)
    {
        if (material.HasProperty("_BaseColor"))
        {
            return material.GetColor("_BaseColor");
        }

        if (material.HasProperty("_Color"))
        {
            return material.GetColor("_Color");
        }

        return Color.gray;
    }

    private static bool IsDefaultGray(Color color)
    {
        return Mathf.Abs(color.r - color.g) < 0.03f
            && Mathf.Abs(color.g - color.b) < 0.03f
            && color.r > 0.35f
            && color.r < 0.65f;
    }

    private static void ApplyMaterialColor(Material material, Color color)
    {
        if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }

        if (material.HasProperty("_Color"))
        {
            material.SetColor("_Color", color);
        }
    }

    private static string SanitizeFileToken(string value)
    {
        char[] chars = value.ToCharArray();
        for (int i = 0; i < chars.Length; i++)
        {
            if (!char.IsLetterOrDigit(chars[i]) && chars[i] != '-' && chars[i] != '_')
            {
                chars[i] = '_';
            }
        }

        return new string(chars);
    }

    private static string HashForPath(string value)
    {
        unchecked
        {
            uint hash = 2166136261;
            for (int i = 0; i < value.Length; i++)
            {
                hash ^= value[i];
                hash *= 16777619;
            }

            return hash.ToString("x8");
        }
    }

    private static void FitLoadedModelToManifestBounds(
        GameObject loadedObject,
        ManifestTransform transform
    )
    {
        if (loadedObject == null || transform == null)
        {
            return;
        }

        Bounds bounds;
        if (!TryGetRenderableBounds(loadedObject, out bounds))
        {
            return;
        }

        Vector2 targetSize = TransformApplier.ToUnitySize(transform);

        float targetWidth = targetSize.x;
        float targetHeight = targetSize.y;

        if (targetWidth <= 0f && targetHeight <= 0f)
        {
            return;
        }

        Vector3 currentSize = bounds.size;

        float scaleByWidth = currentSize.x > 0f && targetWidth > 0f
            ? targetWidth / currentSize.x
            : float.PositiveInfinity;

        float scaleByHeight = currentSize.y > 0f && targetHeight > 0f
            ? targetHeight / currentSize.y
            : float.PositiveInfinity;

        float fitScale = Mathf.Min(scaleByWidth, scaleByHeight);

        if (float.IsInfinity(fitScale) || fitScale <= 0f)
        {
            return;
        }

        loadedObject.transform.localScale *= fitScale;

        // scale変更後にboundsを取り直す
        if (!TryGetRenderableBounds(loadedObject, out Bounds scaledBounds))
        {
            return;
        }

        // world bounds の中心を親コンテナの位置へ寄せる
        Vector3 parentWorldCenter = loadedObject.transform.parent != null
            ? loadedObject.transform.parent.position
            : Vector3.zero;

        Vector3 offsetWorld = parentWorldCenter - scaledBounds.center;

        if (loadedObject.transform.parent != null)
        {
            loadedObject.transform.localPosition += loadedObject.transform.parent.InverseTransformVector(offsetWorld);
        }
        else
        {
            loadedObject.transform.position += offsetWorld;
        }
    }

    private static bool TryGetRenderableBounds(GameObject root, out Bounds bounds)
    {
        Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);

        bool hasBounds = false;
        bounds = new Bounds(root.transform.position, Vector3.zero);

        foreach (Renderer renderer in renderers)
        {
            if (renderer == null)
            {
                continue;
            }

            if (!hasBounds)
            {
                bounds = renderer.bounds;
                hasBounds = true;
            }
            else
            {
                bounds.Encapsulate(renderer.bounds);
            }
        }

        return hasBounds;
    }
}

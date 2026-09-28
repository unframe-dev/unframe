using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Networking;

[Serializable]
public sealed class PreviewScenePayload
{
    public int generation;
    public PreviewNodePayload[] nodes;
    public PreviewTexturePayload[] textures;
    public PreviewQuadPayload[] quads;
    public float[] stageSize;
}
[Serializable]
public sealed class PreviewNodePayload
{
    public string id;
    public string parentId;
    public float[] position;
    public float[] rotation;
    public float[] scale;
}
[Serializable]
public sealed class PreviewTexturePayload
{
    public string id;
    public string url;
}
[Serializable]
public sealed class PreviewQuadPayload
{
    public string id;
    public string nodeId;
    public string textureId;
    public float[] position;
    public float[] size;
    public float[] uvRect;
    public int layer;
}
[Serializable]
public sealed class PreviewFramePayload
{
    public int generation;
    public PreviewNodePayload[] nodes;
    public PreviewQuadFramePayload[] quads;
}
[Serializable]
public sealed class PreviewQuadFramePayload
{
    public string id;
    public bool visible;
    public float opacity;
    public string blendTextureId;
    public float blendWeight;
}
[Serializable]
internal sealed class PreviewEvent
{
    public string source = "unframe-unity-preview";
    public string type;
    public int generation;
    public string message;
}

public sealed class PreviewBridge : MonoBehaviour
{
    private readonly Dictionary<string, Transform> nodes = new Dictionary<string, Transform>();
    private readonly Dictionary<string, Renderer> quads = new Dictionary<string, Renderer>();
    private readonly Dictionary<string, Material> materials = new Dictionary<string, Material>();
    private readonly Dictionary<string, Texture2D> textures = new Dictionary<string, Texture2D>();
    private readonly List<Mesh> meshes = new List<Mesh>();
    private readonly List<UnityWebRequest> requests = new List<UnityWebRequest>();
    private GameObject sceneRoot;
    private Camera previewCamera;
    private int generation;
    private int revision;
    private Vector3 stageSize = new Vector3(2f, 1.5f, 1f);
    private Vector3 focusCenter;
    private float focusRadius = 1f;
    private string view = "front";

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] private static extern void PostPreviewMessage(string json);
#endif

    public static Vector3 ToUnityPosition(float[] value)
    {
        RequireVector(value, 3);
        return new Vector3(value[0], value[1], -value[2]);
    }

    public static Quaternion ToUnityRotation(float[] value)
    {
        RequireVector(value, 4);
        return new Quaternion(-value[0], -value[1], value[2], value[3]);
    }

    public int Generation => generation;
    public int NodeCount => nodes.Count;
    public int QuadCount => quads.Count;

    private void Awake()
    {
        previewCamera = FindPreviewCamera();
    }

    public void LoadScene(string json)
    {
        int requestedGeneration = generation;
        try
        {
            PreviewScenePayload payload = JsonUtility.FromJson<PreviewScenePayload>(json);
            if (payload == null) throw new ArgumentException("Scene payload is missing.");
            requestedGeneration = payload.generation;
            ClearContent();
            generation = requestedGeneration;
            CreateScene(payload);
            currentQuads = payload.quads ?? Array.Empty<PreviewQuadPayload>();
            if (payload.textures == null || payload.textures.Length == 0)
                Emit("loaded", generation);
            else if (Application.isPlaying)
                StartCoroutine(LoadTextures(payload.textures, generation, revision));
        }
        catch (Exception error)
        {
            ClearContent();
            generation = requestedGeneration;
            Emit("error", requestedGeneration, error.Message);
        }
    }

    public void ApplyFrame(string json)
    {
        try
        {
            PreviewFramePayload frame = JsonUtility.FromJson<PreviewFramePayload>(json);
            if (frame == null || frame.generation != generation || sceneRoot == null) return;
            foreach (PreviewNodePayload node in frame.nodes ?? Array.Empty<PreviewNodePayload>())
            {
                if (!nodes.TryGetValue(node.id, out Transform target))
                    throw new ArgumentException($"Unknown node: {node.id}");
                ApplyTransform(target, node);
            }
            foreach (PreviewQuadFramePayload quad in frame.quads ?? Array.Empty<PreviewQuadFramePayload>())
            {
                if (!quads.TryGetValue(quad.id, out Renderer target))
                    throw new ArgumentException($"Unknown quad: {quad.id}");
                if (float.IsNaN(quad.opacity) || quad.opacity < 0f || quad.opacity > 1f)
                    throw new ArgumentException($"Invalid opacity: {quad.id}");
                if (float.IsNaN(quad.blendWeight) || quad.blendWeight < 0f || quad.blendWeight > 1f)
                    throw new ArgumentException($"Invalid blend weight: {quad.id}");
                Material material = materials[quad.id];
                if (!string.IsNullOrEmpty(quad.blendTextureId))
                {
                    if (!textures.TryGetValue(quad.blendTextureId, out Texture2D blendTexture))
                        throw new ArgumentException($"Unknown blend texture: {quad.blendTextureId}");
                    material.SetTexture("_BlendTex", blendTexture);
                    material.SetFloat("_BlendWeight", quad.blendWeight);
                }
                else
                {
                    material.SetFloat("_BlendWeight", 0f);
                }
                target.enabled = quad.visible && quad.opacity > 0f;
                Color color = material.color;
                color.a = quad.opacity;
                material.color = color;
            }
        }
        catch (Exception error)
        {
            Emit("error", generation, error.Message);
        }
    }

    public void SetView(string value)
    {
        if (value != "front" && value != "upper-left" && value != "right")
        {
            Emit("error", generation, $"Unknown view: {value}");
            return;
        }
        view = value;
        PositionCamera();
    }

    public void ClearScene(string unused)
    {
        ClearContent();
    }

    private void CreateScene(PreviewScenePayload payload)
    {
        if (payload.stageSize == null || payload.stageSize.Length != 3 ||
            float.IsNaN(payload.stageSize[0]) || float.IsNaN(payload.stageSize[1]) || float.IsNaN(payload.stageSize[2]) ||
            float.IsInfinity(payload.stageSize[0]) || float.IsInfinity(payload.stageSize[1]) || float.IsInfinity(payload.stageSize[2]) ||
            payload.stageSize[0] <= 0f || payload.stageSize[1] <= 0f || payload.stageSize[2] <= 0f)
            throw new ArgumentException("Invalid stage size.");
        stageSize = new Vector3(payload.stageSize[0], payload.stageSize[1], payload.stageSize[2]);
        ValidateHierarchy(payload.nodes ?? Array.Empty<PreviewNodePayload>());
        sceneRoot = new GameObject("Preview Scene");
        foreach (PreviewNodePayload node in payload.nodes ?? Array.Empty<PreviewNodePayload>())
        {
            if (string.IsNullOrEmpty(node.id) || nodes.ContainsKey(node.id))
                throw new ArgumentException("Duplicate or empty node id.");
            nodes.Add(node.id, new GameObject($"Node {node.id}").transform);
        }
        foreach (PreviewNodePayload node in payload.nodes ?? Array.Empty<PreviewNodePayload>())
        {
            Transform target = nodes[node.id];
            if (string.IsNullOrEmpty(node.parentId))
                target.SetParent(sceneRoot.transform, false);
            else if (nodes.TryGetValue(node.parentId, out Transform parent) && parent != target)
                target.SetParent(parent, false);
            else
                throw new ArgumentException($"Invalid parent: {node.parentId}");
            ApplyTransform(target, node);
        }
        HashSet<string> textureIds = new HashSet<string>();
        foreach (PreviewTexturePayload texture in payload.textures ?? Array.Empty<PreviewTexturePayload>())
        {
            if (string.IsNullOrEmpty(texture.id) || string.IsNullOrEmpty(texture.url) || !textureIds.Add(texture.id))
                throw new ArgumentException("Invalid texture id or URL.");
#if UNITY_WEBGL && !UNITY_EDITOR
            string origin = new Uri(Application.absoluteURL).GetLeftPart(UriPartial.Authority);
            if (!texture.url.StartsWith($"blob:{origin}/", StringComparison.Ordinal))
                throw new ArgumentException("Texture URL must be a same-origin blob URL.");
#endif
        }
        Shader shader = Resources.Load<Shader>("PreviewUnlitTransparent");
        if (shader == null) throw new InvalidOperationException("Preview shader is unavailable.");
        foreach (PreviewQuadPayload quad in payload.quads ?? Array.Empty<PreviewQuadPayload>())
        {
            if (string.IsNullOrEmpty(quad.id) || quads.ContainsKey(quad.id) || !nodes.ContainsKey(quad.nodeId) || !textureIds.Contains(quad.textureId))
                throw new ArgumentException($"Invalid quad reference: {quad.id}");
            RequireVector(quad.position, 3);
            RequireVector(quad.size, 2);
            RequireVector(quad.uvRect, 4);
            if (quad.size[0] <= 0f || quad.size[1] <= 0f ||
                quad.uvRect[0] < 0f || quad.uvRect[1] < 0f ||
                quad.uvRect[2] > 1f || quad.uvRect[3] > 1f ||
                quad.uvRect[0] >= quad.uvRect[2] || quad.uvRect[1] >= quad.uvRect[3])
                throw new ArgumentException($"Invalid quad bounds: {quad.id}");
            GameObject surface = new GameObject($"Quad {quad.id}");
            surface.transform.SetParent(nodes[quad.nodeId], false);
            surface.transform.localPosition = ToUnityPosition(quad.position);
            surface.transform.localScale = new Vector3(quad.size[0], quad.size[1], 1f);
            Mesh mesh = new Mesh
            {
                vertices = new[]
                {
                    new Vector3(-0.5f, -0.5f, 0f),
                    new Vector3(-0.5f, 0.5f, 0f),
                    new Vector3(0.5f, 0.5f, 0f),
                    new Vector3(0.5f, -0.5f, 0f)
                },
                triangles = new[] { 0, 1, 2, 0, 2, 3 },
                uv = new[]
                {
                    new Vector2(quad.uvRect[0], quad.uvRect[1]),
                    new Vector2(quad.uvRect[0], quad.uvRect[3]),
                    new Vector2(quad.uvRect[2], quad.uvRect[3]),
                    new Vector2(quad.uvRect[2], quad.uvRect[1])
                },
                normals = new[] { Vector3.back, Vector3.back, Vector3.back, Vector3.back }
            };
            mesh.RecalculateBounds();
            meshes.Add(mesh);
            surface.AddComponent<MeshFilter>().sharedMesh = mesh;
            Material material = new Material(shader);
            material.color = Color.white;
            MeshRenderer renderer = surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.sortingOrder = quad.layer;
            renderer.enabled = false;
            materials.Add(quad.id, material);
            quads.Add(quad.id, renderer);
        }
        FrameContent();
        PositionCamera();
    }

    private IEnumerator LoadTextures(PreviewTexturePayload[] items, int loadGeneration, int loadRevision)
    {
        foreach (PreviewTexturePayload item in items)
        {
            using (UnityWebRequest request = UnityWebRequestTexture.GetTexture(item.url))
            {
                requests.Add(request);
                yield return request.SendWebRequest();
                requests.Remove(request);
                if (loadRevision != revision) yield break;
                if (request.result != UnityWebRequest.Result.Success)
                {
                    ClearContent();
                    Emit("error", loadGeneration, $"Texture {item.id}: {request.error}");
                    yield break;
                }
                Texture2D texture = DownloadHandlerTexture.GetContent(request);
                textures.Add(item.id, texture);
                foreach (PreviewQuadPayload quad in currentQuads)
                    if (quad.textureId == item.id && materials.TryGetValue(quad.id, out Material material))
                        material.mainTexture = texture;
            }
        }
        if (loadRevision == revision) Emit("loaded", loadGeneration);
    }

    private PreviewQuadPayload[] currentQuads = Array.Empty<PreviewQuadPayload>();

    private static void ValidateHierarchy(PreviewNodePayload[] items)
    {
        Dictionary<string, string> parents = new Dictionary<string, string>();
        foreach (PreviewNodePayload item in items)
        {
            if (item == null || string.IsNullOrEmpty(item.id) || parents.ContainsKey(item.id))
                throw new ArgumentException("Duplicate or empty node id.");
            parents.Add(item.id, item.parentId);
        }
        foreach (PreviewNodePayload item in items)
        {
            HashSet<string> visited = new HashSet<string>();
            string current = item.id;
            while (current != null)
            {
                if (!parents.TryGetValue(current, out string parent))
                    throw new ArgumentException($"Unknown parent: {current}");
                if (!visited.Add(current))
                    throw new ArgumentException($"Cyclic parent: {current}");
                current = string.IsNullOrEmpty(parent) ? null : parent;
            }
        }
    }

    private static void ApplyTransform(Transform target, PreviewNodePayload node)
    {
        target.localPosition = ToUnityPosition(node.position);
        target.localRotation = ToUnityRotation(node.rotation);
        RequireVector(node.scale, 3);
        target.localScale = new Vector3(node.scale[0], node.scale[1], node.scale[2]);
    }

    private static Camera FindPreviewCamera()
    {
        Camera camera = Camera.main;
        if (camera != null) return camera;
        GameObject tagged = GameObject.FindGameObjectWithTag("MainCamera");
        return tagged != null ? tagged.GetComponent<Camera>() : null;
    }

    private void FrameContent()
    {
        Bounds bounds = new Bounds(Vector3.zero, stageSize);
        foreach (Renderer renderer in quads.Values)
        {
            MeshFilter filter = renderer.GetComponent<MeshFilter>();
            foreach (Vector3 vertex in filter.sharedMesh.vertices)
            {
                Vector3 point = renderer.transform.TransformPoint(vertex);
                bounds.Encapsulate(point);
            }
        }
        focusCenter = bounds.center;
        focusRadius = Mathf.Max(0.1f, bounds.extents.magnitude);
    }

    private void PositionCamera()
    {
        if (previewCamera == null) previewCamera = FindPreviewCamera();
        if (previewCamera == null) return;
        Vector3 direction = view == "upper-left" ? new Vector3(-0.55f, 0.4f, -1f) :
            view == "right" ? new Vector3(0.8f, 0f, -1f) : new Vector3(0f, 0f, -1f);
        direction.Normalize();
        float halfVertical = previewCamera.fieldOfView * Mathf.Deg2Rad * 0.5f;
        float halfHorizontal = Mathf.Atan(Mathf.Tan(halfVertical) * Mathf.Max(0.1f, previewCamera.aspect));
        float halfAngle = Mathf.Min(halfVertical, halfHorizontal);
        float distance = focusRadius / Mathf.Sin(halfAngle) * 1.15f + previewCamera.nearClipPlane;
        previewCamera.transform.position = focusCenter + direction * distance;
        previewCamera.transform.LookAt(focusCenter, Vector3.up);
    }

    private void ClearContent()
    {
        revision++;
        foreach (UnityWebRequest request in requests.ToArray()) request.Abort();
        requests.Clear();
        foreach (Material material in materials.Values) DestroyOwned(material);
        foreach (Texture2D texture in textures.Values) DestroyOwned(texture);
        foreach (Mesh mesh in meshes) DestroyOwned(mesh);
        if (sceneRoot != null) DestroyOwned(sceneRoot);
        sceneRoot = null;
        nodes.Clear();
        quads.Clear();
        materials.Clear();
        textures.Clear();
        meshes.Clear();
        currentQuads = Array.Empty<PreviewQuadPayload>();
    }

    private static void DestroyOwned(UnityEngine.Object value)
    {
        if (value == null) return;
#if UNITY_EDITOR
        if (!Application.isPlaying)
        {
            DestroyImmediate(value);
            return;
        }
#endif
        Destroy(value);
    }

    private static void RequireVector(float[] value, int length)
    {
        if (value == null || value.Length != length) throw new ArgumentException($"Expected {length} numbers.");
        foreach (float item in value)
            if (float.IsNaN(item) || float.IsInfinity(item)) throw new ArgumentException("Non-finite number.");
    }

    private static void Emit(string type, int eventGeneration, string message = null)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        PostPreviewMessage(JsonUtility.ToJson(new PreviewEvent { type = type, generation = eventGeneration, message = message }));
#else
        Debug.Log($"Preview {type} ({eventGeneration}): {message}");
#endif
    }

    private void OnDestroy()
    {
        ClearContent();
    }
}

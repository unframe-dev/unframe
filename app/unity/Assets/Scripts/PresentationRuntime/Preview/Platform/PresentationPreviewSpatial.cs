using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationPreviewSpatialZone
    {
        public string ZoneId { get; internal set; }
        public Vector3 Center { get; internal set; }
        public bool Active { get; internal set; }
        public bool Inside { get; internal set; }
    }

    public sealed class PresentationPreviewSpatialState
    {
        public string RequestId { get; private set; }
        public ulong Sequence { get; private set; }
        public Vector3 PresenterPosition { get; private set; }
        public Quaternion PresenterRotation { get; private set; }
        public IReadOnlyList<PresentationPreviewSpatialZone> Zones { get; private set; }

        public static bool TryParse(string json, out PresentationPreviewSpatialState state)
        {
            state = null;
            try
            {
                using var reader = new JsonTextReader(new StringReader(json)) { DateParseHandling = DateParseHandling.None, MaxDepth = 16 };
                JObject value = JObject.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
                if (reader.Read() || !Fields(value, "requestId", "sequence", "presenterPosition", "presenterRotation", "zones")
                    || value["requestId"].Type != JTokenType.String || !PresentationDeliveryCatalog.IsId((string)value["requestId"])
                    || value["sequence"].Type != JTokenType.String) return false;
                string sequence = (string)value["sequence"];
                if (!UInt64.TryParse(sequence, NumberStyles.None, CultureInfo.InvariantCulture, out ulong parsedSequence)
                    || parsedSequence == 0 || parsedSequence.ToString(CultureInfo.InvariantCulture) != sequence
                    || !Position(value["presenterPosition"], out Vector3 presenter)
                    || !Rotation(value["presenterRotation"], out Quaternion rotation)
                    || !(value["zones"] is JArray zones)) return false;
                var parsedZones = new List<PresentationPreviewSpatialZone>();
                var ids = new HashSet<string>(StringComparer.Ordinal);
                foreach (JToken raw in zones)
                {
                    if (!(raw is JObject zone) || !Fields(zone, "zoneId", "center", "active", "inside")
                        || zone["zoneId"].Type != JTokenType.String || !PresentationDeliveryCatalog.IsId((string)zone["zoneId"])
                        || !ids.Add((string)zone["zoneId"]) || !Position(zone["center"], out Vector3 center)
                        || zone["active"].Type != JTokenType.Boolean || zone["inside"].Type != JTokenType.Boolean) return false;
                    parsedZones.Add(new PresentationPreviewSpatialZone { ZoneId = (string)zone["zoneId"], Center = center, Active = (bool)zone["active"], Inside = (bool)zone["inside"] });
                }
                state = new PresentationPreviewSpatialState { RequestId = (string)value["requestId"], Sequence = parsedSequence, PresenterPosition = presenter, PresenterRotation = rotation, Zones = parsedZones };
                return true;
            }
            catch (Exception exception) when (exception is JsonException || exception is ArgumentException || exception is OverflowException || exception is InvalidCastException) { return false; }
        }

        private static bool Fields(JObject value, params string[] names)
        {
            return value.Count == names.Length && names.All(name => value.Property(name) != null);
        }
        private static bool Rotation(JToken raw, out Quaternion rotation)
        {
            rotation = default;
            if (!(raw is JArray values) || values.Count != 4 || values.Any(value => value.Type != JTokenType.Float && value.Type != JTokenType.Integer)) return false;
            double x = (double)values[0], y = (double)values[1], z = (double)values[2], w = (double)values[3];
            if (Double.IsNaN(x + y + z + w) || Double.IsInfinity(x + y + z + w) || Math.Abs(x * x + y * y + z * z + w * w - 1) > 0.00001) return false;
            rotation = new Quaternion(-(float)x, -(float)y, (float)z, (float)w);
            return true;
        }
        private static bool Position(JToken raw, out Vector3 position)
        {
            position = default;
            if (!(raw is JArray values) || values.Count != 3 || values.Any(value => value.Type != JTokenType.Float && value.Type != JTokenType.Integer)) return false;
            return PresentationCoordinateAdapter.TryToUnityPosition(new Unframe.Presentation.Vector3 { X = (double)values[0], Y = (double)values[1], Z = (double)values[2] }, out position);
        }
    }

    public sealed class PresentationPreviewSpatial : IDisposable
    {
        private readonly Transform parent;
        private readonly List<UnityEngine.Object> allocated = new List<UnityEngine.Object>();
        private readonly Dictionary<string, Renderer> zoneRenderers = new Dictionary<string, Renderer>(StringComparer.Ordinal);
        private PresentationPreviewSpatialState state;
        private Transform presenter;
        private GameObject floor;
        private bool visible;
        private bool dragging;
        private double nextMoveAt;
        private Vector3? lastMove;
        public GameObject Root { get; }
        public Texture2D TagTexture { get; private set; }
        public Bounds Bounds { get; private set; } = new Bounds(Vector3.zero, new Vector3(4, 2, 4));
        public event Action<string, double[]> PresenterMoved;

        public PresentationPreviewSpatial(Transform parent)
        {
            this.parent = parent;
            Root = new GameObject("Preview spatial guides");
            Root.transform.SetParent(parent, false);
            Root.SetActive(false);
        }
        public void Apply(PresentationPreviewSpatialState next)
        {
            if (!SameZones(next)) Rebuild(next);
            foreach (var zone in next.Zones) zoneRenderers[zone.ZoneId].sharedMaterial.color = ZoneColor(zone);
            state = next;
            presenter.localPosition = next.PresenterPosition;
            presenter.localRotation = next.PresenterRotation;
            Root.SetActive(visible);
        }
        public void SetVisible(bool value) { if (visible != value) dragging = false; visible = value; Root.SetActive(visible && state != null); }
        public void Clear()
        {
            state = null; presenter = null; dragging = false; lastMove = null;
            Root.SetActive(false);
            if (floor != null)
            {
                floor.SetActive(false);
                floor.transform.SetParent(null);
                PresentationTextureResidency.Destroy(floor);
                floor = null;
            }
            foreach (UnityEngine.Object value in allocated) PresentationTextureResidency.Destroy(value);
            allocated.Clear();
            zoneRenderers.Clear();
            while (Root.transform.childCount > 0)
            {
                Transform child = Root.transform.GetChild(0);
                child.gameObject.SetActive(false);
                child.SetParent(null);
                PresentationTextureResidency.Destroy(child.gameObject);
            }
        }
        public void UpdateInteraction(Camera camera)
        {
            if (!visible || state == null || camera == null || !camera.pixelRect.Contains(Input.mousePosition)) { dragging = false; return; }
            if (!dragging && Input.GetMouseButton(0)) { dragging = true; nextMoveAt = 0; lastMove = null; }
            bool released = Input.GetMouseButtonUp(0);
            if (!dragging || !Input.GetMouseButton(0) && !released) return;
            if (Time.realtimeSinceStartupAsDouble < nextMoveAt && !released) return;
            var plane = new Plane(parent.up, parent.position);
            Ray ray = camera.ScreenPointToRay(Input.mousePosition);
            if (plane.Raycast(ray, out float distance))
            {
                Vector3 local = parent.InverseTransformPoint(ray.GetPoint(distance));
                local.y = state.PresenterPosition.y;
                if (!lastMove.HasValue || (local - lastMove.Value).sqrMagnitude >= 0.0001f)
                {
                    lastMove = local;
                    PresenterMoved?.Invoke(state.RequestId, new[] { (double)local.x, (double)local.y, -(double)local.z });
                }
                nextMoveAt = Time.realtimeSinceStartupAsDouble + 0.1;
            }
            if (released) dragging = false;
        }
        private bool SameZones(PresentationPreviewSpatialState next)
        {
            if (state == null || state.Zones.Count != next.Zones.Count) return false;
            for (int i = 0; i < next.Zones.Count; i++)
            {
                var prior = state.Zones[i]; var current = next.Zones[i];
                if (prior.ZoneId != current.ZoneId || !prior.Center.Equals(current.Center)) return false;
            }
            return true;
        }
        private void Rebuild(PresentationPreviewSpatialState next)
        {
            bool keepVisible = visible;
            Clear(); visible = keepVisible;
            Bounds bounds = new Bounds(Vector3.zero, new Vector3(2, 2, 2));
            foreach (PresentationPreviewSpatialZone zone in next.Zones)
            {
                Color color = ZoneColor(zone);
                GameObject box = LineObject("Zone " + zone.ZoneId, BoxLines(), color);
                box.transform.localPosition = zone.Center;
                zoneRenderers.Add(zone.ZoneId, box.GetComponent<Renderer>());
                bounds.Encapsulate(new Bounds(zone.Center, Vector3.one * 2));
            }
            Bounds = bounds;
            CreateFloor();
            TagTexture = CreateTag(); allocated.Add(TagTexture);
            GameObject tag = new GameObject("AprilTag origin"); tag.transform.SetParent(Root.transform, false);
            tag.transform.localPosition = Vector3.zero;
            Mesh mesh = new Mesh { name = "AprilTag origin plane" };
            mesh.vertices = new[] { new Vector3(-0.1125f, 0.005f, -0.1125f), new Vector3(-0.1125f, 0.005f, 0.1125f), new Vector3(0.1125f, 0.005f, 0.1125f), new Vector3(0.1125f, 0.005f, -0.1125f) };
            mesh.uv = new[] { new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0) };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 }; mesh.RecalculateBounds(); allocated.Add(mesh);
            tag.AddComponent<MeshFilter>().sharedMesh = mesh;
            Material material = Material(Color.white); material.mainTexture = TagTexture;
            ConfigureRenderer(tag.AddComponent<MeshRenderer>(), material);
            LineObject("Presentation axes", new[] { Vector3.zero, Vector3.right * 0.6f, Vector3.zero, Vector3.back * 0.6f }, new Color(0.8f, 0.8f, 0.8f));
            var marker = new GameObject("Presenter");
            marker.transform.SetParent(Root.transform, false);
            const int segments = 32;
            var vertices = new Vector3[segments + 1];
            var triangles = new int[segments * 3];
            for (int i = 0; i < segments; i++)
            {
                float angle = i * Mathf.PI * 2 / segments;
                vertices[i + 1] = new Vector3(Mathf.Cos(angle) * 0.14f, 0, Mathf.Sin(angle) * 0.14f);
                triangles[i * 3] = 0;
                triangles[i * 3 + 1] = i + 1;
                triangles[i * 3 + 2] = (i + 1) % segments + 1;
            }
            var markerMesh = new Mesh { name = "Presenter position marker", vertices = vertices, triangles = triangles };
            markerMesh.RecalculateBounds(); allocated.Add(markerMesh);
            marker.AddComponent<MeshFilter>().sharedMesh = markerMesh;
            var markerRenderer = marker.AddComponent<MeshRenderer>();
            ConfigureRenderer(markerRenderer, Material(new Color(1, 0.65f, 0.18f)));
            markerRenderer.sortingOrder = 10;
            presenter = marker.transform;
            var direction = LineObject("Presenter direction", new[] { Vector3.zero, Vector3.back * 0.45f, Vector3.back * 0.45f, new Vector3(-0.08f, 0, -0.33f), Vector3.back * 0.45f, new Vector3(0.08f, 0, -0.33f) }, new Color(1, 0.65f, 0.18f));
            direction.transform.SetParent(presenter, false);
            Root.SetActive(visible);
        }
        private void CreateFloor()
        {
            floor = new GameObject("Preview floor");
            floor.transform.SetParent(parent, false);
            const float extent = 20;
            var mesh = new Mesh { name = "Preview floor" };
            mesh.vertices = new[] { new Vector3(-extent, 0, -extent), new Vector3(-extent, 0, extent), new Vector3(extent, 0, extent), new Vector3(extent, 0, -extent) };
            mesh.uv = new[] { Vector2.zero, new Vector2(0, extent * 2), Vector2.one * extent * 2, new Vector2(extent * 2, 0) };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.RecalculateBounds(); allocated.Add(mesh);
            floor.AddComponent<MeshFilter>().sharedMesh = mesh;
            const int size = 64;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, true) { name = "Preview floor metre grid", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 8 };
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                    texture.SetPixel(x, y, x == 0 || y == 0 ? new Color(0.28f, 0.31f, 0.36f) : new Color(0.16f, 0.18f, 0.22f));
            texture.Apply(); allocated.Add(texture);
            Material material = Material(Color.white);
            material.mainTexture = texture;
            material.renderQueue = (int)RenderQueue.Geometry;
            material.SetFloat("_ZWrite", 1);
            material.SetFloat("_ZTest", (float)CompareFunction.LessEqual);
            ConfigureRenderer(floor.AddComponent<MeshRenderer>(), material);
            CreateOriginMarker();
        }
        private void CreateOriginMarker()
        {
            var marker = new GameObject("Origin marker");
            marker.transform.SetParent(floor.transform, false);
            marker.transform.localPosition = Vector3.up * 0.01f;
            var vertices = new List<Vector3>();
            var ring = new List<int>();
            var xAxis = new List<int>();
            var zAxis = new List<int>();
            void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, List<int> indices)
            {
                int start = vertices.Count;
                vertices.AddRange(new[] { a, b, c, d });
                indices.AddRange(new[] { start, start + 1, start + 2, start, start + 2, start + 3 });
            }
            const int segments = 64;
            for (int i = 0; i < segments; i++)
            {
                float start = i * Mathf.PI * 2 / segments;
                float end = (i + 1) * Mathf.PI * 2 / segments;
                Vector3 first = new Vector3(Mathf.Cos(start), 0, Mathf.Sin(start));
                Vector3 next = new Vector3(Mathf.Cos(end), 0, Mathf.Sin(end));
                Quad(first * 0.28f, first * 0.32f, next * 0.32f, next * 0.28f, ring);
            }
            Quad(new Vector3(-0.7f, 0, -0.015f), new Vector3(0.7f, 0, -0.015f),
                new Vector3(0.7f, 0, 0.015f), new Vector3(-0.7f, 0, 0.015f), xAxis);
            Quad(new Vector3(-0.015f, 0, -0.7f), new Vector3(0.015f, 0, -0.7f),
                new Vector3(0.015f, 0, 0.7f), new Vector3(-0.015f, 0, 0.7f), zAxis);
            int arrow = vertices.Count;
            vertices.AddRange(new[] { new Vector3(0.8f, 0, 0), new Vector3(0.65f, 0, -0.07f), new Vector3(0.65f, 0, 0.07f),
                new Vector3(0, 0, -0.8f), new Vector3(-0.07f, 0, -0.65f), new Vector3(0.07f, 0, -0.65f) });
            xAxis.AddRange(new[] { arrow, arrow + 1, arrow + 2 });
            zAxis.AddRange(new[] { arrow + 3, arrow + 4, arrow + 5 });
            var mesh = new Mesh { name = "Preview origin marker", subMeshCount = 3 };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(ring, 0); mesh.SetTriangles(xAxis, 1); mesh.SetTriangles(zAxis, 2);
            mesh.RecalculateBounds(); allocated.Add(mesh);
            marker.AddComponent<MeshFilter>().sharedMesh = mesh;
            Material[] materials = { Material(Color.white), Material(new Color(0.95f, 0.22f, 0.21f)), Material(new Color(0.2f, 0.55f, 1)) };
            foreach (Material material in materials)
            {
                material.renderQueue = (int)RenderQueue.Geometry + 1;
                material.SetFloat("_ZTest", (float)CompareFunction.LessEqual);
            }
            var renderer = marker.AddComponent<MeshRenderer>();
            ConfigureRenderer(renderer, materials[0]);
            renderer.sharedMaterials = materials;
        }
        private static Color ZoneColor(PresentationPreviewSpatialZone zone)
        {
            return !zone.Active ? new Color(0.45f, 0.48f, 0.52f) : zone.Inside ? new Color(0.25f, 0.9f, 0.5f) : new Color(0.2f, 0.7f, 1);
        }
        private Material Material(Color color)
        {
            Shader shader = Resources.Load<Shader>("PreviewSpatial");
            if (shader == null) throw new InvalidOperationException("preview.spatial-shader-missing");
            var material = new Material(shader) { color = color, name = "Preview spatial material" };
            allocated.Add(material);
            return material;
        }
        private static void ConfigureRenderer(Renderer renderer, Material material)
        {
            renderer.sharedMaterial = material; renderer.shadowCastingMode = ShadowCastingMode.Off; renderer.receiveShadows = false;
        }
        private GameObject LineObject(string name, Vector3[] points, Color color)
        {
            var node = new GameObject(name); node.transform.SetParent(Root.transform, false);
            var mesh = new Mesh { name = name };
            mesh.vertices = points; mesh.SetIndices(Enumerable.Range(0, points.Length).ToArray(), MeshTopology.Lines, 0); mesh.RecalculateBounds();
            allocated.Add(mesh);
            node.AddComponent<MeshFilter>().sharedMesh = mesh;
            ConfigureRenderer(node.AddComponent<MeshRenderer>(), Material(color));
            return node;
        }
        private static Vector3[] BoxLines()
        {
            var points = new List<Vector3>();
            for (int axis = 0; axis < 3; axis++)
                for (int first = -1; first <= 1; first += 2)
                    for (int second = -1; second <= 1; second += 2)
                    {
                        var a = Vector3.zero; var b = Vector3.zero;
                        a[axis] = -1; b[axis] = 1;
                        a[(axis + 1) % 3] = b[(axis + 1) % 3] = first;
                        a[(axis + 2) % 3] = b[(axis + 2) % 3] = second;
                        points.Add(a); points.Add(b);
                    }
            return points.ToArray();
        }
        private static Texture2D CreateTag()
        {
            // The 12-cell raster includes the quiet zone of the printable tag36h11 ID 0.
            string[] rows = { "000000000000", "000000000000", "001111111100", "001001010100", "001100010100", "001100111100", "001010111100", "001101001100", "001111011100", "001111111100", "000000000000", "000000000000" };
            var texture = new Texture2D(12, 12, TextureFormat.RGBA32, false) { name = "tag36h11 ID 0", filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < 12; y++)
                for (int x = 0; x < 12; x++) texture.SetPixel(x, 11 - y, rows[y][x] == '1' ? Color.black : Color.white);
            texture.Apply();
            return texture;
        }
        public void Dispose() { Clear(); PresentationTextureResidency.Destroy(Root); }
    }
}

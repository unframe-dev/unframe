using System;
using System.Collections.Generic;
using Unframe.Presentation;
using UnityEngine;
using UnityEngine.Rendering;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationSpatialRenderer : IDisposable
    {
        private sealed class Entry
        {
            internal ProjectedNodeDefinition Node;
            internal MeshRenderer Renderer;
            internal Light Light;
            internal Color Color;
            internal float Intensity;
        }
        private readonly List<Entry> entries = new List<Entry>();
        private readonly Dictionary<string, ProjectedNodeDefinition> nodes = new Dictionary<string, ProjectedNodeDefinition>();
        private readonly List<GameObject> objects = new List<GameObject>();
        private readonly List<Material> materials = new List<Material>();

        public bool IsReady
        {
            get
            {
                foreach (var item in objects) if (item == null) return false;
                foreach (var material in materials) if (material == null) return false;
                return true;
            }
        }

        public bool TryBuild(IPresentationRenderView view, PresentationNodeHierarchy hierarchy, out string error)
        {
            Dispose();
            try
            {
                foreach (var node in view.Catalog.Nodes) nodes.Add(node.NodeId, node);
                foreach (var node in view.Catalog.Nodes)
                {
                    if (node.Shape == null && node.Light == null) continue;
                    if (!hierarchy.Registry.TryGet(node.NodeId, out var host)) throw new InvalidOperationException("spatial-node-absent");
                    if (node.Shape != null) BuildShape(node, host.transform);
                    else BuildLight(node, host.transform);
                }
                error = null;
                return true;
            }
            catch (Exception exception) when (exception is ArgumentException || exception is InvalidOperationException)
            {
                Dispose();
                error = exception.Message;
                return false;
            }
        }

        private void BuildShape(ProjectedNodeDefinition node, UnityEngine.Transform host)
        {
            var shape = node.Shape;
            var shader = Resources.Load<Shader>("PresentationMaterials/SpatialUnlit");
            if (shader == null) throw new InvalidOperationException("spatial-unlit-shader-absent");
            GameObject geometry;
            UnityEngine.Vector3 size;
            if (shape.GeometryCase == ShapeNode.GeometryOneofCase.Box)
            {
                if (!PresentationCoordinateAdapter.IsValidScale(shape.Box.Size)) throw new InvalidOperationException("spatial-box-size-invalid");
                geometry = GameObject.CreatePrimitive(PrimitiveType.Cube);
                size = PresentationUnityCoordinates.Scale(shape.Box.Size);
            }
            else if (shape.GeometryCase == ShapeNode.GeometryOneofCase.Sphere)
            {
                float diameter = (float)(2 * shape.Sphere.Radius);
                if (float.IsNaN(diameter) || float.IsInfinity(diameter) || diameter <= 0) throw new InvalidOperationException("spatial-sphere-radius-invalid");
                geometry = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                size = UnityEngine.Vector3.one * diameter;
            }
            else throw new InvalidOperationException("spatial-shape-unsupported");
            objects.Add(geometry);
            geometry.name = "Shape";
            geometry.transform.SetParent(host, false);
            geometry.transform.localScale = size;
            var collider = geometry.GetComponent<Collider>();
            collider.enabled = false;
            PresentationTextureResidency.Destroy(collider);
            var color = shape.Material.Color;
            var material = new Material(shader);
            materials.Add(material);
            var tint = new Color((float)color.Red, (float)color.Green, (float)color.Blue, (float)color.Alpha);
            // The unlit shader samples linear RGB while the contract stores sRGB.
            material.SetColor("_BaseColor", QualitySettings.activeColorSpace == ColorSpace.Linear ? tint.linear : tint);
            material.SetFloat("_Cull", (float)(shape.Material.DoubleSided ? CullMode.Off : CullMode.Back));
            var renderer = geometry.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            entries.Add(new Entry { Node = node, Renderer = renderer, Color = material.GetColor("_BaseColor") });
            ConfigureTransparency(material, tint.a < 1);
        }

        private void BuildLight(ProjectedNodeDefinition node, UnityEngine.Transform host)
        {
            var definition = node.Light;
            var child = new GameObject("Light");
            objects.Add(child);
            child.transform.SetParent(host, false);
            var light = child.AddComponent<Light>();
            SrgbColor color;
            bool shadows;
            double intensity;
            switch (definition.LightCase)
            {
                case LightNode.LightOneofCase.Directional:
                    light.type = LightType.Directional;
                    color = definition.Directional.Color;
                    intensity = definition.Directional.IntensityLux;
                    shadows = definition.Directional.CastsShadows;
                    break;
                case LightNode.LightOneofCase.Point:
                    light.type = LightType.Point;
                    color = definition.Point.Color;
                    intensity = definition.Point.IntensityCandela;
                    light.range = (float)definition.Point.RangeMeters;
                    shadows = definition.Point.CastsShadows;
                    break;
                case LightNode.LightOneofCase.Spot:
                    light.type = LightType.Spot;
                    color = definition.Spot.Color;
                    intensity = definition.Spot.IntensityCandela;
                    light.range = (float)definition.Spot.RangeMeters;
                    light.spotAngle = (float)definition.Spot.OuterAngleDegrees;
                    light.innerSpotAngle = (float)definition.Spot.InnerAngleDegrees;
                    if (light.spotAngle != (float)definition.Spot.OuterAngleDegrees
                        || light.innerSpotAngle != (float)definition.Spot.InnerAngleDegrees)
                        throw new InvalidOperationException("spatial-spot-angle-unsupported");
                    shadows = definition.Spot.CastsShadows;
                    break;
                default: throw new InvalidOperationException("spatial-light-unsupported");
            }
            if (double.IsNaN(intensity) || intensity < 0 || intensity > float.MaxValue) throw new InvalidOperationException("spatial-light-intensity-invalid");
            light.lightUnit = light.type == LightType.Directional ? LightUnit.Lux : LightUnit.Candela;
            light.intensity = (float)intensity;
            light.color = new Color((float)color.Red, (float)color.Green, (float)color.Blue);
            light.shadows = shadows ? LightShadows.Soft : LightShadows.None;
            entries.Add(new Entry { Node = node, Light = light, Intensity = (float)intensity });
        }

        public bool TryRefresh(IPresentationRenderView view, PresentationNodeHierarchy hierarchy, out string error)
        {
            error = "spatial-residency-lost";
            if (!IsReady) return false;
            foreach (var entry in entries)
            {
                bool visible = true;
                float opacity = 1;
                var node = entry.Node;
                while (true)
                {
                    if (!view.TryGetNodeState(node.NodeId, out var state)) { visible = false; break; }
                    visible &= state.Visible;
                    if (!hierarchy.Registry.TryGet(node.NodeId, out var host)) return false;
                    var local = host.GetComponent<PresentationVisualOpacity>();
                    opacity *= local == null ? (float)state.Opacity : local.Opacity;
                    if (node.Parent.ParentCase != SpatialParent.ParentOneofCase.Node) break;
                    node = nodes[node.Parent.Node.NodeId];
                }
                if (entry.Renderer != null)
                {
                    entry.Renderer.enabled = visible;
                    var color = entry.Color;
                    color.a *= opacity;
                    var material = entry.Renderer.sharedMaterial;
                    material.SetColor("_BaseColor", color);
                    ConfigureTransparency(material, color.a < 1);
                }
                if (entry.Light != null)
                {
                    entry.Light.enabled = visible;
                    entry.Light.intensity = entry.Intensity * opacity;
                }
            }
            error = null;
            return true;
        }

        private static void ConfigureTransparency(Material material, bool transparent)
        {
            material.SetFloat("_SrcBlend", (float)(transparent ? BlendMode.SrcAlpha : BlendMode.One));
            material.SetFloat("_DstBlend", (float)(transparent ? BlendMode.OneMinusSrcAlpha : BlendMode.Zero));
            material.SetFloat("_ZWrite", transparent ? 0 : 1);
            material.renderQueue = (int)(transparent ? RenderQueue.Transparent : RenderQueue.Geometry);
            material.SetOverrideTag("RenderType", transparent ? "Transparent" : "Opaque");
        }

        public void Disable()
        {
            foreach (var entry in entries)
            {
                if (entry.Renderer != null) entry.Renderer.enabled = false;
                if (entry.Light != null) entry.Light.enabled = false;
            }
        }

        public void Dispose()
        {
            Disable();
            foreach (var item in objects) PresentationTextureResidency.Destroy(item);
            foreach (var material in materials) PresentationTextureResidency.Destroy(material);
            objects.Clear();
            materials.Clear();
            entries.Clear();
            nodes.Clear();
        }
    }
}

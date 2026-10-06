using System;
using System.Collections.Generic;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationBakedSurfaceRenderer : IDisposable
    {
        private sealed class Partition
        {
            internal DeliveredRenderSurface Surface;
            internal string HostNodeId;
            internal MeshRenderer Renderer;
            internal GameObject Object;
        }
        private readonly List<Partition> partitions = new List<Partition>();
        private readonly Material material;
        private readonly MaterialPropertyBlock properties = new MaterialPropertyBlock();

        public PresentationBakedSurfaceRenderer()
        {
            Shader shader = Resources.Load<Shader>("BakedSurface");
            if (shader == null) throw new InvalidOperationException("The BakedSurface shader is required.");
            material = new Material(shader);
        }

        public bool TryBuild(PresentationRuntimeDataStore store, PresentationNodeHierarchy hierarchy, out string error)
        {
            Clear();
            error = "delivery baked surface cannot be rendered.";
            if (store == null || store.Delivery == null || hierarchy == null || hierarchy.Registry == null) return false;
            foreach (DeliveredRenderSurface surface in store.Delivery.ProjectionProfile.RenderSurfaces)
            {
                if (surface.RendererKind != RendererKind.BakedWeb || !store.TryGetSurface(surface.SemanticSurfaceId, out ProjectedSurfaceDefinition semantic)
                    || semantic.PhysicalSizeMeters == null || semantic.LogicalSize == null || semantic.PhysicalSizeMeters.X <= 0 || semantic.PhysicalSizeMeters.Y <= 0
                    || semantic.LogicalSize.X <= 0 || semantic.LogicalSize.Y <= 0
                    || !hierarchy.Registry.TryGet(semantic.HostNodeId, out GameObject host)) { Clear(); return false; }
                GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
                quad.name = surface.RenderSurfaceId;
                PresentationTextureResidency.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(host.transform, false);
                LogicalBounds bounds = surface.LogicalBounds;
                double fitX = semantic.PhysicalSizeMeters.X / semantic.LogicalSize.X;
                double fitY = semantic.PhysicalSizeMeters.Y / semantic.LogicalSize.Y;
                if (semantic.Fit == SurfaceFit.Contain) fitX = fitY = Math.Min(fitX, fitY);
                if (semantic.Fit == SurfaceFit.Cover) fitX = fitY = Math.Max(fitX, fitY);
                quad.transform.localScale = new UnityEngine.Vector3((float)(bounds.Width * fitX), (float)(bounds.Height * fitY), 1);
                quad.transform.localPosition = new UnityEngine.Vector3((float)((bounds.X + bounds.Width / 2 - semantic.LogicalSize.X / 2) * fitX),
                    (float)((semantic.LogicalSize.Y / 2 - bounds.Y - bounds.Height / 2) * fitY), -(float)surface.Layer * 0.0001f);
                MeshRenderer renderer = quad.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                renderer.enabled = false;
                partitions.Add(new Partition { Surface = surface, HostNodeId = semantic.HostNodeId, Renderer = renderer, Object = quad });
            }
            error = null;
            return true;
        }

        public bool TryRefresh(PresentationRuntimeDataStore store, PresentationTextureResidency textures, double runtimeTimeMs, out string error)
        {
            error = "asset_residency_lost";
            foreach (Partition partition in partitions)
            {
                if (!store.TryGetSurfaceState(partition.Surface.SemanticSurfaceId, out SurfaceRuntimeState state)
                    || !store.TryGetNodeState(partition.HostNodeId, out NodeRuntimeState node))
                {
                    partition.Renderer.enabled = false;
                    continue;
                }
                string fromState = state.StateId;
                float blend = 0;
                if (state.TransitionRunId != null)
                {
                    RuntimeRunSnapshot transition = null;
                    foreach (RuntimeRunSnapshot run in store.ActiveRuns)
                        if (run.RunCase == RuntimeRunSnapshot.RunOneofCase.SurfaceTransition && run.RunId.Equals(state.TransitionRunId)) { transition = run; break; }
                    if (transition == null || transition.SurfaceTransition.SurfaceId != partition.Surface.SemanticSurfaceId
                        || transition.SurfaceTransition.ToStateId != state.StateId || transition.SurfaceTransition.DurationMs == 0) { Disable(); return false; }
                    fromState = transition.SurfaceTransition.FromStateId;
                    float progress = Mathf.Clamp01((float)((runtimeTimeMs - transition.StartedAtRuntimeTimeMs) / transition.SurfaceTransition.DurationMs));
                    blend = Ease(progress, transition.SurfaceTransition.Easing);
                }
                if (!TryTexture(partition.Surface, fromState, textures, out Texture2D from, out bool fromVisible)
                    || !TryTexture(partition.Surface, state.StateId, textures, out Texture2D to, out bool toVisible)) { Disable(); return false; }
                properties.Clear();
                properties.SetTexture("_FromTex", from ?? Texture2D.whiteTexture);
                properties.SetTexture("_ToTex", to ?? Texture2D.whiteTexture);
                properties.SetFloat("_FromVisible", fromVisible ? 1 : 0);
                properties.SetFloat("_ToVisible", toVisible ? 1 : 0);
                properties.SetFloat("_Blend", blend);
                properties.SetFloat("_Opacity", (float)node.Opacity);
                partition.Renderer.SetPropertyBlock(properties);
                partition.Renderer.enabled = node.Active && node.Visible && (fromVisible || toVisible);
            }
            error = null;
            return true;
        }

        public bool TryPickInteraction(Ray ray, PresentationRuntimeDataStore store, PresentationTextureResidency textures,
            out string surfaceId, out string interactionId)
        {
            surfaceId = null;
            interactionId = null;
            Partition nearest = null;
            QuestNormalizedPoint point = default;
            float nearestDistance = float.PositiveInfinity;
            foreach (Partition partition in partitions)
            {
                if (!partition.Renderer.enabled || !partition.Object.activeInHierarchy
                    || !store.TryGetSurfaceState(partition.Surface.SemanticSurfaceId, out SurfaceRuntimeState state)
                    || !store.TryGetNodeState(partition.HostNodeId, out NodeRuntimeState node)
                    || !node.Active || !node.Visible
                    || !TryTexture(partition.Surface, state.StateId, textures, out _, out bool visible) || !visible
                    || !store.TryGetSurface(partition.Surface.SemanticSurfaceId, out ProjectedSurfaceDefinition semantic)
                    || !QuestPresentationSurfacePicking.TryIntersect(ray, partition.Object.transform, partition.Surface.LogicalBounds,
                        semantic.LogicalSize.X, semantic.LogicalSize.Y, out QuestNormalizedPoint candidatePoint, out float distance)
                    || distance > nearestDistance
                    || distance == nearestDistance && nearest != null
                        && StringComparer.Ordinal.Compare(partition.Surface.SemanticSurfaceId, nearest.Surface.SemanticSurfaceId) >= 0) continue;
                nearest = partition;
                point = candidatePoint;
                nearestDistance = distance;
            }
            if (nearest == null) return false;
            foreach (ProjectedSemanticSurface semantic in store.Delivery.ProjectionProfile.SemanticSurfaces)
            {
                if (semantic.SemanticSurfaceId != nearest.Surface.SemanticSurfaceId) continue;
                if (!store.TryGetSurfaceState(semantic.SemanticSurfaceId, out SurfaceRuntimeState state)
                    || !QuestPresentationSurfacePicking.TryResolve(semantic, state.StateId, point, out interactionId)) return false;
                surfaceId = semantic.SemanticSurfaceId;
                return true;
            }
            return false;
        }

        private static bool TryTexture(DeliveredRenderSurface surface, string stateId, PresentationTextureResidency textures, out Texture2D resident, out bool visible)
        {
            resident = null;
            visible = false;
            DeliveredStateBinding binding = null;
            foreach (DeliveredStateBinding candidate in surface.StateBindings) if (candidate.StateId == stateId) { binding = candidate; break; }
            if (binding == null) return false;
            if (binding.BindingCase == DeliveredStateBinding.BindingOneofCase.Empty) return true;
            TextureArtifact texture = null;
            foreach (DeliveredArtifact artifact in surface.Artifacts)
                if (artifact.BakedWeb.ArtifactId == binding.Artifact.ArtifactId)
                    foreach (BakedWebStateTexture candidate in artifact.BakedWeb.States) if (candidate.StateId == stateId) texture = candidate.Texture;
            visible = texture != null && textures.TryGet(texture.Checksum, out resident);
            return visible;
        }

        private static float Ease(float progress, Easing easing)
        {
            switch (easing)
            {
                case Easing.CubicIn: return progress * progress * progress;
                case Easing.CubicOut: return 1f - Mathf.Pow(1f - progress, 3f);
                case Easing.CubicInOut: return progress < 0.5f ? 4f * progress * progress * progress : 1f - Mathf.Pow(2f - 2f * progress, 3f) / 2f;
                default: return progress;
            }
        }

        public void Disable()
        {
            foreach (Partition partition in partitions) if (partition.Renderer != null) partition.Renderer.enabled = false;
        }

        private void Clear()
        {
            foreach (Partition partition in partitions) PresentationTextureResidency.Destroy(partition.Object);
            partitions.Clear();
        }

        public void Dispose()
        {
            Clear();
            PresentationTextureResidency.Destroy(material);
        }
    }
}

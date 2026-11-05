using System;
using System.Collections.Generic;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    public static class PresentationTextureWindow
    {
        public static List<TextureResidencyBinding> Select(TextureResidencyPlan plan, string groupId)
        {
            if (plan == null) throw new InvalidOperationException("texture-window-plan-absent");
            string selectedGroup = groupId ?? plan.InitialGroupId;
            TextureResidencyWindow selected = null;
            foreach (var window in plan.GroupWindows)
                if (window.GroupId == selectedGroup) { selected = window; break; }
            if (selected == null) throw new InvalidOperationException("texture-window-group-absent");
            var ids = new HashSet<string>(selected.AssetIds, StringComparer.Ordinal);
            var bindings = new List<TextureResidencyBinding>();
            foreach (var binding in plan.Textures)
                if (ids.Remove(binding.AssetId)) bindings.Add(binding);
            if (ids.Count != 0) throw new InvalidOperationException("texture-window-asset-absent");
            return bindings;
        }

        public static IEnumerable<string> Checksums(IEnumerable<TextureResidencyBinding> bindings)
        {
            foreach (var binding in bindings) yield return binding.Checksum;
        }

        public static bool Fits(IEnumerable<TextureResidencyBinding> bindings, TextureLimits limits, ulong modelGpu, ulong modelBindings)
        {
            if (limits == null)
            {
                foreach (var binding in bindings) return false;
                return modelGpu == 0 && modelBindings == 0;
            }
            ulong gpu = modelGpu, count = modelBindings;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var binding in bindings)
            {
                if (!seen.Add(binding.Checksum)) continue;
                if (gpu > limits.MaxGpuBytes || binding.DecodedGpuBytes > limits.MaxGpuBytes - gpu) return false;
                gpu += binding.DecodedGpuBytes;
                if (count >= limits.MaxTextureBindings) return false;
                count++;
            }
            return gpu <= limits.MaxGpuBytes && count <= limits.MaxTextureBindings;
        }

        public static bool Prepare(PresentationTextureResidency textures, IList<TextureResidencyBinding> required,
            TextureLimits limits, ulong modelGpu, ulong modelBindings, Action detach,
            Func<TextureResidencyBinding, bool> load)
        {
            if (!Fits(required, limits, modelGpu, modelBindings)) throw new InvalidOperationException("texture-window-budget-exceeded");
            if (UnityEngine.Application.isPlaying && PresentationTextureResidency.GpuReleaseFrame == UnityEngine.Time.frameCount
                && !textures.IsReady(required)) return false;
            var previous = new List<TextureResidencyBinding>(textures.Bindings);
            var union = new List<TextureResidencyBinding>(previous);
            union.AddRange(required);
            if (!Fits(union, limits, modelGpu, modelBindings))
            {
                detach();
                textures.RetainOnly(Checksums(required));
                previous = new List<TextureResidencyBinding>(textures.Bindings);
                // Play mode destroys GPU resources at the end of the frame.
                if (UnityEngine.Application.isPlaying) return false;
            }
            try
            {
                foreach (var binding in required)
                {
                    if (textures.TryGet(binding.Checksum, out _)) continue;
                    if (!textures.TryRetain(binding, out _) && !load(binding))
                        throw new InvalidOperationException("asset-texture-residency-failed");
                }
            }
            catch
            {
                textures.RetainOnly(Checksums(previous));
                throw;
            }
            return true;
        }
    }
}

using System;
using System.Collections.Generic;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Unframe.Unity.VisualEffects
{
    public sealed class EffectHandle
    {
        private Action cancel;
        public float Progress { get; internal set; }
        public event Action Completed;
        internal EffectHandle(Action cancel) { this.cancel = cancel; }
        public void Cancel() { cancel?.Invoke(); }
        internal void Finish(bool completed)
        {
            cancel = null;
            if (completed) Completed?.Invoke();
        }
    }

    public sealed class VisualEffectPlayer : IDisposable
    {
        private abstract class Run
        {
            internal EffectOptions Options;
            internal EffectHandle Handle;
            internal object TargetKey;
            internal Shader ShaderKey;
            internal abstract bool Evaluate(double now);
            internal abstract void Release();
        }

        private sealed class WaveRun : Run
        {
            private readonly GameObject root;
            private readonly Material material;
            private readonly LineRenderer[] lines = new LineRenderer[12];
            private readonly Gradient gradient = new Gradient();
            private readonly GradientColorKey[] shortColors = new GradientColorKey[2];
            private readonly GradientColorKey[] longColors = new GradientColorKey[3];
            private readonly GradientAlphaKey[] alphas = new GradientAlphaKey[2];
            private static readonly Color Blue = new Color(0x71 / 255f, 0x87 / 255f, 0xf5 / 255f);
            private static readonly Color Purple = new Color(0x9a / 255f, 0x80 / 255f, 0xd0 / 255f);
            private static readonly Color Coral = new Color(0xdf / 255f, 0x7b / 255f, 0x80 / 255f);

            internal WaveRun(EffectOptions options, Transform parent)
            {
                Options = options;
                material = CreateLineMaterial();
                root = new GameObject("Visual wave");
                root.transform.SetParent(parent, false);
                root.SetActive(false);
                for (var i = 0; i < lines.Length; i++)
                {
                    lines[i] = CreateLine(root.transform, material, 96, options.Size * 0.012f);
                    lines[i].useWorldSpace = false;
                }
            }
            internal override bool Evaluate(double now)
            {
                var progress = Options.Sample(now);
                Handle.Progress = progress;
                root.SetActive(now >= Options.StartedAtRuntimeMs);
                var tip = progress <= 0.48f ? Color.Lerp(Blue, Purple, progress / 0.48f)
                    : Color.Lerp(Purple, Coral, (progress - 0.48f) / 0.52f);
                var tint = Options.Color;
                var alpha = tint.a * Mathf.SmoothStep(0, 1, Mathf.Clamp01(progress / 0.22f));
                alphas[0] = new GradientAlphaKey(alpha, 0);
                alphas[1] = new GradientAlphaKey(alpha, 1);
                if (progress <= 0.48f)
                {
                    shortColors[0] = new GradientColorKey(Blue * tint, 0);
                    shortColors[1] = new GradientColorKey(tip * tint, 1);
                    gradient.SetKeys(shortColors, alphas);
                }
                else
                {
                    longColors[0] = new GradientColorKey(Blue * tint, 0);
                    longColors[1] = new GradientColorKey(Purple * tint, 0.48f / progress);
                    longColors[2] = new GradientColorKey(tip * tint, 1);
                    gradient.SetKeys(longColors, alphas);
                }
                var phase = -Mathf.PI * 0.2f + (Options.Seed % 1024) / 1023f * Mathf.PI * 0.1f;
                var visiblePoints = Mathf.Clamp(Mathf.CeilToInt(progress * 95) + 1, 2, 96);
                for (var i = 0; i < lines.Length; i++)
                {
                    lines[i].colorGradient = gradient;
                    lines[i].positionCount = visiblePoints;
                    for (var j = 0; j < visiblePoints; j++)
                    {
                        var q = Mathf.Min(j / 95f, progress);
                        var x = -4 + 8 * q;
                        var y = 0.6f * Mathf.Cos(q * Options.WaveCycles * 2 * Mathf.PI + phase) + (5.5f - i) * 0.12f;
                        lines[i].SetPosition(j, new Vector3(x, y, 0) * Options.Size);
                    }
                }
                return false;
            }
            internal override void Release() { Destroy(root); Destroy(material); }
        }

        private sealed class HandRun : Run
        {
            private readonly GameObject root;
            private readonly Material material;
            private readonly LineRenderer trail;
            private readonly LineRenderer halo;
            private readonly List<Vector3> positions = new List<Vector3>();
            private readonly List<double> times = new List<double>();
            private double? endedAt;
            private double lastPoseTime = -1;
            internal HandRun(EffectOptions options, Transform parent)
            {
                Options = options;
                material = CreateLineMaterial();
                root = new GameObject("Visual hand glow");
                root.transform.SetParent(parent, false);
                trail = CreateLine(root.transform, material, 0, options.Size * 0.025f);
                halo = CreateLine(root.transform, material, 25, options.Size * 0.012f);
                root.SetActive(false);
            }
            internal void Pose(Vector3 point, double time)
            {
                EffectOptions.Time(time);
                if (endedAt.HasValue) throw new InvalidOperationException("The hand effect has ended.");
                if (time < Options.StartedAtRuntimeMs || time <= lastPoseTime) throw new ArgumentOutOfRangeException(nameof(time));
                if (!EffectOptions.Finite(point.x) || !EffectOptions.Finite(point.y) || !EffectOptions.Finite(point.z)) throw new ArgumentOutOfRangeException(nameof(point));
                lastPoseTime = time;
                positions.Add(point);
                times.Add(time);
                if (positions.Count > 256) { positions.RemoveAt(0); times.RemoveAt(0); }
            }
            internal void End(double time)
            {
                EffectOptions.Time(time);
                if (time < Options.StartedAtRuntimeMs || time < lastPoseTime) throw new ArgumentOutOfRangeException(nameof(time));
                if (!endedAt.HasValue) endedAt = time;
            }
            internal override bool Evaluate(double now)
            {
                var life = Options.DurationMs / Options.Speed;
                var fade = endedAt.HasValue ? Mathf.Clamp01((float)((now - endedAt.Value) / life)) : 0;
                Handle.Progress = fade;
                while (times.Count > 0 && now - times[0] >= life) { times.RemoveAt(0); positions.RemoveAt(0); }
                var count = 0;
                while (count < times.Count && times[count] <= now) count++;
                root.SetActive(count > 0 && now >= Options.StartedAtRuntimeMs && fade < 1);
                trail.positionCount = count;
                for (var i = 0; i < count; i++) trail.SetPosition(i, positions[i]);
                var color = Options.Color;
                color.a *= 1 - fade;
                trail.startColor = new Color(color.r, color.g, color.b, 0);
                trail.endColor = halo.startColor = halo.endColor = color;
                if (count > 0)
                {
                    var center = positions[count - 1];
                    for (var i = 0; i < 25; i++)
                    {
                        var angle = i / 24f * Mathf.PI * 2;
                        halo.SetPosition(i, center + new Vector3(Mathf.Cos(angle), Mathf.Sin(angle), 0) * (0.035f * Options.Size));
                    }
                }
                return endedAt.HasValue && fade >= 1;
            }
            internal override void Release() { Destroy(root); Destroy(material); }
        }

        private sealed class DissolveRun : Run
        {
            internal readonly MeshRenderer Target;
            internal readonly bool RetainTerminalPose;
            private readonly Material[] originals;
            private readonly Material[] materials;
            internal DissolveRun(EffectOptions options, MeshRenderer target, Shader shader, bool retainTerminalPose)
            {
                if (!target) throw new ArgumentNullException(nameof(target));
                if (!shader) throw new ArgumentNullException(nameof(shader));
                Options = options;
                RetainTerminalPose = retainTerminalPose;
                Target = target;
                originals = target.sharedMaterials;
                if (originals.Length == 0) throw new ArgumentException("The target has no material.", nameof(target));
                foreach (var source in originals)
                    if (!source || source.renderQueue >= 3000 || (source.HasProperty("_Surface") && source.GetFloat("_Surface") != 0))
                        throw new ArgumentException("Dissolve supports opaque static meshes only.", nameof(target));
                materials = new Material[originals.Length];
                for (var i = 0; i < originals.Length; i++)
                {
                    var source = originals[i];
                    var material = new Material(shader);
                    var textureName = source.HasProperty("_BaseMap") ? "_BaseMap" : "_MainTex";
                    if (source.HasProperty(textureName))
                    {
                        material.SetTexture("_BaseMap", source.GetTexture(textureName));
                        material.SetTextureScale("_BaseMap", source.GetTextureScale(textureName));
                        material.SetTextureOffset("_BaseMap", source.GetTextureOffset(textureName));
                    }
                    material.SetColor("_BaseColor", source.HasProperty("_BaseColor") ? source.GetColor("_BaseColor") : source.HasProperty("_Color") ? source.GetColor("_Color") : Color.white);
                    material.SetColor("_EdgeColor", options.Color);
                    material.SetFloat("_NoiseScale", 12 / options.Size);
                    material.SetFloat("_Seed", options.Seed % 10000);
                    materials[i] = material;
                }

            }
            internal override bool Evaluate(double now)
            {
                var progress = Options.Sample(now);
                Handle.Progress = progress;
                if (Target) Target.sharedMaterials = now < Options.StartedAtRuntimeMs ? originals : materials;
                foreach (var material in materials) material.SetFloat("_Progress", progress);
                return progress >= 1 && !RetainTerminalPose;
            }
            internal override void Release()
            {
                if (Target) Target.sharedMaterials = originals;
                foreach (var material in materials) Destroy(material);
            }
        }

        private readonly Dictionary<string, Run> runs = new Dictionary<string, Run>();
        private bool disposed;
        private readonly int capacity;
        public VisualEffectPlayer(int capacity = 32)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            this.capacity = capacity;
        }
        public int ActiveCount => runs.Count;
        public EffectHandle PlayWave(EffectOptions options, Transform parent) => Add(options, () => new WaveRun(options, parent), typeof(WaveRun), parent);
        public EffectHandle BeginHandGlow(EffectOptions options, Transform parent = null) => Add(options, () => new HandRun(options, parent), typeof(HandRun), parent);
        public EffectHandle PlayDissolve(EffectOptions options, MeshRenderer target, Shader shader, bool retainTerminalPose = false)
        {
            if (options != null && runs.TryGetValue(options.RunId, out var existing))
            {
                if (existing is DissolveRun dissolve && dissolve.RetainTerminalPose != retainTerminalPose)
                    throw new InvalidOperationException("The run ID has different parameters.");
                return Add(options, () => new DissolveRun(options, target, shader, retainTerminalPose), typeof(DissolveRun), target, shader);
            }
            foreach (var run in runs.Values)
                if (run is DissolveRun dissolve && dissolve.Target == target) throw new InvalidOperationException("The target already has a dissolve effect.");
            return Add(options, () => new DissolveRun(options, target, shader, retainTerminalPose), typeof(DissolveRun), target, shader);
        }
        public void UpdatePose(string runId, Vector3 position, double runtimeMs) => Hand(runId).Pose(position, runtimeMs);
        public void EndHandGlow(string runId, double runtimeMs) => Hand(runId).End(runtimeMs);
        private HandRun Hand(string id)
        {
            if (!runs.TryGetValue(id, out var run) || !(run is HandRun hand)) throw new ArgumentException("Unknown hand effect.", nameof(id));
            return hand;
        }
        private EffectHandle Add(EffectOptions options, Func<Run> create, Type kind, object target, Shader shader = null)
        {
            if (disposed) throw new ObjectDisposedException(nameof(VisualEffectPlayer));
            if (options == null) throw new ArgumentNullException(nameof(options));
            if (runs.TryGetValue(options.RunId, out var existing))
            {
                var old = existing.Options;
                if (existing.GetType() != kind || !ReferenceEquals(existing.TargetKey, target) || existing.ShaderKey != shader
                    || old.WaveCycles != options.WaveCycles || old.Size != options.Size || old.Color != options.Color || old.Speed != options.Speed
                    || old.DurationMs != options.DurationMs || old.Seed != options.Seed || old.StartedAtRuntimeMs != options.StartedAtRuntimeMs)
                    throw new InvalidOperationException("The run ID has different parameters.");
                return existing.Handle;
            }
            if (runs.Count >= capacity) throw new InvalidOperationException("The effect capacity is " + capacity + ".");
            var run = create();
            run.TargetKey = target;
            run.ShaderKey = shader;
            run.Handle = new EffectHandle(() => Remove(options.RunId, false));
            runs.Add(options.RunId, run);
            return run.Handle;
        }
        public void Evaluate(double runtimeMs)
        {
            EffectOptions.Time(runtimeMs);
            foreach (var run in new List<Run>(runs.Values))
                if (runs.TryGetValue(run.Options.RunId, out var current) && ReferenceEquals(run, current) && run.Evaluate(runtimeMs)) Remove(run.Options.RunId, true);
        }
        private void Remove(string id, bool completed)
        {
            if (!runs.TryGetValue(id, out var run)) return;
            runs.Remove(id);
            run.Release();
            run.Handle.Finish(completed);
        }
        public void Dispose()
        {
            disposed = true;
            foreach (var id in new List<string>(runs.Keys)) Remove(id, false);
        }
        private static Material CreateLineMaterial()
        {
            var shader = Resources.Load<Shader>("VisualEffects/VisualGlow");
            if (!shader) throw new InvalidOperationException("The VisualGlow resource shader is required.");
            var material = new Material(shader);
            return material;
        }
        private static LineRenderer CreateLine(Transform parent, Material material, int count, float width)
        {
            var line = new GameObject("Visual line").AddComponent<LineRenderer>();
            line.transform.SetParent(parent, false);
            line.sharedMaterial = material;
            line.positionCount = count;
            line.widthMultiplier = width;
            line.useWorldSpace = true;
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            line.receiveShadows = false;
            return line;
        }
        private static void Destroy(Object value)
        {
            if (!value) return;
            if (Application.isPlaying) Object.Destroy(value); else Object.DestroyImmediate(value);
        }
    }
}

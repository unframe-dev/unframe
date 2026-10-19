using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;
using UnityEngine.Rendering;
using GLTFast.Materials;

public sealed class ModelSpike : MonoBehaviour
{
    public static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        Debug.Log("MODEL_SPIKE_PASS " + message);
    }

    public static void Sample(Animation animation, string first, float time, string second = null, float weight = 0)
    {
        foreach (AnimationState state in animation) state.enabled = false;
        var a = animation[first];
        a.enabled = true;
        a.time = time;
        a.speed = 0;
        a.weight = 1 - weight;
        a.wrapMode = WrapMode.ClampForever;
        if (second != null)
        {
            var b = animation[second];
            b.enabled = true;
            b.time = time;
            b.speed = 0;
            b.weight = weight;
            b.wrapMode = WrapMode.ClampForever;
        }
        animation.Sample();
    }

    public static async Task Run()
    {
        using (var source = new GltfImport(deferAgent: new UninterruptedDeferAgent()))
        {
            Check(await source.Load(Resources.Load<TextAsset>("source").bytes), "source bytes import");
            var wrapper = new GameObject("Unstripped");
            Check(await source.InstantiateMainSceneAsync(wrapper.transform), "source instance");
            var animation = wrapper.GetComponentInChildren<Animation>();
            string clip = null;
            foreach (AnimationState state in animation) { clip = state.name; break; }
            Sample(animation, clip, 1f);
            var root = wrapper.transform.Find("ModelRoot");
            Check(root != null && Math.Abs(root.localPosition.x) > 1.99f, "source root channel visibly changes internal root");
            UnityEngine.Object.DestroyImmediate(wrapper);
        }
        using var importer = new GltfImport(deferAgent: new UninterruptedDeferAgent());
        var normalizedBytes = Resources.Load<TextAsset>("root-stripped").bytes;
        using (var sha = SHA256.Create())
            Debug.Log("MODEL_SPIKE_ASSET sha256:" + BitConverter.ToString(sha.ComputeHash(normalizedBytes)).Replace("-", "").ToLowerInvariant());
        Check(await importer.Load(normalizedBytes, importSettings: new ImportSettings { AnimationMethod = AnimationMethod.Legacy }), "runtime bytes import");
        var clips = importer.GetAnimationClips();
        Check(clips.Length == 2 && clips[0].legacy && Math.Abs(clips[0].length - 1) < 0.001f, "two one-second legacy clips");
        var a = new GameObject("WrapperA");
        var b = new GameObject("WrapperB");
        a.transform.position = new Vector3(5, 6, 7);
        a.transform.rotation = Quaternion.Euler(10, 20, 30);
        a.transform.localScale = new Vector3(2, 3, 4);
        Check(await importer.InstantiateMainSceneAsync(a.transform) && await importer.InstantiateMainSceneAsync(b.transform), "two instances");
        var aa = a.GetComponentInChildren<Animation>();
        var ab = b.GetComponentInChildren<Animation>();
        var ra = a.GetComponentInChildren<SkinnedMeshRenderer>();
        var rb = b.GetComponentInChildren<SkinnedMeshRenderer>();
        Check(aa != null && ab != null && ra != null && ra.sharedMesh.blendShapeCount == 1 && ra.bones.Length == 1, "skin morph animation instantiated");
        var names = new List<string>();
        foreach (AnimationState state in aa) names.Add(state.name);
        Sample(aa, names[0], 0.25f);
        Sample(ab, names[1], 0.75f);
        Debug.Log("MODEL_SPIKE_VALUES morphA=" + ra.GetBlendShapeWeight(0) + " morphB=" + rb.GetBlendShapeWeight(0) + " boneA=" + ra.bones[0].localPosition + " boneB=" + rb.bones[0].localPosition);
        Check(Math.Abs(ra.GetBlendShapeWeight(0) - 0.25f) < 0.1f && Math.Abs(rb.GetBlendShapeWeight(0) - 0.375f) < 0.1f, "manual sample and independent morph");
        Check(Math.Abs(ra.sharedMesh.GetBlendShapeFrameWeight(0, 0) - 1f) < 0.001f, "glTF morph full frame weight is one");
        var baked = new Mesh();
        ra.BakeMesh(baked);
        Debug.Log("MODEL_SPIKE_BAKED vertex=" + baked.vertices[2] + " frame=" + ra.sharedMesh.GetBlendShapeFrameWeight(0,0));
        Check(Vector3.Distance(baked.vertices[2], new Vector3(0, 4.5f, 1f)) < 0.001f, "CPU baked morph geometry");
        UnityEngine.Object.DestroyImmediate(baked);
        Check(Math.Abs(ra.bones[0].localPosition.y - 0.5f) < 0.001f && Math.Abs(rb.bones[0].localPosition.y + 1.5f) < 0.001f, "manual sample and independent bones");
        Sample(aa, names[0], 0.5f, names[1], 0.5f);
        Check(Math.Abs(ra.bones[0].localPosition.y) < 0.001f && Math.Abs(ra.GetBlendShapeWeight(0) - 0.375f) < 0.1f, "manual crossfade mixture");
        var held = ra.bones[0].localPosition;
        Sample(aa, names[0], 0.5f, names[1], 0.5f);
        Check(ra.bones[0].localPosition == held, "reconstructed stopped mixture");
        Sample(aa, names[0], 1f);
        Check(Math.Abs(ra.bones[0].localPosition.y - 2f) < 0.001f && Math.Abs(ra.GetBlendShapeWeight(0) - 1f) < 0.1f, "final pose explicit sample");
        Check(a.transform.position == new Vector3(5, 6, 7) && a.transform.localScale == new Vector3(2, 3, 4) && Quaternion.Angle(a.transform.rotation, Quaternion.Euler(10,20,30)) < 0.001f, "wrapper TRS independent");
        Check(a.transform.Find("ModelRoot").localPosition == Vector3.zero, "selected scene root channels stripped");
        var material = ra.sharedMaterial;
        Debug.Log("MODEL_SPIKE_MATERIAL " + material.shader.name);
        Check(material.HasProperty(MaterialProperty.BaseColor) && material.HasProperty(MaterialProperty.SrcBlend) && material.HasProperty(MaterialProperty.DstBlend) && material.HasProperty(MaterialProperty.ZWrite), "URP effective opacity properties available");
        var instanceMaterial = new Material(material);
        var color = instanceMaterial.GetColor(MaterialProperty.BaseColor);
        color.a *= 0.5f;
        instanceMaterial.SetColor(MaterialProperty.BaseColor, color);
        instanceMaterial.SetFloat(MaterialProperty.SrcBlend, (int)BlendMode.SrcAlpha);
        instanceMaterial.SetFloat(MaterialProperty.DstBlend, (int)BlendMode.OneMinusSrcAlpha);
        instanceMaterial.SetFloat(MaterialProperty.ZWrite, 0);
        instanceMaterial.SetFloat(MaterialProperty.Surface, 1);
        instanceMaterial.EnableKeyword(ShaderGraphMaterialGenerator.SurfaceTypeTransparentKeyword);
        instanceMaterial.renderQueue = (int)RenderQueue.Transparent;
        ra.sharedMaterial = instanceMaterial;
        Check(Math.Abs(instanceMaterial.GetColor(MaterialProperty.BaseColor).a - 0.4f) < 0.001f && instanceMaterial.GetFloat(MaterialProperty.ZWrite) == 0 && rb.sharedMaterial.GetFloat(MaterialProperty.ZWrite) == 1, "per-instance opacity and depth control state");
        UnityEngine.Object.DestroyImmediate(instanceMaterial);
        Check(material.shader.name.Contains("glTF"), "glTF material shader");
        if (Application.isPlaying && SystemInfo.graphicsDeviceType != GraphicsDeviceType.Null)
        {
            ra.enabled = false;
            rb.enabled = false;
            await RenderPixels(importer, names[0]);
        }
        UnityEngine.Object.DestroyImmediate(a);
        UnityEngine.Object.DestroyImmediate(b);
    }

    static async Task RenderPixels(GltfImport importer, string clip)
    {
        var model = new GameObject("PixelModel");
        Check(await importer.InstantiateMainSceneAsync(model.transform), "pixel model instance");
        var animation = model.GetComponentInChildren<Animation>();
        Sample(animation, clip, 0);
        var renderer = model.GetComponentInChildren<SkinnedMeshRenderer>();
        var vertices = renderer.sharedMesh.vertices;
        var center = renderer.transform.TransformPoint((vertices[0] + vertices[1] + vertices[2]) / 3);
        var cameraObject = new GameObject("PixelCamera");
        var camera = cameraObject.AddComponent<Camera>();
        camera.transform.position = center + Vector3.forward * 3;
        camera.transform.rotation = Quaternion.LookRotation(Vector3.back);
        camera.orthographic = true;
        camera.orthographicSize = 0.8f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = Color.black;
        var target = new RenderTexture(64, 64, 24, RenderTextureFormat.ARGB32);
        target.Create();
        camera.targetTexture = target;
        var lightObject = new GameObject("PixelLight");
        var light = lightObject.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1;
        light.transform.rotation = Quaternion.LookRotation(Vector3.back);
        var texture = new Texture2D(64, 64, TextureFormat.RGBA32, false);
        async Task<Color> ReadCenter()
        {
            var frame = Time.frameCount;
            while (Time.frameCount < frame + 3) await Task.Yield();
            var previous = RenderTexture.active;
            RenderTexture.active = target;
            texture.ReadPixels(new Rect(0, 0, 64, 64), 0, 0);
            texture.Apply();
            RenderTexture.active = previous;
            return texture.GetPixel(32, 32);
        }
        var opaque = await ReadCenter();
        var fade = new Material(renderer.sharedMaterial);
        var baseColor = fade.GetColor(MaterialProperty.BaseColor);
        baseColor.a *= 0.5f;
        fade.SetColor(MaterialProperty.BaseColor, baseColor);
        fade.SetFloat(MaterialProperty.SrcBlend, (int)BlendMode.SrcAlpha);
        fade.SetFloat(MaterialProperty.DstBlend, (int)BlendMode.OneMinusSrcAlpha);
        fade.SetFloat(MaterialProperty.ZWrite, 0);
        fade.SetFloat(MaterialProperty.Surface, 1);
        fade.EnableKeyword(ShaderGraphMaterialGenerator.SurfaceTypeTransparentKeyword);
        fade.renderQueue = (int)RenderQueue.Transparent;
        renderer.sharedMaterial = fade;
        var translucent = await ReadCenter();
        Debug.Log("MODEL_SPIKE_PIXELS opaque=" + opaque + " opacityHalf=" + translucent);
        Check(opaque.r > 0.05f && opaque.r > opaque.g * 1.2f && translucent.r > 0.01f && translucent.r < opaque.r - 0.03f, "URP opaque and opacity pixel output");
        UnityEngine.Object.DestroyImmediate(model);
        UnityEngine.Object.DestroyImmediate(fade);
        UnityEngine.Object.DestroyImmediate(cameraObject);
        UnityEngine.Object.DestroyImmediate(lightObject);
        UnityEngine.Object.DestroyImmediate(texture);
        target.Release();
        UnityEngine.Object.DestroyImmediate(target);
    }

    async void Start()
    {
        try { await Run(); Debug.Log("MODEL_SPIKE_ALL_PASS"); }
        catch (Exception error) { Debug.LogException(error); }
    }
}

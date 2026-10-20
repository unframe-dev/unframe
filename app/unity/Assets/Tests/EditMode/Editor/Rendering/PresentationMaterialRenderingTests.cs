using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;

public sealed class PresentationMaterialRenderingTests
{
    [TestCase(true, 0f, 1f, 1f)]
    [TestCase(false, 0f, 1f, 0f)]
    [TestCase(true, 0f, 0f, 0f)]
    [TestCase(false, 1f, 1f, 1f)]
    public void FontMaskUsesTextureAlphaWhileNormalTexturesPreserveRgb(bool alphaMask, float red, float alpha, float expectedRed)
    {
        var shader = Resources.Load<Shader>("PresentationMaterials/PresentationUnlit");
        Assert.That(shader, Is.Not.Null);
        var material = new Material(shader);
        material.SetFloat("_AlphaMask", alphaMask ? 1f : 0f);
        var texture = new Texture2D(1, 1, TextureFormat.RGBA32, false, true);
        var output = new RenderTexture(8, 8, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
        var readback = new Texture2D(8, 8, TextureFormat.RGBA32, false, true);
        RenderTexture previous = RenderTexture.active;
        try
        {
            texture.SetPixel(0, 0, new Color(red, 0f, 0f, alpha));
            texture.Apply();
            material.SetColor("_BaseColor", Color.white);
            material.SetTexture("_BaseMap", texture);
            material.SetFloat("_Cull", (float)CullMode.Off);
            output.Create();
            RenderTexture.active = output;
            GL.Clear(true, true, Color.clear);
            Graphics.Blit(texture, output, material);
            RenderTexture.active = output;
            readback.ReadPixels(new Rect(0, 0, 8, 8), 0, 0);
            readback.Apply();
            Color actual = readback.GetPixel(4, 4);
            Assert.That(actual.r, Is.EqualTo(expectedRed).Within(0.02f));
            if (alphaMask && alpha > 0f)
            {
                Assert.That(actual.g, Is.EqualTo(1f).Within(0.02f));
                Assert.That(actual.b, Is.EqualTo(1f).Within(0.02f));
            }
            else
            {
                Assert.That(actual.g, Is.EqualTo(0f).Within(0.02f));
                Assert.That(actual.b, Is.EqualTo(0f).Within(0.02f));
            }
        }
        finally
        {
            RenderTexture.active = previous;
            output.Release();
            Object.DestroyImmediate(output);
            Object.DestroyImmediate(readback);
            Object.DestroyImmediate(texture);
            Object.DestroyImmediate(material);
        }
    }

}

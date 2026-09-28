using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public sealed class PreviewBridgeTests
{
    private GameObject cameraObject;
    private GameObject bridgeObject;
    private PreviewBridge bridge;

    [SetUp]
    public void SetUp()
    {
        cameraObject = new GameObject("Main Camera");
        cameraObject.tag = "MainCamera";
        cameraObject.AddComponent<Camera>();
        bridgeObject = new GameObject("PreviewBridge");
        bridge = bridgeObject.AddComponent<PreviewBridge>();
    }

    [TearDown]
    public void TearDown()
    {
        if (bridgeObject != null) UnityEngine.Object.DestroyImmediate(bridgeObject);
        if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
        GameObject root = GameObject.Find("Preview Scene");
        if (root != null) UnityEngine.Object.DestroyImmediate(root);
    }

    [Test]
    public void CanonicalTransform_ReflectsZAndQuaternionAxes()
    {
        Assert.That(PreviewBridge.ToUnityPosition(new[] { 1f, 2f, 3f }), Is.EqualTo(new Vector3(1f, 2f, -3f)));
        Quaternion rotation = PreviewBridge.ToUnityRotation(new[] { 0.1f, 0.2f, 0.3f, 0.9f });
        Assert.That(rotation.x, Is.EqualTo(-0.1f));
        Assert.That(rotation.y, Is.EqualTo(-0.2f));
        Assert.That(rotation.z, Is.EqualTo(0.3f));
        Assert.That(rotation.w, Is.EqualTo(0.9f));
    }

    [Test]
    public void SceneAndFrame_KeepHierarchyAndApplyLocalState()
    {
        bridge.LoadScene("{\"generation\":3,\"stageSize\":[4,3,1],\"nodes\":[{" +
            "\"id\":\"child\",\"parentId\":\"parent\",\"position\":[1,2,3],\"rotation\":[0,0,0,1],\"scale\":[1,1,1]}," +
            "{\"id\":\"parent\",\"parentId\":null,\"position\":[0,0,0],\"rotation\":[0,0,0,1],\"scale\":[1,1,1]}]," +
            "\"textures\":[],\"quads\":[]}");
        Assert.That(bridge.NodeCount, Is.EqualTo(2));
        Transform child = GameObject.Find("Node child").transform;
        Assert.That(child.parent.name, Is.EqualTo("Node parent"));
        Assert.That(child.localPosition, Is.EqualTo(new Vector3(1f, 2f, -3f)));

        bridge.ApplyFrame("{\"generation\":3,\"nodes\":[{\"id\":\"child\",\"position\":[2,0,-4],\"rotation\":[0,0,0,1],\"scale\":[2,3,1]}],\"quads\":[]}");
        Assert.That(child.localPosition, Is.EqualTo(new Vector3(2f, 0f, 4f)));
        Assert.That(child.localScale, Is.EqualTo(new Vector3(2f, 3f, 1f)));

        bridge.ApplyFrame("{\"generation\":2,\"nodes\":[{\"id\":\"child\",\"position\":[9,9,9],\"rotation\":[0,0,0,1],\"scale\":[1,1,1]}]}");
        Assert.That(child.localPosition, Is.EqualTo(new Vector3(2f, 0f, 4f)));
    }

    [Test]
    public void QuadGeometryAndFrame_UseCompiledUvAndVisibility()
    {
        bridge.LoadScene("{\"generation\":5,\"stageSize\":[2,2,1]," +
            "\"nodes\":[{\"id\":\"n\",\"position\":[0,0,0],\"rotation\":[0,0,0,1],\"scale\":[1,1,1]}]," +
            "\"textures\":[{\"id\":\"t\",\"url\":\"blob:http://localhost/mock\"},{\"id\":\"next\",\"url\":\"blob:http://localhost/next\"}]," +
            "\"quads\":[{\"id\":\"q\",\"nodeId\":\"n\",\"textureId\":\"t\",\"position\":[20.5,0,0.2],\"size\":[1,0.5],\"uvRect\":[0.25,0.1,0.75,0.9],\"layer\":2}]}");
        Assert.That(bridge.QuadCount, Is.EqualTo(1));
        GameObject quad = GameObject.Find("Quad q");
        Assert.That(quad.transform.localPosition, Is.EqualTo(new Vector3(20.5f, 0f, -0.2f)));
        Assert.That(quad.transform.localScale, Is.EqualTo(new Vector3(1f, 0.5f, 1f)));
        Renderer renderer = quad.GetComponent<Renderer>();
        Assert.That(quad.GetComponent<Collider>(), Is.Null);
        Mesh mesh = quad.GetComponent<MeshFilter>().sharedMesh;
        Vector3[] vertices = mesh.vertices;
        int[] triangles = mesh.triangles;
        Vector3 normal = Vector3.Cross(vertices[triangles[1]] - vertices[triangles[0]],
            vertices[triangles[2]] - vertices[triangles[0]]);
        Assert.That(normal.z, Is.LessThan(0f));
        Assert.That(renderer.enabled, Is.False);
        Assert.That(renderer.sortingOrder, Is.EqualTo(2));
        Assert.That(renderer.sharedMaterial.shader.name, Is.EqualTo("Unframe/PreviewUnlitTransparent"));
        Assert.That(renderer.sharedMaterial.HasProperty("_Color"), Is.True);
        Assert.That(renderer.sharedMaterial.HasProperty("_BlendTex"), Is.True);
        Assert.That(renderer.sharedMaterial.HasProperty("_BlendWeight"), Is.True);
        Assert.That(cameraObject.transform.position.x, Is.EqualTo(10f).Within(0.01f));
        Camera camera = cameraObject.GetComponent<Camera>();
        AssertVisible(camera, new Vector3(-1f, 0f, 0f));
        AssertVisible(camera, new Vector3(21f, 0f, -0.2f));
        foreach (Vector2 uv in quad.GetComponent<MeshFilter>().sharedMesh.uv)
        {
            Assert.That(uv.x, Is.InRange(0.25f, 0.75f));
            Assert.That(uv.y, Is.InRange(0.1f, 0.9f));
        }
        bridge.ApplyFrame("{\"generation\":5,\"nodes\":[],\"quads\":[{\"id\":\"q\",\"visible\":true,\"opacity\":0.4}]}");
        Assert.That(renderer.enabled, Is.True);
        Assert.That(renderer.sharedMaterial.color.a, Is.EqualTo(0.4f).Within(0.0001f));
        FieldInfo texturesField = typeof(PreviewBridge).GetField("textures", BindingFlags.Instance | BindingFlags.NonPublic);
        var loadedTextures = (Dictionary<string, Texture2D>)texturesField.GetValue(bridge);
        Texture2D next = new Texture2D(1, 1);
        loadedTextures.Add("next", next);
        bridge.ApplyFrame("{\"generation\":5,\"nodes\":[],\"quads\":[{\"id\":\"q\",\"visible\":true,\"opacity\":0.8,\"blendTextureId\":\"next\",\"blendWeight\":0.25}]}");
        Assert.That(renderer.sharedMaterial.GetTexture("_BlendTex"), Is.SameAs(next));
        Assert.That(renderer.sharedMaterial.GetFloat("_BlendWeight"), Is.EqualTo(0.25f));
        bridge.ClearScene("");
        Assert.That(bridge.QuadCount, Is.Zero);
        Assert.That(bridge.NodeCount, Is.Zero);
    }

    [Test]
    public void StageFraming_ContainsQuadAfterNodeMovesAcrossStage()
    {
        bridge.LoadScene("{\"generation\":7,\"stageSize\":[2,2,1]," +
            "\"nodes\":[{\"id\":\"n\",\"position\":[-0.9,0,0],\"rotation\":[0,0,0,1],\"scale\":[1,1,1]}]," +
            "\"textures\":[{\"id\":\"t\",\"url\":\"blob:http://localhost/mock\"}]," +
            "\"quads\":[{\"id\":\"q\",\"nodeId\":\"n\",\"textureId\":\"t\",\"position\":[0,0,0],\"size\":[0.1,0.1],\"uvRect\":[0,0,1,1],\"layer\":0}]}");
        Camera camera = cameraObject.GetComponent<Camera>();
        Vector3 initialCameraPosition = camera.transform.position;
        bridge.ApplyFrame("{\"generation\":7,\"nodes\":[{\"id\":\"n\",\"position\":[0.9,0,0],\"rotation\":[0,0,0,1],\"scale\":[1,1,1]}],\"quads\":[]}");
        Assert.That(camera.transform.position, Is.EqualTo(initialCameraPosition));
        Transform quad = GameObject.Find("Quad q").transform;
        foreach (Vector3 vertex in quad.GetComponent<MeshFilter>().sharedMesh.vertices)
            AssertVisible(camera, quad.TransformPoint(vertex));
    }

    private static void AssertVisible(Camera camera, Vector3 point)
    {
        Vector3 viewport = camera.WorldToViewportPoint(point);
        Assert.That(viewport.z, Is.GreaterThan(0f));
        Assert.That(viewport.x, Is.InRange(0f, 1f));
        Assert.That(viewport.y, Is.InRange(0f, 1f));
    }

    [Test]
    public void CameraViews_DifferWithoutChangingScene()
    {
        bridge.LoadScene("{\"generation\":1,\"stageSize\":[2,2,1],\"nodes\":[],\"textures\":[],\"quads\":[]}");
        bridge.SetView("front");
        Vector3 front = cameraObject.transform.position;
        bridge.SetView("upper-left");
        Vector3 upperLeft = cameraObject.transform.position;
        bridge.SetView("right");
        Vector3 right = cameraObject.transform.position;
        Assert.That(front, Is.Not.EqualTo(upperLeft));
        Assert.That(front, Is.Not.EqualTo(right));
        Assert.That(upperLeft.x, Is.LessThan(0f));
        Assert.That(right.x, Is.GreaterThan(0f));
        Assert.That(bridge.NodeCount, Is.Zero);
    }

    [Test]
    public void BuildScene_HasOnlyCameraAndBridge()
    {
        Scene original = SceneManager.GetActiveScene();
        string baselinePath = $"Assets/PreviewTestBaseline_{Guid.NewGuid():N}.unity";
        Assert.That(EditorSceneManager.SaveScene(original, baselinePath), Is.True);
        Scene scene = UnframeWebPreviewBuild.CreatePreviewScene();
        try
        {
            Assert.That(SceneManager.GetActiveScene(), Is.EqualTo(original));
            Assert.That(scene.GetRootGameObjects().Length, Is.EqualTo(2));
            Assert.That(Array.Exists(scene.GetRootGameObjects(), root => root.GetComponent<Camera>() != null), Is.True);
            Assert.That(Array.Exists(scene.GetRootGameObjects(), root => root.GetComponent<PreviewBridge>() != null), Is.True);
        }
        finally
        {
            EditorSceneManager.CloseScene(scene, true);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            UnityEditor.AssetDatabase.DeleteAsset(baselinePath);
        }
    }
}

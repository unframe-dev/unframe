using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public sealed class ArucoOriginVisualizer : MonoBehaviour
{
    private readonly List<Material> materials = new List<Material>();
    private Transform origin;

    public void Show(Pose pose)
    {
        if (origin == null) CreateOrigin();
        origin.SetPositionAndRotation(pose.position, pose.rotation);
        origin.gameObject.SetActive(true);
    }

    public void Hide()
    {
        if (origin != null) origin.gameObject.SetActive(false);
    }

    private void CreateOrigin()
    {
        var template = Resources.Load<Material>("ArucoDiagnosticUnlit");
        if (template == null)
            throw new InvalidOperationException("Open the PCA device test scene from the Unframe menu to prepare its material.");
        origin = new GameObject("ArUco ID 0 Origin (20 cm)").transform;
        AddBox("Origin Cube", new Vector3(0, 0, -0.03f), Vector3.one * 0.04f, Color.yellow, template);
        AddBox("X Right", new Vector3(0.1f, 0, 0), new Vector3(0.2f, 0.005f, 0.005f), Color.red, template);
        AddBox("Y Up", new Vector3(0, 0.1f, 0), new Vector3(0.005f, 0.2f, 0.005f), Color.green, template);
        AddBox("Z Into Paper", new Vector3(0, 0, 0.1f), new Vector3(0.005f, 0.005f, 0.2f), Color.blue, template);
    }

    private void AddBox(string name, Vector3 position, Vector3 scale, Color color, Material template)
    {
        var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
        box.name = name;
        box.transform.SetParent(origin, false);
        box.transform.localPosition = position;
        box.transform.localScale = scale;
        ReleaseOwnedObject(box.GetComponent<Collider>());
        var material = new Material(template);
        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
        if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        materials.Add(material);
        var renderer = box.GetComponent<MeshRenderer>();
        renderer.sharedMaterial = material;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
    }

    private void OnDestroy()
    {
        if (origin != null) ReleaseOwnedObject(origin.gameObject);
        foreach (var material in materials) ReleaseOwnedObject(material);
    }

    private static void ReleaseOwnedObject(UnityEngine.Object value)
    {
        if (Application.isPlaying) Destroy(value);
        else DestroyImmediate(value);
    }
}

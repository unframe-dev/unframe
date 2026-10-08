using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public sealed class ArucoOriginVisualizer : MonoBehaviour
{
    [SerializeField] private bool visible = true;
    public bool Visible
    {
        get => visible;
        set
        {
            visible = value;
            if (!value) Hide();
        }
    }

    private readonly List<Material> materials = new List<Material>();
    private Transform origin;
    private Material cubeMaterial;
    private bool provisional;
    private Transform nearbyOrigin;
    private Transform previewHead;
    private bool hasNearbyReference;
    private Vector3 referenceMarkerPosition;
    private Pose latestPose;

    public void SetPreviewHead(Transform head) => previewHead = head;
    public void ResetMeasurementReference() => hasNearbyReference = false;

    private void LateUpdate()
    {
        if (nearbyOrigin != null && nearbyOrigin.gameObject.activeSelf) UpdateNearbyPose();
    }

    public void ShowProvisional(Pose pose) => Show(pose, true);

    public void Show(Pose pose) => Show(pose, false);

    private void Show(Pose pose, bool isProvisional)
    {
        if (!visible) return;
        if (origin == null) CreateOrigin();
        if (provisional != isProvisional)
        {
            provisional = isProvisional;
            SetColor(cubeMaterial, provisional ? Color.cyan : Color.yellow);
        }
        origin.SetPositionAndRotation(pose.position, pose.rotation);
        origin.gameObject.SetActive(true);
        latestPose = pose;
        if (isProvisional && previewHead != null)
        {
            if (!hasNearbyReference)
            {
                referenceMarkerPosition = pose.position;
                hasNearbyReference = true;
            }
            if (nearbyOrigin == null) nearbyOrigin = CreateAxes("Nearby ArUco Measurement", Color.cyan, out _);
            UpdateNearbyPose();
            nearbyOrigin.gameObject.SetActive(true);
        }
        else if (nearbyOrigin != null) nearbyOrigin.gameObject.SetActive(false);
    }

    private void UpdateNearbyPose()
    {
        if (previewHead == null)
        {
            nearbyOrigin.gameObject.SetActive(false);
            return;
        }
        // Keep the diagnostic copy nearby while preserving world-space measurement deltas and orientation.
        nearbyOrigin.SetPositionAndRotation(previewHead.TransformPoint(new Vector3(0.35f, -0.2f, 0.65f))
            + latestPose.position - referenceMarkerPosition, latestPose.rotation);
    }

    public void Hide()
    {
        if (origin != null) origin.gameObject.SetActive(false);
        if (nearbyOrigin != null) nearbyOrigin.gameObject.SetActive(false);
    }

    private void CreateOrigin()
    {
        origin = CreateAxes("ArUco ID 0 Origin (20 cm)", Color.yellow, out cubeMaterial);
    }

    private Transform CreateAxes(string name, Color color, out Material cube)
    {
        var template = Resources.Load<Material>("ArucoDiagnosticUnlit");
        if (template == null)
            throw new InvalidOperationException("Open the PCA device test scene from the Unframe menu to prepare its material.");
        var root = new GameObject(name).transform;
        cube = AddBox(root, "Origin Cube", new Vector3(0, 0, -0.03f), Vector3.one * 0.04f, color, template);
        AddBox(root, "X Right", new Vector3(0.1f, 0, 0), new Vector3(0.2f, 0.005f, 0.005f), Color.red, template);
        AddBox(root, "Y Up", new Vector3(0, 0.1f, 0), new Vector3(0.005f, 0.2f, 0.005f), Color.green, template);
        AddBox(root, "Z Into Paper", new Vector3(0, 0, 0.1f), new Vector3(0.005f, 0.005f, 0.2f), Color.blue, template);
        return root;
    }

    private Material AddBox(Transform root, string name, Vector3 position, Vector3 scale, Color color, Material template)
    {
        var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
        box.name = name;
        box.transform.SetParent(root, false);
        box.transform.localPosition = position;
        box.transform.localScale = scale;
        ReleaseOwnedObject(box.GetComponent<Collider>());
        var material = new Material(template);
        SetColor(material, color);
        materials.Add(material);
        var renderer = box.GetComponent<MeshRenderer>();
        renderer.sharedMaterial = material;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        return material;
    }

    private static void SetColor(Material material, Color color)
    {
        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
        if (material.HasProperty("_Color")) material.SetColor("_Color", color);
    }

    private void OnDestroy()
    {
        if (origin != null) ReleaseOwnedObject(origin.gameObject);
        if (nearbyOrigin != null) ReleaseOwnedObject(nearbyOrigin.gameObject);
        foreach (var material in materials) ReleaseOwnedObject(material);
    }

    private static void ReleaseOwnedObject(UnityEngine.Object value)
    {
        if (Application.isPlaying) Destroy(value);
        else DestroyImmediate(value);
    }
}

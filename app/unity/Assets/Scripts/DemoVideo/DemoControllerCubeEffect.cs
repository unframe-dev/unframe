using UnityEngine;

public sealed class DemoControllerCubeEffect : MonoBehaviour
{
    [SerializeField] private Vector3 localOffset = new Vector3(0f, 0.15f, 0f);
    [SerializeField] private float rotationSpeed = 90f;

    private GameObject cube;
    private float scaleProgress;

    public bool IsVisible => cube != null;

    public void Show(Vector3 controllerPosition, Quaternion controllerRotation)
    {
        if (cube == null)
        {
            cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = "Demo Controller Cube";
            cube.transform.SetParent(transform, false);
            Renderer renderer = cube.GetComponent<Renderer>();
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color");
            if (renderer != null && shader != null)
            {
                Material material = new Material(shader);
                material.color = new Color(0.25f, 0.75f, 1f, 1f);
                renderer.material = material;
            }
        }

        cube.SetActive(true);
        scaleProgress = 0f;
        cube.transform.localScale = Vector3.zero;
        Follow(controllerPosition, controllerRotation, 0f);
    }

    public void Follow(Vector3 controllerPosition, Quaternion controllerRotation, float deltaTime)
    {
        if (cube == null)
        {
            return;
        }

        cube.transform.position = controllerPosition + controllerRotation * localOffset;
        cube.transform.Rotate(Vector3.one, rotationSpeed * deltaTime, Space.Self);
        scaleProgress = Mathf.Min(scaleProgress + deltaTime * 4f, 1f);
        float scale = scaleProgress <= 0.8f
            ? Mathf.Lerp(0f, 1.12f, scaleProgress / 0.8f)
            : Mathf.Lerp(1.12f, 1f, (scaleProgress - 0.8f) / 0.2f);
        cube.transform.localScale = Vector3.one * scale;
    }
}

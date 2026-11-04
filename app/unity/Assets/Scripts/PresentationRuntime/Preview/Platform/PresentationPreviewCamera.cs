using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    [RequireComponent(typeof(Camera))]
    public sealed class PresentationPreviewCamera : MonoBehaviour
    {
        private Vector3 focus;
        private float distance = 4;
        private float yaw;
        private float pitch;
        private bool overhead;
        private Bounds spatialBounds = new Bounds(Vector3.zero, new Vector3(4, 2, 4));
        public bool IsOverhead { get { return overhead; } }

        public void SetSpatialBounds(Bounds bounds) { spatialBounds = bounds; if (overhead) Apply(); }
        public void SetView(string view)
        {
            if (view != "perspective" && view != "overhead") throw new System.ArgumentException("preview.view-invalid");
            overhead = view == "overhead";
            Apply();
        }

        public void Frame(Transform presentation)
        {
            Renderer[] renderers = presentation == null ? System.Array.Empty<Renderer>() : presentation.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) { focus = Vector3.zero; distance = 4; }
            else
            {
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer renderer in renderers) bounds.Encapsulate(renderer.bounds);
                focus = bounds.center;
                float halfFov = GetComponent<Camera>().fieldOfView * Mathf.Deg2Rad / 2;
                distance = Mathf.Max(0.5f, bounds.extents.magnitude / Mathf.Sin(halfFov) * 1.2f);
            }
            yaw = pitch = 0;
            Apply();
        }
        public void ResetToOrigin()
        {
            overhead = false;
            distance = 4;
            yaw = pitch = 0;
            focus = new Vector3(0, 1.6f, distance);
            Apply();
        }
        private void Update()
        {
            if (overhead) { Apply(); return; }
            if (Input.GetMouseButton(0))
            {
                yaw += Input.GetAxis("Mouse X") * 3;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * 3, -85, 85);
            }
            if (Input.GetMouseButton(2))
                focus -= (transform.right * Input.GetAxis("Mouse X") + transform.up * Input.GetAxis("Mouse Y")) * distance * 0.02f;
            distance = Mathf.Clamp(distance * Mathf.Exp(-Input.mouseScrollDelta.y * 0.15f), 0.05f, 10000);
            Apply();
        }
        private void Apply()
        {
            Camera camera = GetComponent<Camera>();
            camera.orthographic = overhead;
            if (overhead)
            {
                float aspect = Mathf.Max(0.01f, camera.aspect);
                camera.orthographicSize = Mathf.Max(2, spatialBounds.extents.z, spatialBounds.extents.x / aspect) * 1.2f;
                transform.rotation = Quaternion.Euler(90, 0, 0);
                transform.position = new Vector3(spatialBounds.center.x, spatialBounds.max.y + Mathf.Max(10, camera.orthographicSize * 2), spatialBounds.center.z);
                return;
            }
            transform.rotation = Quaternion.Euler(pitch, yaw, 0);
            transform.position = focus - transform.forward * distance;
        }
    }
}

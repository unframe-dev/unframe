using UnityEngine;

public static class TransformApplier
{
    public static void Apply(GameObject obj, ManifestTransform transform)
    {
        if (obj == null || transform == null)
        {
            return;
        }

        obj.transform.localPosition = new Vector3(
            transform.position.x,
            transform.position.y,
            transform.position.z
        );

        obj.transform.localEulerAngles = new Vector3(
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z
        );

        obj.transform.localScale = new Vector3(
            transform.scale.x,
            transform.scale.y,
            transform.scale.z
        );
    }
}
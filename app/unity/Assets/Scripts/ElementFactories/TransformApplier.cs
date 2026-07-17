using UnityEngine;

public static class TransformApplier
{
    public const float SlideWidthPx = 1280f;
    public const float SlideHeightPx = 720f;

    // 1920px x 1080px を 1.92m x 1.08m として扱う
    public const float MeterPerPixel = 0.001f;

    // zは最初から大きく動かすとレイアウトが崩れやすいので、小さめに使う
    public const float LayoutDepthPerUnit = 0.0001f;

    // 実機確認済み: textの見た目は fontSize / 100 がちょうどよい
    public const float TextScaleDivisor = 100f;

    // 同じz値の要素同士が重ならないようにする微小オフセット
    public const float ElementOrderDepthOffset = 0.00001f;

    public static Vector3 ToUnityCenterPosition(
        ManifestTransform transform,
        int elementOrder = 0
    )
    {
        if (transform == null)
        {
            return Vector3.zero;
        }

        if (HasCircularPlacement(transform))
        {
            return ToCircularPosition(transform);
        }

        ManifestVector3 position = transform.position;
        ManifestVector3 scale = transform.scale;

        float px = position != null ? position.x : 0f;
        float py = position != null ? position.y : 0f;
        float pz = position != null ? position.z : 0f;

        float widthPx = scale != null ? scale.x : 0f;
        float heightPx = scale != null ? scale.y : 0f;

        // JSONのpositionは左上座標なので、Unity配置用に中心座標へ変換
        float centerX = px + widthPx / 2f;
        float centerY = py + heightPx / 2f;

        // プレゼン左上原点 -> Unity中央原点
        float x = (centerX - SlideWidthPx / 2f) * MeterPerPixel;
        float y = (SlideHeightPx / 2f - centerY) * MeterPerPixel;

        // zが大きいほど手前、かつ配列の後ろの要素ほど少し手前にする。
        // 見た目が逆なら、この2行の - を + に反転する。
        float z = -pz * LayoutDepthPerUnit;
        z -= elementOrder * ElementOrderDepthOffset;

        return new Vector3(x, y, z);
    }

    public static bool HasCircularPlacement(ManifestTransform transform)
    {
        return transform?.circular != null && transform.circular.enabled;
    }

    public static Vector3 ToCircularPosition(ManifestTransform transform)
    {
        if (transform == null || transform.circular == null)
        {
            return Vector3.zero;
        }

        ManifestCircularPlacement circular = transform.circular;
        ManifestVector3 startPosition = circular.startPosition;
        ManifestVector3 viewpointPosition = circular.viewpointPosition;
        ManifestVector3 offset = transform.position;

        Vector3 viewpoint = new Vector3(
            viewpointPosition != null ? viewpointPosition.x : 0f,
            viewpointPosition != null ? viewpointPosition.y : 0f,
            viewpointPosition != null ? viewpointPosition.z : 0f
        );
        Vector3 start = new Vector3(
            startPosition != null ? startPosition.x : 0f,
            startPosition != null ? startPosition.y : 0f,
            startPosition != null ? startPosition.z : 1f
        );

        Vector3 startOffset = start - viewpoint;
        Vector3 horizontalOffset = new Vector3(startOffset.x, 0f, startOffset.z);
        float radius = circular.radius > 0f ? circular.radius : horizontalOffset.magnitude;

        if (horizontalOffset.sqrMagnitude <= Mathf.Epsilon)
        {
            horizontalOffset = Vector3.forward;
        }

        horizontalOffset = horizontalOffset.normalized * radius;

        float offsetY = offset != null ? offset.y : 0f;
        Quaternion angleRotation = Quaternion.Euler(0f, NormalizeAngle(circular.angle), 0f);
        Vector3 rotatedOffset = angleRotation * horizontalOffset;

        return new Vector3(
            viewpoint.x + rotatedOffset.x,
            start.y + offsetY,
            viewpoint.z + rotatedOffset.z
        );
    }

    public static Vector2 ToUnitySize(ManifestTransform transform)
    {
        if (transform == null || transform.scale == null)
        {
            return Vector2.zero;
        }

        return new Vector2(
            Mathf.Abs(transform.scale.x) * MeterPerPixel,
            Mathf.Abs(transform.scale.y) * MeterPerPixel
        );
    }

    public static Vector3 ToFlatEulerAngles(ManifestTransform transform)
    {
        if (transform == null)
        {
            return Vector3.zero;
        }

        ManifestVector3 rotation = transform.rotation;
        Vector3 baseRotation = new Vector3(
            rotation != null ? rotation.x : 0f,
            rotation != null ? rotation.y : 0f,
            rotation != null ? -rotation.z : 0f
        );

        if (ShouldFaceCircularCenter(transform))
        {
            baseRotation += ToFlatCircularFaceCenterEulerAngles(transform);
        }

        // 2D平面要素は、y軸の向きが反転しているのでZ回転を反転
        return baseRotation;
    }

    public static Vector3 ToModelEulerAngles(ManifestTransform transform)
    {
        if (transform == null)
        {
            return Vector3.zero;
        }

        ManifestVector3 rotation = transform.rotation;
        Vector3 baseRotation = new Vector3(
            rotation != null ? rotation.x : 0f,
            rotation != null ? rotation.y : 0f,
            rotation != null ? rotation.z : 0f
        );

        if (ShouldFaceCircularCenter(transform))
        {
            baseRotation += ToModelCircularFaceCenterEulerAngles(transform);
        }

        // 3DモデルはまずJSONの回転値をそのまま使う
        return baseRotation;
    }

    private static bool ShouldFaceCircularCenter(ManifestTransform transform)
    {
        return HasCircularPlacement(transform) && transform.circular.faceCenter;
    }

    private static Vector3 ToFlatCircularFaceCenterEulerAngles(ManifestTransform transform)
    {
        Vector3 position = ToCircularPosition(transform);
        Vector3 center = ToCircularViewpoint(transform);

        return ToLookRotationEulerAngles(position - center);
    }

    private static Vector3 ToModelCircularFaceCenterEulerAngles(ManifestTransform transform)
    {
        Vector3 position = ToCircularPosition(transform);
        Vector3 center = ToCircularViewpoint(transform);

        return ToLookRotationEulerAngles(center - position);
    }

    private static Vector3 ToCircularViewpoint(ManifestTransform transform)
    {
        ManifestVector3 viewpointPosition = transform.circular.viewpointPosition;

        return new Vector3(
            viewpointPosition != null ? viewpointPosition.x : 0f,
            viewpointPosition != null ? viewpointPosition.y : 0f,
            viewpointPosition != null ? viewpointPosition.z : 0f
        );
    }

    private static Vector3 ToLookRotationEulerAngles(Vector3 direction)
    {
        if (direction.sqrMagnitude <= Mathf.Epsilon)
        {
            return Vector3.zero;
        }

        return Quaternion.LookRotation(direction, Vector3.up).eulerAngles;
    }

    private static float NormalizeAngle(float angle)
    {
        float normalized = angle % 360f;
        return normalized < 0f ? normalized + 360f : normalized;
    }

    public static void ApplyFlatPlane(
        GameObject obj,
        ManifestTransform transform,
        int elementOrder = 0
    )
    {
        if (obj == null || transform == null)
        {
            return;
        }

        obj.transform.localPosition = ToUnityCenterPosition(transform, elementOrder);
        obj.transform.localEulerAngles = ToFlatEulerAngles(transform);

        Vector2 size = ToUnitySize(transform);
        obj.transform.localScale = new Vector3(size.x, size.y, 1f);
    }

    public static float ApplyTextObject(
        GameObject obj,
        ManifestTransform transform,
        float fontSizePx,
        int elementOrder = 0
    )
    {
        if (obj == null || transform == null)
        {
            return 1f;
        }

        obj.transform.localPosition = ToUnityCenterPosition(transform, elementOrder);
        obj.transform.localEulerAngles = ToFlatEulerAngles(transform);

        float textScale = Mathf.Max(fontSizePx / TextScaleDivisor, 0.001f);
        obj.transform.localScale = new Vector3(textScale, textScale, 1f);

        return textScale;
    }

    public static void ApplyModelContainer(
        GameObject obj,
        ManifestTransform transform,
        int elementOrder = 0
    )
    {
        if (obj == null || transform == null)
        {
            return;
        }

        obj.transform.localPosition = ToUnityCenterPosition(transform, elementOrder);
        obj.transform.localEulerAngles = ToModelEulerAngles(transform);

        // モデルの実サイズ調整は、ロード後のchild側でRenderer.boundsを見て行う。
        obj.transform.localScale = Vector3.one;
    }
}

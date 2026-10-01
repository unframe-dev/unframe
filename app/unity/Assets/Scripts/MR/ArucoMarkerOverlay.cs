using UnityEngine;
using UnityEngine.UI;

public sealed class ArucoMarkerOverlay : MaskableGraphic
{
    private ArucoMarkerDetectionFrame frame;
    public void SetFrame(ArucoMarkerDetectionFrame value)
    {
        if (ReferenceEquals(frame, value)) return;
        frame = value;
        SetVerticesDirty();
    }

    public static Vector2 PixelToPanel(Vector2 pixel, Vector2Int resolution, Rect rect)
    {
        return new Vector2(rect.xMin + pixel.x / resolution.x * rect.width,
            rect.yMax - pixel.y / resolution.y * rect.height);
    }

    protected override void OnPopulateMesh(VertexHelper vertices)
    {
        vertices.Clear();
        if (frame == null) return;
        Rect rect = rectTransform.rect;
        for (int marker = 0; marker < frame.MarkerIds.Length; marker++)
        {
            for (int corner = 0; corner < 4; corner++)
            {
                int start = marker * 8 + corner * 2;
                int end = marker * 8 + ((corner + 1) % 4) * 2;
                var a = PixelToPanel(new Vector2(frame.CornersPixels[start], frame.CornersPixels[start + 1]), frame.Resolution, rect);
                var b = PixelToPanel(new Vector2(frame.CornersPixels[end], frame.CornersPixels[end + 1]), frame.Resolution, rect);
                Vector2 direction = (b - a).normalized;
                Vector2 offset = new Vector2(-direction.y, direction.x) * 2;
                int index = vertices.currentVertCount;
                vertices.AddVert(a - offset, color, Vector2.zero);
                vertices.AddVert(a + offset, color, Vector2.zero);
                vertices.AddVert(b + offset, color, Vector2.zero);
                vertices.AddVert(b - offset, color, Vector2.zero);
                vertices.AddTriangle(index, index + 1, index + 2);
                vertices.AddTriangle(index + 2, index + 3, index);
            }
        }
    }
}

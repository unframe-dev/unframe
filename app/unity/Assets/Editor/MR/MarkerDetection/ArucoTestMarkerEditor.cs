#if UNFRAME_OPENCV_FOR_UNITY
using System.Globalization;
using System.IO;
using System.Text;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.ObjdetectModule;
using UnityEditor;
using UnityEngine;

public static class ArucoTestMarkerEditor
{
    [MenuItem("Unframe/Tools/Generate Printable Markers")]
    public static void GenerateMarkers()
    {
        string directory = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "docs", "aruco-markers"));
        Directory.CreateDirectory(directory);
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50))
        using (var marker = new Mat())
        {
            foreach (int id in new[] { 0, 23 })
            {
                Objdetect.generateImageMarker(dictionary, id, 6, marker, 1);
                var pixels = new byte[36];
                marker.get(0, 0, pixels);
                var svg = new StringBuilder();
                svg.AppendLine("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"240mm\" height=\"260mm\" viewBox=\"0 0 240 260\">");
                svg.AppendLine("<rect width=\"240\" height=\"260\" fill=\"white\"/>");
                for (int y = 0; y < 6; y++)
                {
                    for (int x = 0; x < 6; x++)
                    {
                        if (pixels[y * 6 + x] != 0) continue;
                        svg.AppendLine(string.Format(CultureInfo.InvariantCulture,
                            "<rect x=\"{0:F6}\" y=\"{1:F6}\" width=\"{2:F6}\" height=\"{2:F6}\" fill=\"black\"/>",
                            20 + x * 200.0 / 6, 20 + y * 200.0 / 6, 200.0 / 6));
                    }
                }
                svg.AppendLine($"<text x=\"120\" y=\"245\" font-family=\"sans-serif\" font-size=\"5\" text-anchor=\"middle\">DICT_4X4_50 / ID {id} / 200 mm</text>");
                svg.AppendLine("</svg>");
                File.WriteAllText(Path.Combine(directory, $"4x4-50-id-{id}.svg"), svg.ToString(), new UTF8Encoding(false));
            }
        }
        Debug.Log("[ArUco Detection] Printable markers: " + directory);
    }
}
#endif

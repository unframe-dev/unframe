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
        string directory = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "docs", "apriltag-markers"));
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "tag36h11-id-0.svg"), CreateMarkerSvg(), new UTF8Encoding(false));
        Debug.Log("[AprilTag Detection] Printable marker: " + directory);
    }

    public static string CreateMarkerSvg()
    {
        using (var dictionary = Objdetect.getPredefinedDictionary(Objdetect.DICT_APRILTAG_36h11))
        using (var marker = new Mat())
        {
            Objdetect.generateImageMarker(dictionary, ArucoMarkerPoseEstimator.TargetMarkerId, 8, marker, 1);
            Core.flip(marker, marker, -1);
            var pixels = new byte[64];
            marker.get(0, 0, pixels);
            var svg = new StringBuilder();
            svg.Append("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"225mm\" height=\"225mm\" viewBox=\"0 0 150 150\"><title>tag36h11 ID 0 outer size 225mm; black boundary 150mm; white quiet zone 37.5mm</title><rect width=\"150\" height=\"150\" fill=\"white\"/><g fill=\"black\" shape-rendering=\"crispEdges\">");
            for (int y = 0; y < 8; y++)
            {
                for (int x = 0; x < 8; x++)
                {
                    if (pixels[y * 8 + x] != 0) continue;
                    svg.AppendFormat(CultureInfo.InvariantCulture,
                        "<rect x=\"{0}\" y=\"{1}\" width=\"12.5\" height=\"12.5\"/>",
                        25 + x * 12.5, 25 + y * 12.5);
                }
            }
            svg.Append("</g></svg>\n");
            return svg.ToString();
        }
    }
}
#endif

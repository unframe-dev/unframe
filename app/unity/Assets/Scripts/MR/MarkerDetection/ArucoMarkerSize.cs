using System;

public enum ArucoMarkerSize
{
    Mm150 = 150,
    Mm250 = 250,
    Mm400 = 400,
    Mm500 = 500
}

public static class ArucoMarkerSizes
{
    public static ArucoMarkerSize FromMillimeters(int millimeters)
    {
        switch (millimeters)
        {
            case 150: return ArucoMarkerSize.Mm150;
            case 250: return ArucoMarkerSize.Mm250;
            case 400: return ArucoMarkerSize.Mm400;
            case 500: return ArucoMarkerSize.Mm500;
            default: throw new ArgumentOutOfRangeException(nameof(millimeters), "Select a 150, 250, 400 or 500 mm black marker border.");
        }
    }
}

using System;

public enum AprilTagMarkerSize
{
    Mm150 = 150,
    Mm250 = 250,
    Mm400 = 400,
    Mm500 = 500
}

public static class AprilTagMarkerSizes
{
    public static AprilTagMarkerSize FromMillimeters(int millimeters)
    {
        switch (millimeters)
        {
            case 150: return AprilTagMarkerSize.Mm150;
            case 250: return AprilTagMarkerSize.Mm250;
            case 400: return AprilTagMarkerSize.Mm400;
            case 500: return AprilTagMarkerSize.Mm500;
            default: throw new ArgumentOutOfRangeException(nameof(millimeters), "Select a 150, 250, 400 or 500 mm black marker border.");
        }
    }
}

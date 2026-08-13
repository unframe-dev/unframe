using UnityEngine;

public static class PresentationMotionPresets
{
    public static bool TryResolve(string id, out PresentationMotionPreset preset)
    {
        switch (id)
        {
            case "swipe_right":
                preset = new PresentationMotionPreset(
                    "swipe_right",
                    Vector3.right,
                    0.15f,
                    0.75f,
                    0.2f
                );
                return true;
            case "push_forward":
                preset = new PresentationMotionPreset(
                    "push_forward",
                    Vector3.forward,
                    0.15f,
                    0.75f,
                    0.2f
                );
                return true;
            default:
                preset = null;
                return false;
        }
    }
}

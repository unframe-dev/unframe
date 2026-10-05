using Unframe.Presentation.V2;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationUnityCoordinates
    {
        internal static UnityEngine.Vector3 Position(Vector3 value)
        {
            return new UnityEngine.Vector3((float)value.X, (float)value.Y, -(float)value.Z);
        }

        internal static UnityEngine.Vector3 Scale(Vector3 value)
        {
            return new UnityEngine.Vector3((float)value.X, (float)value.Y, (float)value.Z);
        }

        internal static UnityEngine.Quaternion Rotation(Quaternion value)
        {
            return new UnityEngine.Quaternion(-(float)value.X, -(float)value.Y, (float)value.Z, (float)value.W);
        }
    }
}

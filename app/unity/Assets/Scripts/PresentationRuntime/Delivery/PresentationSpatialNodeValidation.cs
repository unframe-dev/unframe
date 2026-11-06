using Unframe.Presentation;

namespace Unframe.Unity.PresentationRuntime
{
    internal static class PresentationSpatialNodeValidation
    {
        internal static bool IsValid(ProjectedNodeDefinition node)
        {
            if (node.Shape != null)
            {
                var shape = node.Shape;
                var material = shape.Material;
                return material?.Color != null && !material.CastsShadows && !material.ReceivesShadows
                    && Unit(material.Color.Red) && Unit(material.Color.Green) && Unit(material.Color.Blue) && Unit(material.Color.Alpha)
                    && (shape.GeometryCase == ShapeNode.GeometryOneofCase.Box && PresentationCoordinateAdapter.IsValidScale(shape.Box.Size)
                        || shape.GeometryCase == ShapeNode.GeometryOneofCase.Sphere && Positive(shape.Sphere.Radius) && Positive(shape.Sphere.Radius * 2));
            }
            if (node.Light == null) return true;
            var light = node.Light;
            if (light.Directional != null)
                return Color(light.Directional.Color) && Nonnegative(light.Directional.IntensityLux);
            if (light.Point != null)
                return Color(light.Point.Color) && Nonnegative(light.Point.IntensityCandela) && Positive(light.Point.RangeMeters);
            if (light.Spot == null) return false;
            var spot = light.Spot;
            return Color(spot.Color) && Nonnegative(spot.IntensityCandela) && Positive(spot.RangeMeters)
                && Positive(spot.OuterAngleDegrees) && spot.OuterAngleDegrees <= 180
                && Nonnegative(spot.InnerAngleDegrees) && spot.InnerAngleDegrees <= spot.OuterAngleDegrees;
        }
        private static bool Color(SrgbColor color) => color != null && Unit(color.Red) && Unit(color.Green) && Unit(color.Blue);
        private static bool Unit(double value) => !double.IsNaN(value) && value >= 0 && value <= 1;
        private static bool Nonnegative(double value) => !double.IsNaN(value) && value >= 0 && value <= float.MaxValue;
        private static bool Positive(double value) => Nonnegative(value) && (float)value > 0;
    }
}

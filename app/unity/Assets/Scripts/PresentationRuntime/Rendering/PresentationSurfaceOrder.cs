using System;
using System.Collections.Generic;
using Unframe.Delivery;

namespace Unframe.Unity.PresentationRuntime
{
    internal sealed class PresentationSurfaceOrder
    {
        private readonly Dictionary<string, Dictionary<uint, int>> orders = new Dictionary<string, Dictionary<uint, int>>();
        internal PresentationSurfaceOrder(IPresentationRenderView view)
        {
            var layers = new Dictionary<string, SortedSet<uint>>();
            foreach (DeliveredRenderSurface surface in view.RenderSurfaces)
            {
                if (!layers.TryGetValue(surface.SemanticSurfaceId, out var values))
                { values = new SortedSet<uint>(); layers.Add(surface.SemanticSurfaceId, values); }
                values.Add(surface.Layer);
            }
            foreach (var surface in layers)
            {
                // Unity sorting orders are signed 16-bit values; contract layers are uint32.
                if (surface.Value.Count > 65536) throw new InvalidOperationException("surface-layer-limit");
                var ranked = new Dictionary<uint, int>(); int rank = -32768;
                foreach (uint layer in surface.Value) ranked.Add(layer, rank++);
                orders.Add(surface.Key, ranked);
            }
        }
        internal int Resolve(DeliveredRenderSurface surface) => orders[surface.SemanticSurfaceId][surface.Layer];
    }
}

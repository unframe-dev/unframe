using System;
using System.Globalization;
using Unframe.Delivery;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestPresenterHudState
    {
        public const string PageNumberSemanticId = "presentation.pageNumber";

        private string currentSessionId = string.Empty;
        private double? displayedPageNumber;
        private double startedAt = double.NaN;
        private long displayedSeconds;

        public string PageText { get; private set; } = "現在ページ: —";
        public string ElapsedText { get; private set; } = "経過時間: 00:00";

        public static double? ReadPageNumber(IPresentationRenderView view)
        {
            if (view == null) return null;
            double? pageNumber = null;
            foreach (ProjectedSemanticSurface surface in view.SemanticSurfaces)
            {
                if (!view.TryGetSurfaceState(surface.SemanticSurfaceId, out SurfaceRuntimeState runtime)) continue;
                foreach (SurfaceSemanticState state in surface.States)
                {
                    if (state.StateId != runtime.StateId || state.SemanticTree == null) continue;
                    foreach (ProjectedSemanticNode node in state.SemanticTree.Nodes)
                    {
                        if (node.SemanticNodeId != PageNumberSemanticId
                            && !node.SemanticNodeId.EndsWith(":" + PageNumberSemanticId, StringComparison.Ordinal)) continue;
                        if (!double.TryParse(node.Text, NumberStyles.None, CultureInfo.InvariantCulture, out double number)
                            || !IsFinite(number) || number <= 0 || Math.Truncate(number) != number
                            || pageNumber.HasValue && pageNumber.Value != number) return null;
                        pageNumber = number;
                    }
                }
            }
            return pageNumber;
        }

        public void Refresh(string sessionId, double? pageNumber, bool running, double now)
        {
            string nextSessionId = sessionId ?? string.Empty;
            if (currentSessionId != nextSessionId)
            {
                currentSessionId = nextSessionId;
                startedAt = double.NaN;
                displayedSeconds = 0;
                ElapsedText = "経過時間: 00:00";
            }

            double? validPageNumber = pageNumber.HasValue && IsFinite(pageNumber.Value)
                && pageNumber.Value > 0 && Math.Truncate(pageNumber.Value) == pageNumber.Value
                    ? pageNumber : null;
            if (displayedPageNumber != validPageNumber)
            {
                displayedPageNumber = validPageNumber;
                PageText = validPageNumber.HasValue
                    ? "現在ページ: " + validPageNumber.Value.ToString("0", CultureInfo.InvariantCulture) + "ページ目"
                    : "現在ページ: —";
            }

            if (!IsFinite(now) || now < 0) return;
            if (double.IsNaN(startedAt))
            {
                if (running && !string.IsNullOrWhiteSpace(currentSessionId)) startedAt = now;
                return;
            }

            double elapsed = now - startedAt;
            if (elapsed < displayedSeconds) return;
            long seconds = (long)Math.Min(Math.Floor(elapsed), TimeSpan.MaxValue.Ticks / TimeSpan.TicksPerSecond);
            if (seconds == displayedSeconds) return;
            displayedSeconds = seconds;
            ElapsedText = seconds < 3600
                ? string.Format(CultureInfo.InvariantCulture, "経過時間: {0:00}:{1:00}", seconds / 60, seconds % 60)
                : string.Format(CultureInfo.InvariantCulture, "経過時間: {0:00}:{1:00}:{2:00}",
                    seconds / 3600, seconds / 60 % 60, seconds % 60);
        }

        private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}

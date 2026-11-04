using System;
using System.Collections.Generic;
using NUnit.Framework;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestPresenterHudTests
{
    [Test]
    public void ReadsOnlyTheExplicitPageSemanticFromTheCurrentSurfaceState()
    {
        var view = new HudRenderView();
        view.Surfaces.Add(SemanticSurface("pages", "old", "presentation.pageNumber", "1"));
        view.Surfaces[0].States.Add(SemanticSurface("pages", "current", "pages:presentation.pageNumber", "2").States[0]);
        view.Surfaces[0].States[1].SemanticTree.Nodes.Add(new ProjectedSemanticNode { SemanticNodeId = "page-count", Text = "99" });
        view.States.Add("pages", new SurfaceRuntimeState { StateId = "current" });
        Assert.That(QuestPresenterHudState.ReadPageNumber(view), Is.EqualTo(2));
        view.States["pages"].StateId = "missing";
        Assert.That(QuestPresenterHudState.ReadPageNumber(view), Is.Null);
        Assert.That(QuestPresenterHudState.ReadPageNumber(null), Is.Null);
    }

    [Test]
    public void ConflictingActivePageSemanticsAreUnknownButMatchingNumbersAreAccepted()
    {
        var view = new HudRenderView();
        view.Surfaces.Add(SemanticSurface("first", "current", "presentation.pageNumber", "2"));
        view.Surfaces.Add(SemanticSurface("second", "current", "deck:presentation.pageNumber", "2"));
        view.States.Add("first", new SurfaceRuntimeState { StateId = "current" });
        Assert.That(QuestPresenterHudState.ReadPageNumber(view), Is.EqualTo(2));
        view.States.Add("second", new SurfaceRuntimeState { StateId = "current" });
        Assert.That(QuestPresenterHudState.ReadPageNumber(view), Is.EqualTo(2));
        view.Surfaces[1].States[0].SemanticTree.Nodes[0].Text = "3";
        Assert.That(QuestPresenterHudState.ReadPageNumber(view), Is.Null);
    }

    [Test]
    public void RejectsInvalidExplicitPageSemanticTextAndUnrelatedIds()
    {
        var view = new HudRenderView();
        view.Surfaces.Add(SemanticSurface("pages", "current", "presentation.pageNumber", "1"));
        view.States.Add("pages", new SurfaceRuntimeState { StateId = "current" });
        ProjectedSemanticNode node = view.Surfaces[0].States[0].SemanticTree.Nodes[0];
        foreach (string text in new[] { "", "0", "-1", "1.5", "NaN", "Infinity", "2/3", "2ページ目" })
        {
            node.Text = text;
            Assert.That(QuestPresenterHudState.ReadPageNumber(view), Is.Null, text);
        }
        node.Text = "2";
        node.SemanticNodeId = "notpresentation.pageNumber";
        Assert.That(QuestPresenterHudState.ReadPageNumber(view), Is.Null);
    }

    [Test]
    public void ShowsOnlyAnExplicitPositiveIntegerPageNumber()
    {
        var state = new QuestPresenterHudState();
        state.Refresh("session", 1, false, 10);
        Assert.That(state.PageText, Is.EqualTo("現在ページ: 1ページ目"));
        state.Refresh("session", 12, false, 11);
        Assert.That(state.PageText, Is.EqualTo("現在ページ: 12ページ目"));
        foreach (double? page in new double?[] { null, 0, -1, 1.5, double.NaN, double.PositiveInfinity, double.NegativeInfinity })
        {
            state.Refresh("session", page, false, 12);
            Assert.That(state.PageText, Is.EqualTo("現在ページ: —"));
        }
    }

    [Test]
    public void WallTimeStartsOnFirstRunningAndIncludesPausesAndReconnects()
    {
        var state = new QuestPresenterHudState();
        state.Refresh("session", 1, false, 10);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 00:00"));
        state.Refresh("session", 1, true, 20);
        state.Refresh("session", 2, false, 81.99);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 01:01"));
        state.Refresh("session", null, false, 100);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 01:20"));
        state.Refresh("session", 1, true, 120);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 01:40"));
        state.Refresh("another-session", 1, false, 130);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 00:00"));
        state.Refresh("another-session", 1, true, 140);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 00:00"));
    }

    [Test]
    public void InvalidOrRegressingTimeCannotStartOrRewindTheTimer()
    {
        var state = new QuestPresenterHudState();
        state.Refresh("session", 1, true, double.NaN);
        state.Refresh("session", 1, true, double.PositiveInfinity);
        state.Refresh("session", 1, true, -1);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 00:00"));
        state.Refresh("session", 1, true, 20);
        state.Refresh("session", 1, false, 31);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 00:11"));
        foreach (double now in new[] { 21, -1, double.NaN, double.PositiveInfinity, double.NegativeInfinity })
        {
            state.Refresh("session", 1, false, now);
            Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 00:11"));
        }
        state.Refresh("session", 1, false, 50);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 00:30"));
    }

    [Test]
    public void FormatsDurationsOverAnHourWithoutWrappingTheHour()
    {
        var state = new QuestPresenterHudState();
        state.Refresh("session", 1, true, 10);
        state.Refresh("session", 1, false, 3671);
        Assert.That(state.ElapsedText, Is.EqualTo("経過時間: 01:01:01"));
    }

    private static ProjectedSemanticSurface SemanticSurface(string surfaceId, string stateId, string nodeId, string text)
    {
        return new ProjectedSemanticSurface
        {
            SemanticSurfaceId = surfaceId,
            States = { new SurfaceSemanticState
            {
                StateId = stateId,
                SemanticTree = new ProjectedSemanticTree
                {
                    Nodes = { new ProjectedSemanticNode { SemanticNodeId = nodeId, Text = text } }
                }
            } }
        };
    }

    private sealed class HudRenderView : IPresentationRenderView
    {
        public readonly List<ProjectedSemanticSurface> Surfaces = new List<ProjectedSemanticSurface>();
        public readonly Dictionary<string, SurfaceRuntimeState> States = new Dictionary<string, SurfaceRuntimeState>();
        public ProjectedRuntimeCatalog Catalog => null;
        public IEnumerable<DeliveredRenderSurface> RenderSurfaces => Array.Empty<DeliveredRenderSurface>();
        public IEnumerable<ProjectedSemanticSurface> SemanticSurfaces => Surfaces;
        public Unframe.Presentation.Pose StageOrigin => null;
        public IEnumerable<RuntimeRunSnapshot> ActiveRuns => Array.Empty<RuntimeRunSnapshot>();
        public bool TryGetMediaState(string id, out MediaRuntimeState value) { value = null; return false; }
        public bool TryGetModelClipState(string id, out ModelClipRuntimeState value) { value = null; return false; }
        public bool TryGetSurface(string id, out ProjectedSurfaceDefinition value) { value = null; return false; }
        public bool TryGetNodeState(string id, out NodeRuntimeState value) { value = null; return false; }
        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) => States.TryGetValue(id, out value);
        public bool TryGetAnchorSample(string id, out ProjectedAnchorBindingSample value) { value = null; return false; }
    }
}

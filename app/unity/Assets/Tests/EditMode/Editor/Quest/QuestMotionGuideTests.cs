using NUnit.Framework;
using Unframe.Presentation;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using Vector3 = UnityEngine.Vector3;
using Quaternion = UnityEngine.Quaternion;

public sealed class QuestMotionGuideTests
{
    [Test]
    public void CurrentRecognitionCatalogProducesOnlySupportedTrackedGestures()
    {
        var catalog = new PresenterRecognitionCatalog();
        catalog.Gestures.Add(GestureKind.SwipeLeft);
        catalog.Gestures.Add(GestureKind.SpreadHands);
        catalog.Gestures.Add((GestureKind)999);
        var state = new QuestMotionGuideState();
        var progression = new ProgressionRuntimeState { Stable = new StableProgression() };
        state.Refresh(catalog, progression, true, true, true, true, true, false, false, true);
        Assert.That(state.Candidates, Is.EqualTo(new[] { GestureKind.SwipeLeft }));
        state.Refresh(catalog, progression, true, true, true, true, true, true, false, true);
        Assert.That(state.Candidates, Is.EqualTo(new[] { GestureKind.SwipeLeft, GestureKind.SpreadHands }));
        progression.Transitioning = new TransitioningProgression();
        state.Refresh(catalog, progression, true, true, true, true, true, true, false, true);
        Assert.That(state.Candidates, Is.Empty);
    }

    [TestCase(false, true, true, true, true, true, false)]
    [TestCase(true, false, true, true, true, true, false)]
    [TestCase(true, true, false, true, true, true, false)]
    [TestCase(true, true, true, false, true, true, false)]
    [TestCase(true, true, true, true, false, false, false)]
    [TestCase(true, true, true, true, true, true, true)]
    public void UnsafeOrHiddenStatesClearCandidates(bool presenter, bool calibrated, bool running, bool head, bool left, bool right, bool menu)
    {
        var catalog = new PresenterRecognitionCatalog();
        catalog.Gestures.Add(GestureKind.SwipeLeft);
        var state = new QuestMotionGuideState();
        state.Refresh(catalog, new ProgressionRuntimeState { Stable = new StableProgression() }, presenter, calibrated, running, head, left, right, menu, true);
        Assert.That(state.Candidates, Is.Empty);
    }

    [TestCase(false, true, true, true, "位置合わせ")]
    [TestCase(true, false, true, true, "一時停止")]
    [TestCase(true, true, false, true, "頭")]
    [TestCase(true, true, true, false, "同期")]
    public void UnavailableInputExplainsTheRequiredAction(bool calibrated, bool running, bool head, bool ready, string expected)
    {
        var catalog = new PresenterRecognitionCatalog();
        catalog.Gestures.Add(GestureKind.SwipeLeft);
        var state = new QuestMotionGuideState();
        state.Refresh(catalog, new ProgressionRuntimeState { Stable = new StableProgression() }, true,
            calibrated, running, head, true, true, false, ready);
        Assert.That(state.ShowHint, Is.True);
        Assert.That(state.Title + state.Instruction, Does.Contain(expected));
        Assert.That(state.Candidates, Is.Empty);
    }

    [Test]
    public void TransitionAndMissingHandsExplainTheWait()
    {
        var catalog = new PresenterRecognitionCatalog();
        catalog.Gestures.Add(GestureKind.SpreadHands);
        var state = new QuestMotionGuideState();
        var progression = new ProgressionRuntimeState { Transitioning = new TransitioningProgression() };
        state.Refresh(catalog, progression, true, true, true, true, true, true, false, true);
        Assert.That(state.Title, Does.Contain("切り替え"));
        Assert.That(state.Candidates, Is.Empty);
        progression.Stable = new StableProgression();
        state.Refresh(catalog, progression, true, true, true, true, true, false, false, true);
        Assert.That(state.Title + state.Instruction, Does.Contain("両手"));
        Assert.That(state.Candidates, Is.Empty);
    }

    [Test]
    public void EmptyCatalogDoesNotClaimCompletionAndZonesExplainPositionInput()
    {
        var catalog = new PresenterRecognitionCatalog();
        var state = new QuestMotionGuideState();
        var progression = new ProgressionRuntimeState { Stable = new StableProgression() };
        state.Refresh(catalog, progression, true, true, true, true, true, true, false, true);
        Assert.That(state.ShowHint, Is.True);
        Assert.That(state.Title + state.Instruction, Does.Not.Contain("完了"));
        Assert.That(state.Candidates, Is.Empty);
        catalog.Zones.Add(new PresenterRecognitionZone { ZoneId = "stage", Center = new Unframe.Presentation.Vector3() });
        state.Refresh(catalog, progression, true, true, true, true, true, true, false, true);
        Assert.That(state.Title + state.Instruction, Does.Contain("立ち位置"));
    }

    [Test]
    public void MenuOrAudienceClearsPreviousHint()
    {
        var state = new QuestMotionGuideState();
        var catalog = new PresenterRecognitionCatalog();
        var progression = new ProgressionRuntimeState { Stable = new StableProgression() };
        state.Refresh(catalog, progression, true, true, true, true, true, true, false, true);
        Assert.That(state.ShowHint, Is.True);
        state.Refresh(catalog, progression, true, true, true, true, true, true, true, true);
        Assert.That(state.ShowHint, Is.False);
        Assert.That(state.Title, Is.Empty);
        Assert.That(state.Instruction, Is.Empty);
        state.Refresh(catalog, progression, false, true, true, true, true, true, false, true);
        Assert.That(state.ShowHint, Is.False);
    }

    [TestCase(GestureKind.SwipeLeft, "左", "片手", "18cm")]
    [TestCase(GestureKind.SpreadHands, "広げ", "両手", "25cm")]
    public void DetailedInstructionsExplainMeasurements(GestureKind gesture, string direction, string hands, string distance)
    {
        Assert.That(QuestMotionGuideState.Description(gesture), Does.Contain(direction));
        string brief = QuestMotionGuideState.InstructionFor(gesture, false);
        string detailed = QuestMotionGuideState.InstructionFor(gesture, true);
        Assert.That(brief, Does.Contain(hands));
        Assert.That(brief, Does.Not.Contain("cm"));
        Assert.That(detailed, Does.Contain(distance));
        Assert.That(detailed, Does.Contain("0.8秒"));
        Assert.That(detailed, Does.Contain("0.15秒"));
    }

    [Test]
    public void GuideDirectionUsesFrozenHeadYawAndDistanceIsBoundedForComfort()
    {
        var rotation = Quaternion.Euler(25, 90, 0);
        QuestMotionGuideGeometry.GetFrame(rotation, out Vector3 forward, out Vector3 right);
        Assert.That(Vector3.Dot(forward, Vector3.right), Is.GreaterThan(.999f));
        Assert.That(Vector3.Dot(right, Vector3.back), Is.GreaterThan(.999f));
        Assert.That(QuestMotionGuideGeometry.Direction(5, forward, right, false), Is.EqualTo(forward));
        Assert.That(QuestMotionGuideGeometry.Direction(7, forward, right, true), Is.EqualTo(-right));
        QuestMotionGuideGeometry.Diagram(1, 1, out float start, out float end, out float scale);
        Assert.That(start, Is.EqualTo(0));
        Assert.That(end, Is.EqualTo(1));
        Assert.That(end * scale, Is.EqualTo(.35f).Within(.00001f));
    }

    [Test]
    public void SignificantHeadTurnReframesWhileSmallTrackingChangesDoNot()
    {
        Assert.That(QuestMotionGuideGeometry.NeedsReframe(Vector3.forward, Quaternion.Euler(0, 10, 0) * Vector3.forward), Is.False);
        Assert.That(QuestMotionGuideGeometry.NeedsReframe(Vector3.forward, Vector3.right), Is.True);
    }

    [TestCase(7, .01)]
    [TestCase(7, .3)]
    [TestCase(7, 1.0)]
    [TestCase(8, .01)]
    [TestCase(8, .3)]
    [TestCase(8, 1.0)]
    public void BothHandDiagramShowsSeparationBeforeUniformScaling(int preset, double minimum)
    {
        QuestMotionGuideGeometry.Diagram(preset, minimum, out float startHalf, out float endHalf, out float scale);
        float initial = startHalf * 2;
        float final = endHalf * 2;
        if (preset == 7)
        {
            Assert.That(initial, Is.LessThanOrEqualTo(.5f));
            Assert.That(final, Is.GreaterThanOrEqualTo(.6f));
        }
        else
        {
            Assert.That(initial, Is.GreaterThanOrEqualTo(.6f));
            Assert.That(final, Is.LessThanOrEqualTo(.5f));
        }
        Assert.That(Mathf.Abs(final - initial), Is.GreaterThanOrEqualTo((float)minimum - .00001f));
        Assert.That(Mathf.Abs(endHalf - startHalf), Is.GreaterThanOrEqualTo(.1f));
        Assert.That(Mathf.Max(initial, final) * scale, Is.LessThanOrEqualTo(.70001f));
        Assert.That(scale, Is.GreaterThan(0));
    }

    [Test]
    public void VisualsHaveNoCollidersAndReleaseOwnedMaterialAndMesh()
    {
        var host = new GameObject("Motion guide lifecycle");
        Material material = null;
        Mesh mesh = null;
        try
        {
            var view = host.AddComponent<QuestMotionGuideView>();
            var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
            typeof(QuestMotionGuideView).GetMethod("EnsureVisuals", flags).Invoke(view, null);
            Assert.That(host.GetComponentsInChildren<Collider>(true), Is.Empty);
            var backplate = host.GetComponentInChildren<UnityEngine.UI.Image>(true);
            var instruction = host.GetComponentInChildren<UnityEngine.UI.Text>(true);
            Assert.That(backplate, Is.Not.Null);
            Assert.That(backplate.color.a, Is.GreaterThanOrEqualTo(.9f));
            Assert.That(backplate.raycastTarget, Is.False);
            Assert.That(instruction.raycastTarget, Is.False);
            Assert.That(instruction.gameObject, Is.Not.SameAs(backplate.gameObject));
            Assert.That(instruction.transform.parent, Is.EqualTo(backplate.transform));
            var renderer = host.GetComponentInChildren<MeshRenderer>(true);
            material = renderer.sharedMaterial;
            mesh = renderer.GetComponent<MeshFilter>().sharedMesh;
            Assert.That(material, Is.Not.Null);
            Assert.That(mesh, Is.Not.Null);
            typeof(QuestMotionGuideView).GetMethod("OnDestroy", flags).Invoke(view, null);
        }
        finally { Object.DestroyImmediate(host); }
        Assert.That(material == null, Is.True);
        Assert.That(mesh == null, Is.True);
    }

}

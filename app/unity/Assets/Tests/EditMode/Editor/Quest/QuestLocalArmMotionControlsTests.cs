using System;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;

public sealed class QuestLocalArmMotionControlsTests
{
    private GameObject host;
    private LocalPresentationFixtureRunner runner;
    private QuestLocalPresentationControls controls;
    private QuestLocalArmMotionControls motion;

    [SetUp]
    public void SetUp()
    {
        host = new GameObject("Arm motion controls test");
        var calibration = host.AddComponent<ArucoPresentationCalibration>();
        runner = host.AddComponent<LocalPresentationFixtureRunner>();
        runner.SetDeliveryFixture(Resources.Load<TextAsset>("MotionPresentation/LocalDelivery"));
        runner.SetSnapshotFixture(Resources.Load<TextAsset>("MotionPresentation/LocalSnapshot"));
        runner.SetReliableEventFixtures(Resources.LoadAll<TextAsset>("MotionPresentation/Control")
            .OrderBy(asset => asset.name, StringComparer.Ordinal).ToArray());
        controls = host.AddComponent<QuestLocalPresentationControls>();
        controls.Configure(calibration, runner);
        Assert.That(controls.ResetPresentation(out string error), Is.True, error);
        Assert.That(calibration.Calibration.TrySet(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _), Is.True);
        while (runner.AppliedEventCount < 9)
            Assert.That(controls.TryAdvance(out error), Is.True, error);
        motion = host.AddComponent<QuestLocalArmMotionControls>();
        motion.ConfigurePlan(controls, runner, Resources.Load<TextAsset>("MotionPresentation/LocalMotionPlan"));
    }

    [TearDown]
    public void TearDown() => UnityEngine.Object.DestroyImmediate(host);

    [Test]
    public void DiagnosticsRecordTrackingAndRequireAFreshTriggerAfterBlockedInput()
    {
        controls.PresentationInputEnabled = false;
        Assert.That(motion.ProcessFrame(1, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.SampleCount, Is.EqualTo(1));
        Assert.That(motion.LastFrame.HeadAvailable, Is.True);
        Assert.That(motion.BlockReason, Is.EqualTo("presentation-input-disabled"));
        controls.PresentationInputEnabled = true;
        Assert.That(motion.ProcessFrame(1.1, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.BlockReason, Is.EqualTo("release-trigger"));
        Assert.That(motion.HeldButtons, Is.EqualTo(ArmMotionInputButtons.RightTrigger));
        Assert.That(runner.AppliedEventCount, Is.EqualTo(9));
        Assert.That(motion.ProcessFrame(1.2, Frame(Vector3.zero)), Is.False);
        Assert.That(motion.BlockReason, Is.EqualTo("waiting-trigger"));
    }

    [Test]
    public void DiagnosticsKeepTheLastMatchAndAdvanceError()
    {
        motion.Configure(controls, runner, new[] {
            new ArmMotionCue(10, ArmMotionPreset.SwipeDown, "cue:wrong", "timeline:scene-10")
        });
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(.25, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(.55, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.MatchCount, Is.EqualTo(1));
        Assert.That(motion.LastMatchDiagnostics.Phase, Is.EqualTo(ArmMotionPhase.Matched));
        Assert.That(motion.LastAdvanceError, Does.Contain("does not match"));
        Assert.That(motion.LastResult, Is.EqualTo("advance-rejected"));
    }

    [Test]
    public void UiSceneIncludesMotionCuesAndConnectsThemToItsLocalControls()
    {
        var scene = EditorSceneManager.OpenScene(QuestPresentationUiSceneEditor.ScenePath, OpenSceneMode.Additive);
        try
        {
            var components = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<QuestLocalArmMotionControls>(true));
            var sceneMotion = components.Single();
            var debug = sceneMotion.GetComponent<QuestArmMotionDebugView>();
            Assert.That(debug, Is.Not.Null);
            var debugSettings = new SerializedObject(debug);
            Assert.That(debugSettings.FindProperty("motion").objectReferenceValue, Is.EqualTo(sceneMotion));
            Assert.That(debugSettings.FindProperty("head").objectReferenceValue, Is.Not.Null);
            Assert.That(debugSettings.FindProperty("flow").objectReferenceValue,
                Is.EqualTo(sceneMotion.GetComponent<QuestPresentationUiController>()));
            var settings = new SerializedObject(sceneMotion);
            Assert.That(settings.FindProperty("controls").objectReferenceValue,
                Is.EqualTo(sceneMotion.GetComponent<QuestLocalPresentationControls>()));
            Assert.That(settings.FindProperty("runner").objectReferenceValue,
                Is.EqualTo(sceneMotion.GetComponent<LocalPresentationFixtureRunner>()));
            Assert.That(settings.FindProperty("cues").arraySize, Is.EqualTo(4));
            var sceneRunner = sceneMotion.GetComponent<LocalPresentationFixtureRunner>();
            var runnerSettings = new SerializedObject(sceneRunner);
            Assert.That(runnerSettings.FindProperty("deliveryFixture").objectReferenceValue,
                Is.EqualTo(Resources.Load<TextAsset>("MotionPresentation/LocalDelivery")));
            Assert.That(runnerSettings.FindProperty("snapshotFixture").objectReferenceValue,
                Is.EqualTo(Resources.Load<TextAsset>("MotionPresentation/LocalSnapshot")));
            var eventAssets = runnerSettings.FindProperty("reliableEventFixtures");
            Assert.That(eventAssets.arraySize, Is.EqualTo(25));
            for (int index = 0; index < eventAssets.arraySize; index++)
                Assert.That(AssetDatabase.GetAssetPath(eventAssets.GetArrayElementAtIndex(index).objectReferenceValue),
                    Does.Contain("/Resources/MotionPresentation/Control/"));
        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }

    private static ArmMotionFrame Frame(Vector3 hand) => new ArmMotionFrame(Vector3.zero,
        Quaternion.identity, true, Vector3.zero, true, hand, true);

    [Test]
    public void EachUpcomingEventAcceptsOnlyItsAssignedPreset()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(0.25, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(0.55, Frame(Vector3.up * 0.32f), ArmMotionInputButtons.RightTrigger), Is.False);
        motion.ProcessFrame(.7, Frame(Vector3.zero));
        motion.ProcessFrame(1, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(1.25, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(1.55, Frame(Vector3.down * 0.32f), ArmMotionInputButtons.RightTrigger), Is.True);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(10));
        Assert.That(motion.ProgressionHint, Does.Contain("Next"));
        Assert.That(motion.ProcessFrame(1.6, Frame(Vector3.up * 0.4f)), Is.False);
    }

    [Test]
    public void DisabledPresentationInputDiscardsMotionHistory()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(0.25, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        controls.PresentationInputEnabled = false;
        Assert.That(motion.ProcessFrame(0.55, Frame(Vector3.right * 0.32f), ArmMotionInputButtons.RightTrigger), Is.False);
        controls.PresentationInputEnabled = true;
        Assert.That(motion.ProcessFrame(0.6, Frame(Vector3.right * 0.4f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(9));
    }


    [Test]
    public void UnpressedMotionDoesNotAdvanceAndPressCapturesTheCurrentPosition()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero));
        Assert.That(motion.ProcessFrame(.3, Frame(Vector3.down)), Is.False);
        motion.ProcessFrame(.4, Frame(Vector3.down), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(.7, Frame(Vector3.down * 1.32f), ArmMotionInputButtons.RightTrigger), Is.True);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(10));
    }

    [Test]
    public void OnlyTheHandHoldingTheTriggerCanMatchASingleHandCue()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.LeftTrigger);
        Assert.That(motion.ProcessFrame(.3, Frame(Vector3.down * .32f), ArmMotionInputButtons.LeftTrigger), Is.False);
        Assert.That(motion.MatchCount, Is.Zero);
    }

    [Test]
    public void UiConsumedTriggerCannotBeginAnAttemptUntilReleased()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger, true);
        Assert.That(motion.ProcessFrame(.3, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.MatchCount, Is.Zero);
        motion.ProcessFrame(.4, Frame(Vector3.zero));
        motion.ProcessFrame(.5, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(.8, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.True);
    }

    [Test]
    public void ExpiredAttemptCannotReanchorWhileTheTriggerRemainsHeld()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(.4, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(.8, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(1.21, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(1.5, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.RecognitionDiagnostics.Reason, Is.EqualTo(ArmMotionDiagnosticReason.WindowExpired));
        motion.ProcessFrame(1.6, Frame(Vector3.zero));
        motion.ProcessFrame(1.7, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(2, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.True);
    }

    [Test]
    public void ReleasingTheTriggerCancelsTheCapturedStart()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(.1, Frame(Vector3.down * .1f));
        Assert.That(motion.ProcessFrame(.3, Frame(Vector3.down * .4f)), Is.False);
        motion.ProcessFrame(.4, Frame(Vector3.down * .4f), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(.5, Frame(Vector3.down * .5f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.ProcessFrame(.7, Frame(Vector3.down * .72f), ArmMotionInputButtons.RightTrigger), Is.True);
    }

    [Test]
    public void ChangingTriggerHandsRequiresAllTriggersToBeReleased()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(.1, Frame(Vector3.zero), ArmMotionInputButtons.LeftTrigger | ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(.3, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.BlockReason, Is.EqualTo("release-trigger"));
        Assert.That(motion.MatchCount, Is.Zero);
    }

    [Test]
    public void SuccessfulAttemptNeedsReleaseBeforeTheFollowingCue()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(.3, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.True);
        Assert.That(motion.ProcessFrame(.4, Frame(Vector3.right * .32f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(motion.MatchCount, Is.EqualTo(1));
        while (runner.AppliedEventCount < 14)
            Assert.That(controls.TryAdvance(out string error), Is.True, error);
        Assert.That(motion.ProcessFrame(.45, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger), Is.False);
        motion.ProcessFrame(.5, Frame(Vector3.zero));
        motion.ProcessFrame(.6, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(.9, Frame(Vector3.down * .32f), ArmMotionInputButtons.RightTrigger), Is.True);
    }

    [Test]
    public void DuplicateOrInvalidEventAssignmentsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner, new[] {
            new ArmMotionCue(2, ArmMotionPreset.SwipeRight, "cue:motion-02", "timeline:motion-02"), new ArmMotionCue(2, ArmMotionPreset.SwipeUp, "cue:motion-02", "timeline:motion-02")
        }));
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner,
            new[] { new ArmMotionCue(0, ArmMotionPreset.SwipeRight, "cue:motion-02", "timeline:motion-02") }));
    }
    [Test]
    public void MissingIdentifiersAndInvalidThresholdsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner,
            new[] { new ArmMotionCue(2, ArmMotionPreset.SwipeLeft, "", "timeline:motion-02") }));
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner,
            new[] { new ArmMotionCue(2, ArmMotionPreset.SwipeLeft, "cue:motion-02", "", 0.28f, 1200) }));
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner,
            new[] { new ArmMotionCue(2, ArmMotionPreset.SwipeLeft, "cue:motion-02", "timeline:motion-02", 0f) }));
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner,
            new[] { new ArmMotionCue(2, ArmMotionPreset.SwipeLeft, "cue:motion-02", "timeline:motion-02", 0.28f, 0) }));
    }

    [TestCase("SwipeLeft")]
    [TestCase("unknown")]
    public void PlanRejectsUnknownOrIncorrectlyCasedPreset(string preset)
    {
        var plan = new TextAsset("{\"cues\":[{\"eventNumber\":2,\"preset\":\"" + preset +
            "\",\"cueId\":\"cue:motion-02\",\"timelineId\":\"timeline:motion-02\",\"minimumDistanceMeters\":0.28,\"windowMilliseconds\":1200}]}");
        try { Assert.Throws<ArgumentException>(() => motion.ConfigurePlan(controls, runner, plan)); }
        finally { UnityEngine.Object.DestroyImmediate(plan); }
    }

    [Test]
    public void MotionCannotStartATimelineBelongingToAnotherCue()
    {
        motion.Configure(controls, runner, new[] {
            new ArmMotionCue(10, ArmMotionPreset.SwipeDown, "cue:scene-14", "timeline:scene-14")
        });
        motion.ProcessFrame(0, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        motion.ProcessFrame(0.25, Frame(Vector3.zero), ArmMotionInputButtons.RightTrigger);
        Assert.That(motion.ProcessFrame(0.55, Frame(Vector3.down * 0.32f), ArmMotionInputButtons.RightTrigger), Is.False);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(9));
    }

    [Test]
    public void RehearsalRunsAllScenesAndTheSeparateFocusEvent()
    {
        Assert.That(controls.ResetPresentation(out string error), Is.True, error);
        int matched = 0;
        while (runner.CanAdvance)
        {
            int upcoming = runner.AppliedEventCount + 1;
            if (upcoming != 10 && upcoming != 15 && upcoming != 16 && upcoming != 17)
            {
                Assert.That(controls.TryAdvance(out error), Is.True, error);
                continue;
            }
            double start = upcoming * 2;
            bool spread = upcoming == 17;
            Vector3 left = spread ? Vector3.left * .15f : Vector3.zero;
            Vector3 right = spread ? Vector3.right * .15f : Vector3.zero;
            var initial = new ArmMotionFrame(Vector3.zero, Quaternion.identity, true, left, true, right, true);
            motion.ProcessFrame(start, initial);
            motion.ProcessFrame(start + .01, initial, ArmMotionInputButtons.LeftTrigger);
            Vector3 finalLeft = spread ? Vector3.left * .26f
                : upcoming == 16 ? Vector3.right * .32f : Vector3.down * .32f;
            Vector3 finalRight = spread ? Vector3.right * .26f : Vector3.zero;
            Assert.That(motion.ProcessFrame(start + .4,
                new ArmMotionFrame(Vector3.zero, Quaternion.identity, true, finalLeft, true, finalRight, true),
                ArmMotionInputButtons.LeftTrigger), Is.True, "event " + upcoming);
            matched++;
        }
        Assert.That(matched, Is.EqualTo(4));
        Assert.That(runner.AppliedEventCount, Is.EqualTo(25));
        Assert.That(motion.MatchCount, Is.EqualTo(4));
    }
}

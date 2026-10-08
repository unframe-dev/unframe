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
        controls = host.AddComponent<QuestLocalPresentationControls>();
        controls.Configure(calibration, runner);
        Assert.That(controls.ResetPresentation(out string error), Is.True, error);
        Assert.That(calibration.Calibration.TrySet(QuestPresentationTracking.ToCanonicalPose(Vector3.zero, Quaternion.identity), out _), Is.True);
        motion = host.AddComponent<QuestLocalArmMotionControls>();
        motion.Configure(controls, runner, new[] {
            new ArmMotionCue(2, ArmMotionPreset.SwipeRight),
            new ArmMotionCue(3, ArmMotionPreset.SwipeUp)
        });
    }

    [TearDown]
    public void TearDown() => UnityEngine.Object.DestroyImmediate(host);

    [Test]
    public void UiSceneIncludesMotionCuesAndConnectsThemToItsLocalControls()
    {
        var scene = EditorSceneManager.OpenScene(QuestPresentationUiSceneEditor.ScenePath, OpenSceneMode.Additive);
        try
        {
            var components = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<QuestLocalArmMotionControls>(true));
            var sceneMotion = components.Single();
            var settings = new SerializedObject(sceneMotion);
            Assert.That(settings.FindProperty("controls").objectReferenceValue,
                Is.EqualTo(sceneMotion.GetComponent<QuestLocalPresentationControls>()));
            Assert.That(settings.FindProperty("runner").objectReferenceValue,
                Is.EqualTo(sceneMotion.GetComponent<LocalPresentationFixtureRunner>()));
            Assert.That(settings.FindProperty("cues").arraySize, Is.GreaterThanOrEqualTo(8));
        }
        finally { EditorSceneManager.CloseScene(scene, true); }
    }

    private static ArmMotionFrame Frame(Vector3 hand) => new ArmMotionFrame(Vector3.zero,
        Quaternion.identity, true, Vector3.zero, true, hand, true);

    [Test]
    public void EachUpcomingEventAcceptsOnlyItsAssignedPreset()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero));
        motion.ProcessFrame(0.25, Frame(Vector3.zero));
        Assert.That(motion.ProcessFrame(0.55, Frame(Vector3.up * 0.32f)), Is.False);
        motion.ResetRecognition();
        motion.ProcessFrame(1, Frame(Vector3.zero));
        motion.ProcessFrame(1.25, Frame(Vector3.zero));
        Assert.That(motion.ProcessFrame(1.55, Frame(Vector3.right * 0.32f)), Is.True);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(2));
        Assert.That(motion.ProgressionHint, Does.Contain("up"));
        Assert.That(motion.ProcessFrame(1.6, Frame(Vector3.up * 0.4f)), Is.False);
    }

    [Test]
    public void DisabledPresentationInputDiscardsMotionHistory()
    {
        motion.ProcessFrame(0, Frame(Vector3.zero));
        motion.ProcessFrame(0.25, Frame(Vector3.zero));
        controls.PresentationInputEnabled = false;
        Assert.That(motion.ProcessFrame(0.55, Frame(Vector3.right * 0.32f)), Is.False);
        controls.PresentationInputEnabled = true;
        Assert.That(motion.ProcessFrame(0.6, Frame(Vector3.right * 0.4f)), Is.False);
        Assert.That(runner.AppliedEventCount, Is.EqualTo(1));
    }

    [Test]
    public void DuplicateOrInvalidEventAssignmentsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner, new[] {
            new ArmMotionCue(2, ArmMotionPreset.SwipeRight), new ArmMotionCue(2, ArmMotionPreset.SwipeUp)
        }));
        Assert.Throws<ArgumentException>(() => motion.Configure(controls, runner,
            new[] { new ArmMotionCue(0, ArmMotionPreset.SwipeRight) }));
    }
}

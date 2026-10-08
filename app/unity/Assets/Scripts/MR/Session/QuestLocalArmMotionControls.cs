using System;
using System.Collections.Generic;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.XR;

[Serializable]
public sealed class ArmMotionCue
{
    [Min(1), Tooltip("The local reliable event this gesture advances to.")] public int eventNumber;
    public ArmMotionPreset preset;

    public ArmMotionCue(int eventNumber, ArmMotionPreset preset)
    {
        this.eventNumber = eventNumber;
        this.preset = preset;
    }
}

public sealed class QuestLocalArmMotionControls : MonoBehaviour
{
    [SerializeField] private QuestLocalPresentationControls controls;
    [SerializeField] private LocalPresentationFixtureRunner runner;
    [SerializeField] private ArmMotionCue[] cues = Array.Empty<ArmMotionCue>();
    private readonly ArmMotionRecognizer recognizer = new ArmMotionRecognizer();
    private int currentEvent;

    public string ProgressionHint
    {
        get
        {
            var cue = FindCue();
            return cue == null ? "Use Next or A to continue" : "Gesture: " + Label(cue.preset);
        }
    }

    public void Configure(QuestLocalPresentationControls input, LocalPresentationFixtureRunner presentation,
        ArmMotionCue[] assignments)
    {
        if (input == null || presentation == null || assignments == null)
            throw new ArgumentException("Local controls, fixture runner and motion assignments are required.");
        var events = new HashSet<int>();
        foreach (var cue in assignments)
            if (cue == null || cue.eventNumber < 1 || !events.Add(cue.eventNumber)
                || !Enum.IsDefined(typeof(ArmMotionPreset), cue.preset))
                throw new ArgumentException("Each event must have one valid motion preset.", nameof(assignments));
        controls = input;
        runner = presentation;
        cues = assignments;
        ResetRecognition();
    }

    public bool ProcessFrame(double timestamp, ArmMotionFrame frame)
    {
        var cue = FindCue();
        if (!enabled || !gameObject.activeInHierarchy || controls == null || !controls.CanAdvance || cue == null)
        {
            ResetRecognition();
            return false;
        }
        if (currentEvent != cue.eventNumber || recognizer.SelectedPreset != cue.preset)
        {
            recognizer.Configure(cue.preset);
            currentEvent = cue.eventNumber;
        }
        if (!recognizer.Observe(timestamp, frame)) return false;
        bool advanced = controls.TryAdvance(out _);
        ResetRecognition();
        return advanced;
    }

    public void ResetRecognition()
    {
        currentEvent = 0;
        recognizer.Reset();
    }

    private ArmMotionCue FindCue()
    {
        if (runner == null || !runner.HasLoadedFixture || cues == null) return null;
        int nextEvent = runner.AppliedEventCount + 1;
        ArmMotionCue result = null;
        foreach (var cue in cues)
        {
            if (cue == null || cue.eventNumber != nextEvent) continue;
            if (result != null || !Enum.IsDefined(typeof(ArmMotionPreset), cue.preset)) return null;
            result = cue;
        }
        return result;
    }

    private void Update()
    {
        if (controls == null || !controls.CanAdvance)
        {
            ResetRecognition();
            return;
        }
        if (Pressed(XRNode.LeftHand, CommonUsages.triggerButton) || Pressed(XRNode.RightHand, CommonUsages.triggerButton)
            || Pressed(XRNode.LeftHand, CommonUsages.primaryButton) || Pressed(XRNode.RightHand, CommonUsages.primaryButton)
            || Pressed(XRNode.LeftHand, CommonUsages.secondaryButton) || Pressed(XRNode.RightHand, CommonUsages.secondaryButton))
        {
            ResetRecognition();
            return;
        }
        QuestPresentationTracking.TrySample(XRNode.Head, TrackedTarget.Head, out var head);
        QuestPresentationTracking.TrySample(XRNode.LeftHand, TrackedTarget.LeftHand, out var left);
        QuestPresentationTracking.TrySample(XRNode.RightHand, TrackedTarget.RightHand, out var right);
        ProcessFrame(Time.realtimeSinceStartupAsDouble, new ArmMotionFrame(head.Position, head.Rotation,
            head.Available, left.Position, left.Available, right.Position, right.Available));
    }

    private static bool Pressed(XRNode node, InputFeatureUsage<bool> button)
    {
        var device = InputDevices.GetDeviceAtXRNode(node);
        return device.TryGetFeatureValue(button, out bool pressed) && pressed;
    }

    private static string Label(ArmMotionPreset preset)
    {
        switch (preset)
        {
            case ArmMotionPreset.SwipeLeft: return "Sweep left";
            case ArmMotionPreset.SwipeRight: return "Sweep right";
            case ArmMotionPreset.SwipeDown: return "Sweep down";
            case ArmMotionPreset.SwipeUp: return "Sweep up";
            case ArmMotionPreset.PushForward: return "Push forward";
            case ArmMotionPreset.PullBackward: return "Pull back";
            case ArmMotionPreset.SpreadHands: return "Spread both hands";
            case ArmMotionPreset.CloseHands: return "Bring both hands together";
            default: return "Unavailable";
        }
    }

    private void OnDisable() => ResetRecognition();
    private void OnApplicationPause(bool paused) { if (paused) ResetRecognition(); }
}

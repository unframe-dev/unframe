using System;
using System.Collections.Generic;
using Unframe.Realtime;
using Unframe.Unity.PresentationRuntime;
using UnityEngine;
using UnityEngine.XR;

[Flags]
public enum ArmMotionInputButtons
{
    None = 0, LeftTrigger = 1, RightTrigger = 2, LeftPrimary = 4,
    RightPrimary = 8, LeftSecondary = 16, RightSecondary = 32
}

[Serializable]
public sealed class ArmMotionCue
{
    [Min(1), Tooltip("The local reliable event this gesture advances to.")] public int eventNumber;
    public ArmMotionPreset preset;
    public string cueId;
    public string timelineId;
    public float minimumDistanceMeters;
    public int windowMilliseconds;

    public ArmMotionCue(int eventNumber, ArmMotionPreset preset, string cueId, string timelineId,
        float minimumDistanceMeters = 0.28f, int windowMilliseconds = 1200)
    {
        this.eventNumber = eventNumber;
        this.preset = preset;
        this.cueId = cueId;
        this.timelineId = timelineId;
        this.minimumDistanceMeters = minimumDistanceMeters;
        this.windowMilliseconds = windowMilliseconds;
    }
}

public sealed class QuestLocalArmMotionControls : MonoBehaviour
{
    [SerializeField] private QuestLocalPresentationControls controls;
    [SerializeField] private LocalPresentationFixtureRunner runner;
    [SerializeField] private ArmMotionCue[] cues = Array.Empty<ArmMotionCue>();
    private readonly ArmMotionRecognizer recognizer = new ArmMotionRecognizer();
    private int currentEvent;
    private ArmMotionInputButtons previousTriggers;
    private const ArmMotionInputButtons TriggerMask = ArmMotionInputButtons.LeftTrigger | ArmMotionInputButtons.RightTrigger;
    private bool attemptConsumed;
    public ArmMotionInputButtons ActiveTriggers { get; private set; }
    public bool WaitingForRelease => attemptConsumed && (ActiveTriggers == ArmMotionInputButtons.None
        || RecognitionDiagnostics.Phase == ArmMotionPhase.Failed
        || RecognitionDiagnostics.Phase == ArmMotionPhase.WaitingTracking);

    public int SampleCount { get; private set; }
    public double LastSampleTime { get; private set; }
    public ArmMotionFrame LastFrame { get; private set; }
    public string BlockReason { get; private set; } = "not-sampled";
    public ArmMotionInputButtons HeldButtons { get; private set; }
    public ArmMotionDiagnostics RecognitionDiagnostics { get; private set; }
    public ArmMotionDiagnostics LastMatchDiagnostics { get; private set; }
    public int MatchCount { get; private set; }
    public string LastResult { get; private set; } = "no-match-yet";
    public string LastAdvanceError { get; private set; }
    public string UpcomingCueId => FindCue()?.cueId;
    public ArmMotionPreset? UpcomingPreset => FindCue()?.preset;
    public int UpcomingEvent => runner != null ? runner.AppliedEventCount + 1 : 0;
    public bool UpcomingCueNeedsBothHands => FindCue()?.preset == ArmMotionPreset.SpreadHands
        || FindCue()?.preset == ArmMotionPreset.CloseHands;

    public string ProgressionHint
    {
        get
        {
            var cue = FindCue();
            return cue == null ? "Use Next or A to continue" : "Hold trigger: " + Label(cue.preset);
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
                || !Enum.IsDefined(typeof(ArmMotionPreset), cue.preset)
                || String.IsNullOrWhiteSpace(cue.cueId) || String.IsNullOrWhiteSpace(cue.timelineId)
                || float.IsNaN(cue.minimumDistanceMeters) || float.IsInfinity(cue.minimumDistanceMeters)
                || cue.minimumDistanceMeters <= 0 || cue.windowMilliseconds <= 0)
                throw new ArgumentException("Each event must have one valid motion preset.", nameof(assignments));
        controls = input;
        runner = presentation;
        cues = assignments;
        ResetRecognition();
    }

    [Serializable]
    private sealed class MotionPlan
    {
        public MotionPlanCue[] cues;
    }

    [Serializable]
    private sealed class MotionPlanCue
    {
        public int eventNumber;
        public string preset;
        public string cueId;
        public string timelineId;
        public float minimumDistanceMeters;
        public int windowMilliseconds;
    }

    public void ConfigurePlan(QuestLocalPresentationControls input, LocalPresentationFixtureRunner presentation,
        TextAsset planAsset)
    {
        if (planAsset == null) throw new ArgumentException("A generated local motion plan is required.", nameof(planAsset));
        MotionPlan plan;
        try { plan = JsonUtility.FromJson<MotionPlan>(planAsset.text); }
        catch (Exception error) { throw new ArgumentException("Invalid local motion plan JSON.", nameof(planAsset), error); }
        if (plan == null || plan.cues == null || plan.cues.Length == 0)
            throw new ArgumentException("The local motion plan must contain cues.", nameof(planAsset));
        var assignments = new ArmMotionCue[plan.cues.Length];
        for (int index = 0; index < plan.cues.Length; index++)
        {
            var cue = plan.cues[index];
            if (cue == null) throw new ArgumentException("The local motion plan contains an empty cue.", nameof(planAsset));
            assignments[index] = new ArmMotionCue(cue.eventNumber, ParsePreset(cue.preset), cue.cueId,
                cue.timelineId, cue.minimumDistanceMeters, cue.windowMilliseconds);
        }
        Configure(input, presentation, assignments);
    }

    private static ArmMotionPreset ParsePreset(string value)
    {
        switch (value)
        {
            case "swipeLeft": return ArmMotionPreset.SwipeLeft;
            case "swipeRight": return ArmMotionPreset.SwipeRight;
            case "swipeDown": return ArmMotionPreset.SwipeDown;
            case "swipeUp": return ArmMotionPreset.SwipeUp;
            case "pushForward": return ArmMotionPreset.PushForward;
            case "pullBackward": return ArmMotionPreset.PullBackward;
            case "spreadHands": return ArmMotionPreset.SpreadHands;
            case "closeHands": return ArmMotionPreset.CloseHands;
            default: throw new ArgumentException("Unknown local motion preset: " + value);
        }
    }

    public bool ProcessFrame(double timestamp, ArmMotionFrame frame, ArmMotionInputButtons buttons = ArmMotionInputButtons.None,
        bool uiTriggerConsumed = false)
    {
        SampleCount++;
        LastSampleTime = timestamp;
        LastFrame = frame;
        HeldButtons = buttons;
        var triggers = buttons & TriggerMask;
        bool freshPress = previousTriggers == ArmMotionInputButtons.None && triggers != ArmMotionInputButtons.None;
        previousTriggers = triggers;
        var cue = FindCue();
        BlockReason = !isActiveAndEnabled ? "motion-disabled"
            : controls == null ? "controls-missing"
            : !controls.CanAdvance ? controls.AdvanceBlockReason
            : cue == null ? "motion-cue-missing"
            : uiTriggerConsumed ? "ui-trigger-consumed"
            : (buttons & ~TriggerMask) != 0 ? "buttons-held" : null;
        if (BlockReason != null)
        {
            ResetRecognition();
            attemptConsumed = triggers != ArmMotionInputButtons.None;
            return false;
        }
        if (triggers == ArmMotionInputButtons.None)
        {
            ResetRecognition();
            attemptConsumed = false;
            BlockReason = "waiting-trigger";
            return false;
        }
        if (freshPress && !attemptConsumed)
        {
            recognizer.Configure(cue.preset, cue.minimumDistanceMeters, cue.windowMilliseconds / 1000.0);
            currentEvent = cue.eventNumber;
            ActiveTriggers = triggers;
            attemptConsumed = true;
            recognizer.Start(timestamp, SelectedFrame(frame, cue));
            RecognitionDiagnostics = recognizer.Diagnostics;
            return false;
        }
        if (ActiveTriggers == ArmMotionInputButtons.None)
        {
            attemptConsumed = true;
            BlockReason = "release-trigger";
            return false;
        }
        if (currentEvent != cue.eventNumber || triggers != ActiveTriggers)
        {
            ResetRecognition();
            BlockReason = "release-trigger";
            return false;
        }
        bool matched = recognizer.Observe(timestamp, SelectedFrame(frame, cue));
        RecognitionDiagnostics = recognizer.Diagnostics;
        if (!matched) return false;
        MatchCount++;
        LastMatchDiagnostics = RecognitionDiagnostics;
        bool advanced = controls.TryAdvanceMotion(cue.cueId, cue.timelineId, out string error);
        LastAdvanceError = advanced ? null : error;
        LastResult = advanced ? "timeline-started" : "advance-rejected";
        ActiveTriggers = ArmMotionInputButtons.None;
        return advanced;
    }

    private ArmMotionFrame SelectedFrame(ArmMotionFrame frame, ArmMotionCue cue)
    {
        bool both = cue.preset == ArmMotionPreset.SpreadHands || cue.preset == ArmMotionPreset.CloseHands;
        return new ArmMotionFrame(frame.HeadPosition, frame.HeadRotation, frame.HeadAvailable,
            frame.LeftPosition, frame.LeftAvailable && (both || (ActiveTriggers & ArmMotionInputButtons.LeftTrigger) != 0),
            frame.RightPosition, frame.RightAvailable && (both || (ActiveTriggers & ArmMotionInputButtons.RightTrigger) != 0));
    }

    public void ResetRecognition()
    {
        currentEvent = 0;
        ActiveTriggers = ArmMotionInputButtons.None;
        recognizer.Reset();
        RecognitionDiagnostics = recognizer.Diagnostics;
    }

    private ArmMotionCue FindCue()
    {
        if (runner == null || !runner.HasLoadedFixture || cues == null) return null;
        int nextEvent = runner.AppliedEventCount + 1;
        ArmMotionCue result = null;
        foreach (var cue in cues)
        {
            if (cue == null || cue.eventNumber != nextEvent) continue;
            if (result != null || !Enum.IsDefined(typeof(ArmMotionPreset), cue.preset)
                || String.IsNullOrWhiteSpace(cue.cueId) || String.IsNullOrWhiteSpace(cue.timelineId)
                || float.IsNaN(cue.minimumDistanceMeters) || float.IsInfinity(cue.minimumDistanceMeters)
                || cue.minimumDistanceMeters <= 0 || cue.windowMilliseconds <= 0) return null;
            result = cue;
        }
        return result;
    }

    private void Update()
    {
        QuestPresentationTracking.TrySample(XRNode.Head, TrackedTarget.Head, out var head);
        QuestPresentationTracking.TrySample(XRNode.LeftHand, TrackedTarget.LeftHand, out var left);
        QuestPresentationTracking.TrySample(XRNode.RightHand, TrackedTarget.RightHand, out var right);
        ProcessFrame(Time.realtimeSinceStartupAsDouble, new ArmMotionFrame(head.Position, head.Rotation,
            head.Available, left.Position, left.Available, right.Position, right.Available), ReadButtons(),
            GetComponent<QuestPresentationUiController>()?.MotionTriggerConsumed ?? false);
    }

    private static ArmMotionInputButtons ReadButtons()
    {
        ArmMotionInputButtons buttons = ArmMotionInputButtons.None;
        if (Pressed(XRNode.LeftHand, CommonUsages.triggerButton)) buttons |= ArmMotionInputButtons.LeftTrigger;
        if (Pressed(XRNode.RightHand, CommonUsages.triggerButton)) buttons |= ArmMotionInputButtons.RightTrigger;
        if (Pressed(XRNode.LeftHand, CommonUsages.primaryButton)) buttons |= ArmMotionInputButtons.LeftPrimary;
        if (Pressed(XRNode.RightHand, CommonUsages.primaryButton)) buttons |= ArmMotionInputButtons.RightPrimary;
        if (Pressed(XRNode.LeftHand, CommonUsages.secondaryButton)) buttons |= ArmMotionInputButtons.LeftSecondary;
        if (Pressed(XRNode.RightHand, CommonUsages.secondaryButton)) buttons |= ArmMotionInputButtons.RightSecondary;
        return buttons;
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

    private void OnDisable()
    {
        ResetRecognition();
        BlockReason = "motion-disabled";
    }
    private void OnApplicationPause(bool paused)
    {
        if (!paused) return;
        ResetRecognition();
        BlockReason = "application-paused";
    }
}

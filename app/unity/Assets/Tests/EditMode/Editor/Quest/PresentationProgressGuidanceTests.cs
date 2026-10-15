using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationProgressGuidanceTests
{
    private static PresentationUiState Presenting(PresentationUiRole role = PresentationUiRole.Presenter)
    {
        var flow = new PresentationUiFlow();
        Assert.That(flow.SelectRole(role), Is.True);
        if (role == PresentationUiRole.Presenter)
        {
            Assert.That(flow.ContinueAuthenticationPreview(), Is.True);
            Assert.That(flow.SelectPresentation("rehearsal"), Is.True);
            Assert.That(flow.CreatePreviewRoom(), Is.True);
        }
        else Assert.That(flow.JoinPreviewRoom("ROOM"), Is.True);
        Assert.That(flow.MarkCalibrationComplete(), Is.True);
        Assert.That(flow.EnterPresentation(), Is.True);
        return flow.State;
    }

    [TestCase(ArmMotionPreset.SwipeLeft, "Swipe left")]
    [TestCase(ArmMotionPreset.SwipeRight, "Swipe right")]
    [TestCase(ArmMotionPreset.SwipeDown, "Swipe down")]
    [TestCase(ArmMotionPreset.SwipeUp, "Swipe up")]
    [TestCase(ArmMotionPreset.PushForward, "Push forward")]
    [TestCase(ArmMotionPreset.PullBackward, "Pull back")]
    [TestCase(ArmMotionPreset.SpreadHands, "Spread hands")]
    [TestCase(ArmMotionPreset.CloseHands, "Bring hands together")]
    public void UpcomingMotionNamesTheDirectionAndPreservesItsArrowPreset(ArmMotionPreset preset, string title)
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 9, 25, true, false,
            preset, ArmMotionPhase.WaitingTrigger, false);
        Assert.That(guidance.Title, Is.EqualTo(title));
        Assert.That(guidance.MotionPreset, Is.EqualTo(preset));
        bool bothHands = preset == ArmMotionPreset.SpreadHands || preset == ArmMotionPreset.CloseHands;
        Assert.That(guidance.Instruction, Is.EqualTo(bothHands
            ? "Hold a trigger, move both hands, then release"
            : "Hold trigger, move, then release"));
    }

    [TestCase(ArmMotionPhase.Ready)]
    [TestCase(ArmMotionPhase.Moving)]
    public void ActiveMotionKeepsItsDirectionAndPromptsMovement(ArmMotionPhase phase)
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 14, 25, true, false,
            ArmMotionPreset.SwipeRight, phase, false);
        Assert.That(guidance.Title, Is.EqualTo("Swipe right"));
        Assert.That(guidance.Instruction, Is.EqualTo("Move now, then release"));
        Assert.That(guidance.MotionPreset, Is.EqualTo(ArmMotionPreset.SwipeRight));
    }

    [Test]
    public void TriggerReleaseTakesPriorityOverTheUpcomingMotion()
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 15, 25, true, false,
            ArmMotionPreset.SwipeRight, ArmMotionPhase.Matched, true);
        Assert.That(guidance.Title, Is.EqualTo("Release trigger"));
        Assert.That(guidance.Instruction, Is.EqualTo("Then try the next move"));
        Assert.That(guidance.MotionPreset, Is.Null);
    }

    [Test]
    public void MissingTrackingRequestsControllersInsteadOfMovement()
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 9, 25, true, false,
            ArmMotionPreset.SwipeDown, ArmMotionPhase.WaitingTracking, false);
        Assert.That(guidance.Title, Is.EqualTo("Track your controllers"));
        Assert.That(guidance.MotionPreset, Is.Null);
    }

    [TestCase(0, 25)]
    [TestCase(12, 25)]
    [TestCase(24, 25)]
    public void ManualStepsUseTheActualEventCountWithoutClaimingCompletion(int applied, int total)
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), applied, total, true, false,
            null, ArmMotionPhase.WaitingTrigger, false);
        Assert.That(guidance.Title, Is.EqualTo("Next slide"));
        Assert.That(guidance.Instruction, Is.EqualTo("Press A or Next"));
        Assert.That(guidance.MotionPreset, Is.Null);
    }

    [Test]
    public void UnavailableAdvanceDoesNotPromptAButtonPressOrClaimCompletion()
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 12, 25, false, false,
            null, ArmMotionPhase.WaitingTrigger, false);
        Assert.That(guidance.Title, Is.EqualTo("Waiting"));
        Assert.That(guidance.Instruction, Is.EqualTo("Wait until the presentation is ready"));
        Assert.That(guidance.MotionPreset, Is.Null);
    }

    [Test]
    public void AudienceSeesPresenterOwnershipInsteadOfLocalControls()
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(PresentationUiRole.Audience), 9, 25, false, false,
            ArmMotionPreset.SwipeDown, ArmMotionPhase.Moving, true);
        Assert.That(guidance.Title, Is.EqualTo("Watching"));
        Assert.That(guidance.Instruction, Is.EqualTo("Presenter controls the next step"));
        Assert.That(guidance.MotionPreset, Is.Null);
    }

    [Test]
    public void AnimationTakesPriorityOverTriggerReleaseAndMotion()
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 25, 25, false, true,
            ArmMotionPreset.SwipeDown, ArmMotionPhase.Matched, true);
        Assert.That(guidance.Title, Is.EqualTo("Playing"));
        Assert.That(guidance.Instruction, Is.EqualTo("Wait a moment"));
        Assert.That(guidance.MotionPreset, Is.Null);
    }

    [Test]
    public void CompleteRequiresTheLastEventToFinishAnimating()
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 25, 25, false, false,
            ArmMotionPreset.SwipeDown, ArmMotionPhase.Matched, true);
        Assert.That(guidance.Title, Is.EqualTo("Complete"));
        Assert.That(guidance.Instruction, Is.EqualTo("You reached the end"));
        Assert.That(guidance.MotionPreset, Is.Null);
    }

    [Test]
    public void AnUnloadedFixtureIsWaitingRatherThanComplete()
    {
        var guidance = PresentationProgressGuidance.Create(Presenting(), 0, 0, false, false,
            null, ArmMotionPhase.WaitingTrigger, false);
        Assert.That(guidance.Title, Is.EqualTo("Waiting"));
    }
}

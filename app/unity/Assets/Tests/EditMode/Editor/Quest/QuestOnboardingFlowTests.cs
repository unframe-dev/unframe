using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestOnboardingFlowTests
{
    [Test]
    public void RoleRoutesAndBackKeepAudienceOutOfPresentationSelection()
    {
        var flow = new QuestOnboardingFlow();
        flow.SelectRole(QuestOnboardingRole.Audience);
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.RoomCode));
        flow.GoTo(QuestOnboardingPage.Authentication);
        flow.Back();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.RoomCode));
        flow.DebugNext();
        Assert.That(flow.IsDebugPreview, Is.False);
    }

    [Test]
    public void PresenterDebugTraversalIsExplicitlyAPreviewAndResetClearsIt()
    {
        var flow = new QuestOnboardingFlow();
        flow.SelectRole(QuestOnboardingRole.Presenter);
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Authentication));
        for (int i = 0; i < 4; i++) flow.DebugNext();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Ready));
        Assert.That(flow.IsDebugPreview, Is.True);
        flow.Reset();
        Assert.That(flow.Page, Is.EqualTo(QuestOnboardingPage.Role));
        Assert.That(flow.IsDebugPreview, Is.False);
    }
}

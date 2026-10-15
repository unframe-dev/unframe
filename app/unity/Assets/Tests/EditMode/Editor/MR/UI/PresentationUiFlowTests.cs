using NUnit.Framework;
using Unframe.Unity.PresentationRuntime;

public sealed class PresentationUiFlowTests
{
    [Test]
    public void AudienceJoinsPreviewThenCalibratesWithoutPresenterControls()
    {
        var flow = new PresentationUiFlow();
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.RoleSelection));
        Assert.That(flow.SelectRole(PresentationUiRole.Audience), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.RoomCode));
        Assert.That(flow.JoinPreviewRoom(" abc123 "), Is.True);
        Assert.That(flow.State.RoomCode, Is.EqualTo("abc123"));
        Assert.That(flow.State.IsPreview, Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Calibration));
        Assert.That(flow.MarkCalibrationComplete(), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Calibration));
        Assert.That(flow.State.CalibrationComplete, Is.True);
        Assert.That(flow.EnterPresentation(), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Presenting));
        Assert.That(flow.State.CanControlPresentation, Is.False);
    }

    [TestCase("")]
    [TestCase("   ")]
    [TestCase("a-b")]
    [TestCase("日本語")]
    public void InvalidPreviewCodeDoesNotJoin(string code)
    {
        var flow = new PresentationUiFlow();
        flow.SelectRole(PresentationUiRole.Audience);
        Assert.That(flow.JoinPreviewRoom(code), Is.False);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.RoomCode));
    }

    [Test]
    public void PresenterMustSelectPresentationBeforeCreatingPreviewRoom()
    {
        var flow = new PresentationUiFlow();
        flow.SelectRole(PresentationUiRole.Presenter);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.AuthenticationPreview));
        Assert.That(flow.CreatePreviewRoom(), Is.False);
        Assert.That(flow.ContinueAuthenticationPreview(), Is.True);
        Assert.That(flow.CreatePreviewRoom(), Is.False);
        Assert.That(flow.SelectPresentation("sample"), Is.True);
        Assert.That(flow.CreatePreviewRoom(), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Calibration));
        Assert.That(flow.State.IsPreview, Is.True);
        Assert.That(flow.State.CanControlPresentation, Is.False);
        flow.MarkCalibrationComplete();
        flow.EnterPresentation();
        Assert.That(flow.State.CanControlPresentation, Is.True);
    }

    [Test]
    public void CalibrationLossPreservesRoleAndSelectedPresentation()
    {
        var flow = Presenter();
        flow.MarkCalibrationComplete();
        flow.EnterPresentation();
        flow.MarkCalibrationLost();
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Calibration));
        Assert.That(flow.State.Role, Is.EqualTo(PresentationUiRole.Presenter));
        Assert.That(flow.State.PresentationId, Is.EqualTo("sample"));
        Assert.That(flow.State.CanControlPresentation, Is.False);
    }

    [TestCase(PresentationUiRole.Audience, PresentationUiPage.RoomCode)]
    [TestCase(PresentationUiRole.Presenter, PresentationUiPage.RoomSetup)]
    public void BackFromCalibrationReturnsToRoleSetup(PresentationUiRole role, PresentationUiPage page)
    {
        var flow = new PresentationUiFlow();
        flow.SelectRole(role);
        if (role == PresentationUiRole.Audience)
            flow.JoinPreviewRoom("room1");
        else
        {
            flow.ContinueAuthenticationPreview();
            flow.SelectPresentation("sample");
            flow.CreatePreviewRoom();
        }
        Assert.That(flow.Back(), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(page));
    }

    [Test]
    public void BackThroughPresenterSetupReturnsToRoleSelectionAndClearsSelection()
    {
        var flow = Presenter();
        flow.Back();
        flow.Back();
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.AuthenticationPreview));
        flow.Back();
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.RoleSelection));
        Assert.That(flow.State.Role, Is.EqualTo(PresentationUiRole.None));
        Assert.That(flow.State.PresentationId, Is.Empty);
    }

    [Test]
    public void ExitCancelRestoresPreviousPageAndConfirmClearsEphemeralSelection()
    {
        var flow = Presenter();
        flow.MarkCalibrationComplete();
        flow.EnterPresentation();
        Assert.That(flow.RequestExit(), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.ExitConfirmation));
        Assert.That(flow.State.CanControlPresentation, Is.False);
        Assert.That(flow.CancelExit(), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Presenting));
        flow.RequestExit();
        Assert.That(flow.ConfirmExit(), Is.True);
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.RoleSelection));
        Assert.That(flow.State.Role, Is.EqualTo(PresentationUiRole.None));
        Assert.That(flow.State.RoomCode, Is.Empty);
        Assert.That(flow.State.PresentationId, Is.Empty);
    }

    [Test]
    public void CalibrationLossDuringExitCannotRestoreInvalidPresentation()
    {
        var flow = Presenter();
        flow.MarkCalibrationComplete();
        flow.EnterPresentation();
        flow.RequestExit();
        flow.MarkCalibrationLost();
        flow.CancelExit();
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Calibration));
    }

    [Test]
    public void OutOfOrderActionsDoNotChangeState()
    {
        var flow = new PresentationUiFlow();
        var initial = flow.State;
        Assert.That(flow.JoinPreviewRoom("room"), Is.False);
        Assert.That(flow.ContinueAuthenticationPreview(), Is.False);
        Assert.That(flow.SelectPresentation("sample"), Is.False);
        Assert.That(flow.CreatePreviewRoom(), Is.False);
        Assert.That(flow.MarkCalibrationComplete(), Is.False);
        Assert.That(flow.EnterPresentation(), Is.False);
        Assert.That(flow.MarkCalibrationLost(), Is.False);
        Assert.That(flow.CancelExit(), Is.False);
        Assert.That(flow.ConfirmExit(), Is.False);
        Assert.That(flow.Back(), Is.False);
        Assert.That(flow.State, Is.SameAs(initial));
    }

    [Test]
    public void PresentationRequiresExplicitStartAfterCalibration()
    {
        var flow = Presenter();
        Assert.That(flow.EnterPresentation(), Is.False);
        flow.MarkCalibrationComplete();
        Assert.That(flow.State.Page, Is.EqualTo(PresentationUiPage.Calibration));
        Assert.That(flow.EnterPresentation(), Is.True);
    }

    [Test]
    public void PriorStateSnapshotIsNotMutatedByTransition()
    {
        var flow = new PresentationUiFlow();
        var initial = flow.State;
        flow.SelectRole(PresentationUiRole.Audience);
        Assert.That(initial.Role, Is.EqualTo(PresentationUiRole.None));
        Assert.That(initial.Page, Is.EqualTo(PresentationUiPage.RoleSelection));
    }

    private static PresentationUiFlow Presenter()
    {
        var flow = new PresentationUiFlow();
        flow.SelectRole(PresentationUiRole.Presenter);
        flow.ContinueAuthenticationPreview();
        flow.SelectPresentation("sample");
        flow.CreatePreviewRoom();
        return flow;
    }
}

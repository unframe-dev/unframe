using NUnit.Framework;

public sealed class AprilTagCameraSessionStateTests
{
    private static AprilTagCameraSessionState Ready() => new AprilTagCameraSessionState
    {
        Active = true,
        Supported = true,
        PermissionGranted = true,
        TrackingAvailable = true
    };

    [Test]
    public void StartsOnlyWhenEveryRequiredStateAllowsAcquisition()
    {
        for (int flags = 0; flags < 64; flags++)
        {
            var state = new AprilTagCameraSessionState
            {
                Active = (flags & 1) != 0,
                Supported = (flags & 2) != 0,
                PermissionGranted = (flags & 4) != 0,
                Paused = (flags & 8) != 0,
                TrackingAvailable = (flags & 16) != 0,
                AlignmentConfirmed = (flags & 32) != 0
            };
            Assert.That(state.ShouldRunCamera, Is.EqualTo(flags == 23), "Flags: " + flags);
        }
    }

    [Test]
    public void GrantAfterDisableCannotRestartUntilEnabledAgain()
    {
        var state = Ready();
        state.PermissionGranted = false;
        state.Active = false;
        state.PermissionGranted = true;
        Assert.That(state.GetAction(false), Is.EqualTo(AprilTagCameraAction.None));
        Assert.That(state.CanRequestPermission, Is.False);
        Assert.That(state.CanStartAlignment, Is.False);
        state.Active = true;
        Assert.That(state.GetAction(false), Is.EqualTo(AprilTagCameraAction.Start));
    }

    [Test]
    public void PauseDefersResetAndDisableUntilTheSdkHasResumed()
    {
        var state = Ready();
        state.Paused = true;
        state.TrackingAvailable = false;
        Assert.That(state.GetAction(true, true), Is.EqualTo(AprilTagCameraAction.Defer));
        state.Active = false;
        Assert.That(state.GetAction(true), Is.EqualTo(AprilTagCameraAction.Defer));
        state.Paused = false;
        Assert.That(state.GetAction(true), Is.EqualTo(AprilTagCameraAction.Stop));
        Assert.That(state.GetAction(false), Is.EqualTo(AprilTagCameraAction.None));
    }

    [Test]
    public void TrackingLossAndConfirmationStopButExplicitRealignmentCanRestart()
    {
        var state = Ready();
        Assert.That(state.GetAction(true), Is.EqualTo(AprilTagCameraAction.None));
        state.TrackingAvailable = false;
        Assert.That(state.GetAction(true), Is.EqualTo(AprilTagCameraAction.Stop));
        state.TrackingAvailable = true;
        state.AlignmentConfirmed = true;
        Assert.That(state.GetAction(true), Is.EqualTo(AprilTagCameraAction.Stop));
        Assert.That(state.CanStartAlignment, Is.True);
        state.AlignmentConfirmed = false;
        Assert.That(state.GetAction(false), Is.EqualTo(AprilTagCameraAction.Start));
        Assert.That(state.GetAction(true, true), Is.EqualTo(AprilTagCameraAction.Start));
    }
}

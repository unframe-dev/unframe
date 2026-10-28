using System;
using System.Threading;
using System.Threading.Tasks;

namespace Unframe.Unity.PresentationRuntime
{
    public enum QuestOnboardingRole { None, Presenter, Audience }
    public enum QuestOnboardingPage { Role, Authentication, RoomCode, Presentations, Preparation, Join, Calibration, Ready }

    public static class QuestOnboardingStart
    {
        public static bool CanAdvance(QuestOnboardingRole role, bool calibrated, bool controlReady, bool sessionReady) =>
            calibrated && (role == QuestOnboardingRole.Presenter ? controlReady : sessionReady);

        public static async Task BeginPresenterAsync(Func<Task> start, Func<bool> sessionReady,
            Func<bool> controlReady, Func<bool> connectionFailed, Func<string> playbackStatus,
            Func<Task> resume, TimeSpan timeout, CancellationToken token)
        {
            if (timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));
            token.ThrowIfCancellationRequested();
            var elapsed = System.Diagnostics.Stopwatch.StartNew();
            await start();
            bool resumeRequested = false;
            while (true)
            {
                token.ThrowIfCancellationRequested();
                if (connectionFailed() || elapsed.Elapsed >= timeout)
                    throw new InvalidOperationException("presentation-not-ready");
                if (!resumeRequested && controlReady() && playbackStatus() == "Paused")
                {
                    await resume();
                    resumeRequested = true;
                }
                if (sessionReady() && playbackStatus() == "Running") break;
                await Task.Delay(100, token);
            }
            token.ThrowIfCancellationRequested();
        }
    }

    public sealed class QuestOnboardingFlow
    {
        public QuestOnboardingRole Role { get; private set; }
        public QuestOnboardingPage Page { get; private set; }
        public bool IsDebugPreview { get; private set; }
        public bool IsReturningToRoom { get; private set; }
        public void RequireAuthentication() { IsReturningToRoom = true; Page = QuestOnboardingPage.Authentication; }
        public void ConnectionReady() { IsReturningToRoom = false; Page = QuestOnboardingPage.Calibration; }
        public void SelectRole(QuestOnboardingRole role)
        {
            IsDebugPreview = false; IsReturningToRoom = false;
            Role = role;
            Page = role == QuestOnboardingRole.Presenter ? QuestOnboardingPage.Authentication : QuestOnboardingPage.RoomCode;
        }
        public void GoTo(QuestOnboardingPage page) => Page = page;
        public void Reset() { Role = QuestOnboardingRole.None; Page = QuestOnboardingPage.Role; IsDebugPreview = false; IsReturningToRoom = false; }
        public void DebugNext()
        {
            if (Role != QuestOnboardingRole.Presenter) return;
            IsDebugPreview = true;
            switch (Page)
            {
                case QuestOnboardingPage.Authentication: Page = QuestOnboardingPage.Presentations; break;
                case QuestOnboardingPage.Presentations: Page = QuestOnboardingPage.Preparation; break;
                case QuestOnboardingPage.Preparation: Page = QuestOnboardingPage.Calibration; break;
                case QuestOnboardingPage.Calibration: Page = QuestOnboardingPage.Ready; break;
            }
        }
        public void Back()
        {
            if (IsReturningToRoom) { Reset(); return; }
            switch (Page)
            {
                case QuestOnboardingPage.Authentication: Page = Role == QuestOnboardingRole.Audience ? QuestOnboardingPage.RoomCode : QuestOnboardingPage.Role; break;
                case QuestOnboardingPage.RoomCode: Page = QuestOnboardingPage.Role; break;
                case QuestOnboardingPage.Presentations: Page = QuestOnboardingPage.Authentication; break;
                case QuestOnboardingPage.Preparation: Page = QuestOnboardingPage.Presentations; break;
                case QuestOnboardingPage.Join: Page = QuestOnboardingPage.RoomCode; break;
                case QuestOnboardingPage.Calibration: Page = Role == QuestOnboardingRole.Presenter ? QuestOnboardingPage.Preparation : QuestOnboardingPage.Join; break;
                case QuestOnboardingPage.Ready: Page = QuestOnboardingPage.Calibration; break;
            }
            if (Page == QuestOnboardingPage.Role) Reset();
        }
    }
}

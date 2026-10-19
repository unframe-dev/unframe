namespace Unframe.Unity.PresentationRuntime
{
    public enum QuestOnboardingRole { None, Presenter, Audience }
    public enum QuestOnboardingPage { Role, Authentication, RoomCode, Presentations, Preparation, Join, Calibration, Ready }

    public sealed class QuestOnboardingFlow
    {
        public QuestOnboardingRole Role { get; private set; }
        public QuestOnboardingPage Page { get; private set; }
        public bool IsDebugPreview { get; private set; }
        public void SelectRole(QuestOnboardingRole role)
        {
            IsDebugPreview = false;
            Role = role;
            Page = role == QuestOnboardingRole.Presenter ? QuestOnboardingPage.Authentication : QuestOnboardingPage.RoomCode;
        }
        public void GoTo(QuestOnboardingPage page) => Page = page;
        public void Reset() { Role = QuestOnboardingRole.None; Page = QuestOnboardingPage.Role; IsDebugPreview = false; }
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

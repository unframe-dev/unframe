namespace Unframe.Unity.PresentationRuntime
{
    public enum PresentationUiPage
    {
        RoleSelection,
        RoomCode,
        AuthenticationPreview,
        RoomSetup,
        Calibration,
        Presenting,
        ExitConfirmation
    }

    public enum PresentationUiRole
    {
        None,
        Audience,
        Presenter
    }

    public sealed class PresentationUiState
    {
        public PresentationUiPage Page { get; }
        public PresentationUiRole Role { get; }
        public string RoomCode { get; }
        public string PresentationId { get; }
        public bool CalibrationComplete { get; }
        public bool IsPreview => true;
        public bool CanControlPresentation => Page == PresentationUiPage.Presenting
            && Role == PresentationUiRole.Presenter && CalibrationComplete;
        internal PresentationUiPage ExitReturnPage { get; }

        internal PresentationUiState(PresentationUiPage page, PresentationUiRole role,
            string roomCode = "", string presentationId = "", bool calibrationComplete = false,
            PresentationUiPage exitReturnPage = PresentationUiPage.RoleSelection)
        {
            Page = page;
            Role = role;
            RoomCode = roomCode;
            PresentationId = presentationId;
            CalibrationComplete = calibrationComplete;
            ExitReturnPage = exitReturnPage;
        }
    }

    public sealed class PresentationUiFlow
    {
        public PresentationUiState State { get; private set; } = InitialState();

        public bool SelectRole(PresentationUiRole role)
        {
            if (State.Page != PresentationUiPage.RoleSelection
                || (role != PresentationUiRole.Audience && role != PresentationUiRole.Presenter))
                return false;
            State = new PresentationUiState(role == PresentationUiRole.Audience
                ? PresentationUiPage.RoomCode : PresentationUiPage.AuthenticationPreview, role);
            return true;
        }

        public bool JoinPreviewRoom(string code)
        {
            if (State.Page != PresentationUiPage.RoomCode || string.IsNullOrWhiteSpace(code))
                return false;
            code = code.Trim();
            foreach (char character in code)
                if (!((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')))
                    return false;
            State = new PresentationUiState(PresentationUiPage.Calibration, State.Role, code);
            return true;
        }

        public bool ContinueAuthenticationPreview()
        {
            if (State.Page != PresentationUiPage.AuthenticationPreview)
                return false;
            State = new PresentationUiState(PresentationUiPage.RoomSetup, State.Role);
            return true;
        }

        public bool SelectPresentation(string id)
        {
            if (State.Page != PresentationUiPage.RoomSetup || string.IsNullOrWhiteSpace(id))
                return false;
            State = new PresentationUiState(State.Page, State.Role, presentationId: id.Trim());
            return true;
        }

        public bool CreatePreviewRoom()
        {
            if (State.Page != PresentationUiPage.RoomSetup || string.IsNullOrEmpty(State.PresentationId))
                return false;
            State = new PresentationUiState(PresentationUiPage.Calibration, State.Role,
                presentationId: State.PresentationId);
            return true;
        }

        public bool MarkCalibrationComplete()
        {
            if (State.Page != PresentationUiPage.Calibration)
                return false;
            State = new PresentationUiState(State.Page, State.Role, State.RoomCode,
                State.PresentationId, true);
            return true;
        }

        public bool EnterPresentation()
        {
            if (State.Page != PresentationUiPage.Calibration || !State.CalibrationComplete)
                return false;
            State = new PresentationUiState(PresentationUiPage.Presenting, State.Role, State.RoomCode,
                State.PresentationId, true);
            return true;
        }

        public bool MarkCalibrationLost()
        {
            if (State.Page == PresentationUiPage.ExitConfirmation)
            {
                State = new PresentationUiState(State.Page, State.Role, State.RoomCode,
                    State.PresentationId, exitReturnPage: PresentationUiPage.Calibration);
                return true;
            }
            if (State.Page != PresentationUiPage.Calibration && State.Page != PresentationUiPage.Presenting)
                return false;
            State = new PresentationUiState(PresentationUiPage.Calibration, State.Role,
                State.RoomCode, State.PresentationId);
            return true;
        }

        public bool Back()
        {
            switch (State.Page)
            {
                case PresentationUiPage.RoomCode:
                case PresentationUiPage.AuthenticationPreview:
                    State = InitialState();
                    return true;
                case PresentationUiPage.RoomSetup:
                    State = new PresentationUiState(PresentationUiPage.AuthenticationPreview, State.Role);
                    return true;
                case PresentationUiPage.Calibration:
                    State = new PresentationUiState(State.Role == PresentationUiRole.Audience
                        ? PresentationUiPage.RoomCode : PresentationUiPage.RoomSetup, State.Role,
                        State.RoomCode, State.PresentationId);
                    return true;
                default:
                    return false;
            }
        }

        public bool RequestExit()
        {
            if (State.Page != PresentationUiPage.Calibration && State.Page != PresentationUiPage.Presenting)
                return false;
            State = new PresentationUiState(PresentationUiPage.ExitConfirmation, State.Role,
                State.RoomCode, State.PresentationId, State.CalibrationComplete, State.Page);
            return true;
        }

        public bool CancelExit()
        {
            if (State.Page != PresentationUiPage.ExitConfirmation)
                return false;
            State = new PresentationUiState(State.ExitReturnPage, State.Role, State.RoomCode,
                State.PresentationId, State.CalibrationComplete);
            return true;
        }

        public bool ConfirmExit()
        {
            if (State.Page != PresentationUiPage.ExitConfirmation)
                return false;
            State = InitialState();
            return true;
        }

        private static PresentationUiState InitialState() => new PresentationUiState(
            PresentationUiPage.RoleSelection, PresentationUiRole.None);
    }
}

namespace Unframe.Unity.PresentationRuntime
{
    public readonly struct QuestPresentationUiState
    {
        private readonly bool canControl;
        private readonly string playback;
        public QuestPresentationUiState(bool audience, bool presenter, bool ready, string playbackStatus)
        {
            canControl = !audience && presenter && ready;
            playback = playbackStatus;
        }
        public bool CanStart => canControl && playback == "Paused";
        public bool CanResume => CanStart;
        public bool CanPause => canControl && playback == "Running";
        public bool CanEnd => canControl && (playback == "Running" || playback == "Paused");
    }
}

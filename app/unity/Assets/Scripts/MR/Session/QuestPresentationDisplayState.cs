using System;
using System.Collections.Generic;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestPresentationDisplayState
    {
        public bool Audience { get; set; }
        public bool Presenter { get; set; }
        public bool IsRunning { get; set; }
        public PresentationConnectionStage Stage { get; set; } = PresentationConnectionStage.NotConfigured;
        public string PlaybackStatus { get; set; } = "Unknown";
        public bool AssetsReady { get; set; }
        public bool ControlReady { get; set; }
        public bool SessionReady { get; set; }
        public bool Calibrated { get; set; }
        public bool NeedsCameraPermission { get; set; }
        public bool Busy { get; set; }
        public bool CanControlPresentation { get; set; }
        public bool CanControl { get; set; }
        public bool CanAdvance { get; set; }
        public bool HasConnectionSettings { get; set; }
        public string Error { get; set; }
        public string DetailCode { get; set; }
        public string RoomCode { get; set; }
        public IReadOnlyList<StepSelection> ReachedSteps { get; set; } = Array.Empty<StepSelection>();
    }
}

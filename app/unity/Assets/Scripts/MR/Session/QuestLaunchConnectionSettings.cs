using System;

public sealed class QuestLaunchConnectionSettings
{
    public Uri Origin { get; }
    public string SessionId { get; }
    public string Credential { get; }
    public string AdvanceLogicalEventName { get; }

    private QuestLaunchConnectionSettings(Uri origin, string sessionId, string credential, string advanceLogicalEventName)
    {
        Origin = origin;
        SessionId = sessionId;
        Credential = credential;
        AdvanceLogicalEventName = advanceLogicalEventName;
    }

    public static bool TryRead(bool isDevelopmentBuild, Func<string, string> takeExtra, out QuestLaunchConnectionSettings settings)
    {
        settings = null;
        if (!isDevelopmentBuild) return false;
        if (takeExtra == null) throw new ArgumentNullException(nameof(takeExtra));
        string origin = takeExtra("unframe.controlPlaneOrigin");
        string sessionId = takeExtra("unframe.sessionId");
        string credential = takeExtra("unframe.credential");
        string logicalEvent = takeExtra("unframe.advanceLogicalEvent");
        if (!Uri.TryCreate(origin, UriKind.Absolute, out Uri endpoint) || endpoint.Scheme != "https"
            || endpoint.AbsolutePath != "/" || !String.IsNullOrEmpty(endpoint.UserInfo)
            || !String.IsNullOrEmpty(endpoint.Query) || !String.IsNullOrEmpty(endpoint.Fragment)
            || String.IsNullOrWhiteSpace(sessionId) || String.IsNullOrWhiteSpace(credential)) return false;
        settings = new QuestLaunchConnectionSettings(endpoint, sessionId, credential, logicalEvent);
        return true;
    }
}

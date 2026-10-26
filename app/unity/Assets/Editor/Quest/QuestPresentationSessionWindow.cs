using System;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

public sealed class QuestPresentationSessionWindow : EditorWindow
{
    [NonSerialized] private QuestPresentationSession session;
    [NonSerialized] private string origin = String.Empty;
    [NonSerialized] private string sessionId = String.Empty;
    [NonSerialized] private string credential = String.Empty;
    [NonSerialized] private string logicalEventName = String.Empty;
    [NonSerialized] private string error = String.Empty;
    [NonSerialized] private bool connecting;

    [MenuItem("Unframe/Presentation/Connect to Session")]
    public static void Open() => GetWindow<QuestPresentationSessionWindow>("Connect to Session");

    private void OnGUI()
    {
        EditorGUILayout.HelpBox("Use a joined Session and its supplied credential. Enter Play Mode in the Quest presentation scene before connecting.", MessageType.Info);
        session = (QuestPresentationSession)EditorGUILayout.ObjectField("Session", session, typeof(QuestPresentationSession), true);
        origin = EditorGUILayout.TextField("HTTPS origin", origin);
        sessionId = EditorGUILayout.TextField("Session ID", sessionId);
        credential = EditorGUILayout.PasswordField("Credential", credential);
        logicalEventName = EditorGUILayout.TextField("Advance logical event", logicalEventName);
        using (new EditorGUI.DisabledScope(!EditorApplication.isPlaying || connecting || String.IsNullOrWhiteSpace(credential)))
            if (GUILayout.Button("Connect")) Connect();
        if (!String.IsNullOrEmpty(error)) EditorGUILayout.HelpBox(error, MessageType.Error);
    }

    private async void Connect()
    {
        error = String.Empty;
        connecting = true;
        string suppliedCredential = credential;
        credential = String.Empty;
        try
        {
            if (session == null) session = FindFirstObjectByType<QuestPresentationSession>();
            if (session == null) { error = "No active presentation session found."; return; }
            session.ConfigureConnection(new Uri(origin), sessionId, _ => Task.FromResult(suppliedCredential), logicalEventName);
            await session.ConnectAsync();
            if (this != null) error = session.LastErrorCode;
        }
        catch (Exception) { if (this != null) error = "Connection settings are invalid or the session is unavailable."; }
        finally { connecting = false; if (this != null) Repaint(); }
    }

    private void OnDisable() { credential = String.Empty; }
}

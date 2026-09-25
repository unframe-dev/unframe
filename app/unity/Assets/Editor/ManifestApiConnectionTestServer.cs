using System;
using System.Net;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEngine;

[InitializeOnLoad]
public static class ManifestApiConnectionTestServer
{
    public const string PresentationId = "10000000-0000-4000-8000-000000000001";
    public const string BaseUrl = "http://127.0.0.1:18080";

    private const string ManifestJson =
        "{"
        + "\"presentationId\":\"10000000-0000-4000-8000-000000000001\","
        + "\"title\":\"Unity API connection test\","
        + "\"slides\":[{"
        + "\"id\":\"20000000-0000-4000-8000-000000000001\","
        + "\"orderIndex\":0,"
        + "\"elements\":["
        + "{\"type\":\"text\","
        + "\"id\":\"30000000-0000-4000-8000-000000000001\","
        + "\"transform\":{"
        + "\"position\":{\"x\":-0.45,\"y\":1.45,\"z\":2.0},"
        + "\"rotation\":{\"x\":0,\"y\":180,\"z\":0},"
        + "\"scale\":{\"x\":1,\"y\":1,\"z\":1}},"
        + "\"text\":\"API CONNECTION OK\"},"
        + "{\"type\":\"shape\","
        + "\"id\":\"30000000-0000-4000-8000-000000000002\","
        + "\"transform\":{"
        + "\"position\":{\"x\":0.45,\"y\":1.35,\"z\":2.0},"
        + "\"rotation\":{\"x\":0,\"y\":180,\"z\":0},"
        + "\"scale\":{\"x\":0.35,\"y\":0.35,\"z\":0.05}},"
        + "\"shape\":\"rectangle\","
        + "\"fillColor\":\"#28C76F\","
        + "\"strokeColor\":\"#FFFFFF\","
        + "\"strokeWidth\":0.01}"
        + "]}],"
        + "\"updatedAt\":\"2026-08-14T00:00:00Z\""
        + "}";

    private static readonly object Gate = new object();
    private static HttpListener listener;
    private static Thread listenerThread;

    static ManifestApiConnectionTestServer()
    {
        EditorApplication.playModeStateChanged += HandlePlayModeStateChanged;
        EditorApplication.quitting += Stop;
        AssemblyReloadEvents.beforeAssemblyReload += Stop;

        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            Start();
        }
    }

    public static bool TryGetManifest(string absolutePath, out string responseBody)
    {
        string expectedPath = $"/presentations/{PresentationId}/manifest";
        if (string.Equals(absolutePath, expectedPath, StringComparison.Ordinal))
        {
            responseBody = ManifestJson;
            return true;
        }

        responseBody = null;
        return false;
    }

    private static void HandlePlayModeStateChanged(PlayModeStateChange state)
    {
        if ((state == PlayModeStateChange.ExitingEditMode && IsDomainReloadDisabled()) ||
            state == PlayModeStateChange.EnteredPlayMode)
        {
            Start();
            return;
        }

        if (state == PlayModeStateChange.ExitingPlayMode ||
            state == PlayModeStateChange.EnteredEditMode)
        {
            Stop();
        }
    }

    private static bool IsDomainReloadDisabled()
    {
        return EditorSettings.enterPlayModeOptionsEnabled &&
            (EditorSettings.enterPlayModeOptions & EnterPlayModeOptions.DisableDomainReload) != 0;
    }

    private static void Start()
    {
        lock (Gate)
        {
            if (listener != null)
            {
                return;
            }

            try
            {
                listener = new HttpListener();
                listener.Prefixes.Add($"{BaseUrl}/");
                listener.Start();
                listenerThread = new Thread(Listen)
                {
                    IsBackground = true,
                    Name = nameof(ManifestApiConnectionTestServer)
                };
                listenerThread.Start();
                Debug.Log(
                    $"[Presentation/API Test] Mock server ready: {BaseUrl}/presentations/"
                    + $"{PresentationId}/manifest"
                );
            }
            catch (Exception exception)
            {
                listener?.Close();
                listener = null;
                listenerThread = null;
                Debug.LogError(
                    $"[Presentation/API Test] Could not start mock server: {exception.Message}"
                );
            }
        }
    }

    private static void Listen()
    {
        while (true)
        {
            HttpListener activeListener;
            lock (Gate)
            {
                activeListener = listener;
            }

            if (activeListener == null || !activeListener.IsListening)
            {
                return;
            }

            try
            {
                Respond(activeListener.GetContext());
            }
            catch (HttpListenerException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
        }
    }

    private static void Respond(HttpListenerContext context)
    {
        bool found = TryGetManifest(context.Request.Url.AbsolutePath, out string responseBody);
        byte[] responseBytes = Encoding.UTF8.GetBytes(responseBody ?? "{\"error\":\"not found\"}");

        context.Response.StatusCode = found ? (int)HttpStatusCode.OK : (int)HttpStatusCode.NotFound;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength64 = responseBytes.Length;
        try
        {
            context.Response.OutputStream.Write(responseBytes, 0, responseBytes.Length);
        }
        finally
        {
            context.Response.Close();
        }
    }

    private static void Stop()
    {
        lock (Gate)
        {
            listener?.Close();
            listener = null;
            listenerThread = null;
        }
    }
}

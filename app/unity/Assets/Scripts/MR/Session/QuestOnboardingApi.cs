using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using Unframe.Unity.PresentationRuntime;

public sealed class QuestOnboardingAuthorization
{
    public string UserCode { get; internal set; }
    public Uri VerificationUrl { get; internal set; }
    public DateTimeOffset ExpiresAt { get; internal set; }
}

public sealed class QuestOnboardingPresentation
{
    public string Id { get; internal set; }
    public string Title { get; internal set; }
}

public sealed class QuestOnboardingRoom
{
    public string SessionId { get; internal set; }
    public string JoinCode { get; internal set; }
    public string State { get; internal set; }
    public string PresentationId { get; internal set; }
}

public sealed class QuestOnboardingRoomPage
{
    public QuestOnboardingRoom[] Rooms { get; internal set; }
    public string NextCursor { get; internal set; }
}

public sealed class QuestOnboardingApiException : Exception
{
    public string Code { get; }
    public QuestOnboardingApiException(string code) : base(code) { Code = code; }
}

public sealed class QuestOnboardingApi : IDisposable
{
    [Serializable] private sealed class DeviceRequest { public string client_id; }
    [Serializable] private sealed class TokenRequest { public string client_id; public string device_code; public string grant_type = "urn:ietf:params:oauth:grant-type:device_code"; }
    [Serializable] private sealed class DeviceResponse { public string device_code; public string user_code; public string verification_uri_complete; public int expires_in; public int interval; }
    [Serializable] private sealed class TokenResponse { public string access_token; public string token_type; public int expires_in; public string error; }
    [Serializable] private sealed class PresentationRecord { public string id; public string name; }
    [Serializable] private sealed class PresentationList { public PresentationRecord[] presentations; }
    [Serializable] private sealed class CreateRequest { public string presentationId; }
    [Serializable] private sealed class JoinRequest { public string joinCode; }
    [Serializable] private sealed class SessionRecord { public string id; public string state; public string presentationId; }
    [Serializable] private sealed class SessionList { public SessionRecord[] sessions; public string nextCursor; }
    [Serializable] private sealed class JoinCodeResponse { public string joinCode; }
    [Serializable] private sealed class CreateResponse { public SessionRecord session; public string joinCode; }
    [Serializable] private sealed class RuntimePreparation { public string state; public string runtimeId; public ulong assignmentEpoch; public string leaseExpiresAt; }
    [Serializable] private sealed class ApiError { public string code; }
    [Serializable] private sealed class ApiErrorResponse { public ApiError error; }

    private readonly HttpClient client;
    private readonly QuestAnonymousViewer viewer;
    private readonly PresentationSessionDiagnostics diagnostics;
    private readonly Uri origin;
    private readonly Uri webOrigin;
    private readonly string clientId;
    private readonly IQuestCredentialStore credentialStore;
    private readonly string credentialScope;
    private readonly Func<DateTimeOffset> now;
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly SemaphoreSlim authGate = new SemaphoreSlim(1, 1);
    private string deviceCode;
    private string credential;
    private DateTimeOffset authorizationExpiresAt;
    private DateTimeOffset credentialExpiresAt;
    private DateTimeOffset nextPoll;
    private int pollSeconds;
    private bool disposed;
    public Uri Origin => origin;
    public bool IsAuthenticated
    {
        get
        {
            if (disposed || String.IsNullOrEmpty(credential)) return false;
            if (now() < credentialExpiresAt) return true;
            ForgetAuthentication();
            return false;
        }
    }

    public QuestOnboardingApi(Uri origin, Uri webOrigin, string clientId, HttpMessageHandler handler = null, PresentationSessionDiagnostics diagnostics = null, IQuestCredentialStore credentialStore = null, Func<DateTimeOffset> now = null)
    {
        ValidateOrigin(origin);
        ValidateOrigin(webOrigin);
        if (String.IsNullOrWhiteSpace(clientId) || clientId.Length > 256) throw new ArgumentException("Device client ID is required.");
        this.origin = origin;
        this.diagnostics = diagnostics;
        this.webOrigin = webOrigin;
        this.clientId = clientId;
        this.now = now ?? (() => DateTimeOffset.UtcNow);
        this.credentialStore = credentialStore ?? QuestCredentialStores.Create();
        credentialScope = origin.AbsoluteUri + "|" + clientId;
        try
        {
            var saved = this.credentialStore?.Load(credentialScope);
            if (saved != null)
            {
                if (!ValidCredential(saved.token)) throw new InvalidOperationException();
                credentialExpiresAt = DateTimeOffset.FromUnixTimeSeconds(saved.expiresAt);
                if (credentialExpiresAt <= this.now()) throw new InvalidOperationException();
                credential = saved.token;
            }
        }
        catch (Exception) { ForgetAuthentication(); }
        client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
        {
            Timeout = TimeSpan.FromSeconds(30),
            MaxResponseContentBufferSize = 4 * 1024 * 1024
        };
        viewer = new QuestAnonymousViewer(client, origin, this.now);
    }

    public static void ValidateOrigin(Uri value)
    {
        if (value == null || !value.IsAbsoluteUri || value.Scheme != "https" || value.AbsolutePath != "/"
            || !String.IsNullOrEmpty(value.UserInfo) || !String.IsNullOrEmpty(value.Query) || !String.IsNullOrEmpty(value.Fragment))
            throw new ArgumentException("A configured HTTPS origin is required.");
    }

    public async Task<QuestOnboardingAuthorization> BeginAuthorizationAsync(CancellationToken token)
    {
        await authGate.WaitAsync(token);
        try
        {
            deviceCode = null;
            ForgetAuthentication();
            using (HttpResponseMessage response = await SendAsync("/api/auth/device/code", new DeviceRequest { client_id = clientId }, false, token))
            {
                RequireSuccess(response);
                DeviceResponse data = JsonUtility.FromJson<DeviceResponse>(await response.Content.ReadAsStringAsync());
                if (data == null || String.IsNullOrEmpty(data.device_code) || data.device_code.Length > 4096
                    || String.IsNullOrEmpty(data.user_code) || data.user_code.Length > 256
                    || data.expires_in <= 0 || data.expires_in > 86400 || data.interval <= 0 || data.interval > 300
                    || !Uri.TryCreate(data.verification_uri_complete, UriKind.Absolute, out Uri verification)
                    || verification.GetLeftPart(UriPartial.Authority) != webOrigin.GetLeftPart(UriPartial.Authority)
                    || verification.AbsolutePath != "/device" || verification.UserInfo.Length != 0 || verification.Fragment.Length != 0
                    || verification.Query != "?user_code=" + Uri.EscapeDataString(data.user_code))
                    throw new QuestOnboardingApiException("invalid-authorization-response");
                token.ThrowIfCancellationRequested();
                ThrowIfDisposed();
                deviceCode = data.device_code;
                authorizationExpiresAt = now().AddSeconds(data.expires_in);
                pollSeconds = data.interval;
                nextPoll = now().AddSeconds(pollSeconds);
                return new QuestOnboardingAuthorization { UserCode = data.user_code, VerificationUrl = verification, ExpiresAt = authorizationExpiresAt };
            }
        }
        finally { authGate.Release(); }
    }

    public async Task<bool> PollAuthorizationAsync(CancellationToken token)
    {
        await authGate.WaitAsync(token);
        try
        {
            if (IsAuthenticated) return true;
            if (String.IsNullOrEmpty(deviceCode) || now() >= authorizationExpiresAt)
            {
                deviceCode = null;
                throw new QuestOnboardingApiException("authorization-expired");
            }
            if (now() < nextPoll) return false;
            nextPoll = now().AddSeconds(pollSeconds);
            using (HttpResponseMessage response = await SendAsync("/api/auth/device/token", new TokenRequest { client_id = clientId, device_code = deviceCode }, false, token))
            {
                TokenResponse data = JsonUtility.FromJson<TokenResponse>(await response.Content.ReadAsStringAsync());
                if (!response.IsSuccessStatusCode)
                {
                    if (data?.error == "authorization_pending") return false;
                    if (data?.error == "slow_down") { pollSeconds += 5; nextPoll = now().AddSeconds(pollSeconds); return false; }
                    deviceCode = null;
                    throw new QuestOnboardingApiException(data?.error == "expired_token" ? "authorization-expired" : "authorization-denied");
                }
                if (data == null || data.token_type != "Bearer" || String.IsNullOrEmpty(data.access_token)
                    || data.access_token.Length > 16384 || data.access_token.IndexOfAny(new[] { '\r', '\n' }) >= 0 || data.expires_in <= 0)
                    throw new QuestOnboardingApiException("invalid-authorization-response");
                token.ThrowIfCancellationRequested();
                ThrowIfDisposed();
                credential = data.access_token;
                credentialExpiresAt = now().AddSeconds(data.expires_in);
                try { credentialStore?.Save(credentialScope, new QuestAccountCredential(credential, credentialExpiresAt)); }
                catch (Exception)
                {
                    ForgetAuthentication();
                    throw new QuestOnboardingApiException("credential-storage-unavailable");
                }
                deviceCode = null;
                return true;
            }
        }
        finally { authGate.Release(); }
    }

    public Task<string> CredentialAsync(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (!IsAuthenticated) { credential = null; throw new QuestOnboardingApiException("authentication-required"); }
        return Task.FromResult(credential);
    }

    public async Task<QuestOnboardingPresentation[]> ListPresentationsAsync(CancellationToken token)
    {
        using (HttpResponseMessage response = await SendAsync("/presentations", null, true, token))
        {
            RequireSuccess(response);
            PresentationList data = JsonUtility.FromJson<PresentationList>(await response.Content.ReadAsStringAsync());
            if (data?.presentations == null) throw new QuestOnboardingApiException("invalid-response");
            var result = new QuestOnboardingPresentation[data.presentations.Length];
            for (int i = 0; i < result.Length; i++)
            {
                PresentationRecord item = data.presentations[i];
                ValidateId(item?.id);
                if (String.IsNullOrWhiteSpace(item.name)) throw new QuestOnboardingApiException("invalid-response");
                result[i] = new QuestOnboardingPresentation { Id = item.id, Title = item.name };
            }
            return result;
        }
    }

    public async Task<QuestOnboardingRoomPage> ListRoomsAsync(CancellationToken token, string cursor = null)
    {
        if (cursor != null) ValidateId(cursor);
        string path = "/sessions?limit=20" + (cursor == null ? "" : "&cursor=" + Uri.EscapeDataString(cursor));
        using (HttpResponseMessage response = await SendAsync(path, null, true, token))
        {
            RequireSuccess(response);
            var data = JsonUtility.FromJson<SessionList>(await response.Content.ReadAsStringAsync());
            if (data?.sessions == null || data.sessions.Length > 20) throw new QuestOnboardingApiException("invalid-response");
            var rooms = new QuestOnboardingRoom[data.sessions.Length];
            for (int i = 0; i < rooms.Length; i++) rooms[i] = Room(data.sessions[i]);
            if (!String.IsNullOrEmpty(data.nextCursor))
            {
                ValidateId(data.nextCursor);
                if (rooms.Length == 0 || data.nextCursor != rooms[rooms.Length - 1].SessionId || data.nextCursor == cursor)
                    throw new QuestOnboardingApiException("invalid-response");
            }
            return new QuestOnboardingRoomPage { Rooms = rooms, NextCursor = String.IsNullOrEmpty(data.nextCursor) ? null : data.nextCursor };
        }
    }

    public async Task<QuestOnboardingRoom> OpenRoomAsync(string id, CancellationToken token)
    {
        ValidateId(id);
        QuestOnboardingRoom room;
        using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id), null, true, token, id))
        {
            RequireSuccess(response);
            room = Room(JsonUtility.FromJson<SessionRecord>(await response.Content.ReadAsStringAsync()));
            if (room.SessionId != id) throw new QuestOnboardingApiException("invalid-response");
            if (room.State == "Ended") throw new QuestOnboardingApiException("session-ended");
        }
        using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id) + "/join-code", null, true, token))
        {
            RequireSuccess(response);
            var code = JsonUtility.FromJson<JoinCodeResponse>(await response.Content.ReadAsStringAsync());
            ValidateJoinCode(code?.joinCode);
            room.JoinCode = code.joinCode;
        }
        return room;
    }

    private static QuestOnboardingRoom Room(SessionRecord data)
    {
        ValidateId(data?.id);
        ValidateId(data.presentationId);
        if (data.state != "Waiting" && data.state != "Presenting" && data.state != "Ended")
            throw new QuestOnboardingApiException("invalid-response");
        return new QuestOnboardingRoom { SessionId = data.id, PresentationId = data.presentationId, State = data.state };
    }

    public async Task<QuestOnboardingRoom> CreateSessionAsync(string presentationId, CancellationToken token)
    {
        ValidateId(presentationId);
        using (HttpResponseMessage response = await SendAsync("/sessions", new CreateRequest { presentationId = presentationId }, true, token))
        {
            RequireSuccess(response);
            CreateResponse data = JsonUtility.FromJson<CreateResponse>(await response.Content.ReadAsStringAsync());
            ValidateId(data?.session?.id);
            ValidateJoinCode(data.joinCode);
            var room = Room(data.session);
            room.JoinCode = data.joinCode;
            diagnostics?.ForSession(data.session.id).Record("session.create", direction: "receive");
            return room;
        }
    }

    public Task<QuestOnboardingRoom> JoinSessionAsync(string code, CancellationToken token)
        => viewer.JoinAsync((code ?? String.Empty).Trim().ToUpperInvariant(), token);

    public bool HasViewerCredential(string sessionId) => viewer.IsValid(sessionId);
    public Task<string> ViewerCredentialAsync(string sessionId, CancellationToken token) => viewer.CredentialAsync(sessionId, token);
    public Task LeaveViewerAsync(CancellationToken token) => viewer.LeaveAsync(token);

    public async Task StartSessionAsync(string id, CancellationToken token)
    {
        ValidateId(id);
        string state = await SessionStateAsync(id, token);
        if (state == "Presenting") return;
        if (state != "Waiting") throw new QuestOnboardingApiException("not-ready");
        using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id) + "/start", new object(), true, token, id))
        {
            if (response.StatusCode == System.Net.HttpStatusCode.Conflict && await SessionStateAsync(id, token) == "Presenting") return;
            RequireSuccess(response);
        }
    }

    private async Task<string> SessionStateAsync(string id, CancellationToken token)
    {
        using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id), null, true, token, id))
        {
            RequireSuccess(response);
            SessionRecord data = JsonUtility.FromJson<SessionRecord>(await response.Content.ReadAsStringAsync());
            if (data?.id != id || data.state != "Waiting" && data.state != "Presenting" && data.state != "Ended")
                throw new QuestOnboardingApiException("invalid-response");
            return data.state;
        }
    }

    public async Task PrepareRuntimeAsync(string id, CancellationToken token)
    {
        ValidateId(id);
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(token, lifetime.Token))
        {
            deadline.CancelAfter(TimeSpan.FromSeconds(30));
            bool requestAssignment = true;
            try
            {
                while (true)
                {
                    using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id) + "/runtime-preparation", requestAssignment ? new object() : null, true, deadline.Token, id))
                    {
                        string json = await response.Content.ReadAsStringAsync();
                        if ((int)response.StatusCode == 409 && JsonUtility.FromJson<ApiErrorResponse>(json)?.error?.code == "runtime_unavailable")
                            throw new QuestOnboardingApiException("runtime-unavailable");
                        RequireSuccess(response);
                        RuntimePreparation preparation = JsonUtility.FromJson<RuntimePreparation>(json);
                        if (preparation?.state == "ended") throw new QuestOnboardingApiException("session-ended");
                        if (preparation?.state == "unassigned") throw new QuestOnboardingApiException("runtime-unavailable");
                        ValidateId(preparation?.runtimeId);
                        if (preparation.assignmentEpoch == 0
                            || !DateTimeOffset.TryParse(preparation.leaseExpiresAt, System.Globalization.CultureInfo.InvariantCulture,
                                System.Globalization.DateTimeStyles.RoundtripKind, out DateTimeOffset expiresAt)
                            || expiresAt <= now()
                            || preparation.state != "ready" && preparation.state != "starting")
                            throw new QuestOnboardingApiException("invalid-response");
                        if (preparation.state == "ready") return;
                    }
                    requestAssignment = false;
                    await Task.Delay(250, deadline.Token);
                }
            }
            catch (OperationCanceledException) when (!token.IsCancellationRequested && !lifetime.IsCancellationRequested)
            { throw new QuestOnboardingApiException("runtime-preparation-timeout"); }
        }
    }

    private async Task<HttpResponseMessage> SendAsync(string path, object body, bool authenticated, CancellationToken token, string diagnosticSessionId = null)
    {
        ThrowIfDisposed();
        using (var linked = CancellationTokenSource.CreateLinkedTokenSource(token, lifetime.Token))
        using (var request = new HttpRequestMessage(body == null ? HttpMethod.Get : HttpMethod.Post, new Uri(origin, path)))
        {
            if (body != null) request.Content = new StringContent(JsonUtility.ToJson(body), Encoding.UTF8, "application/json");
            string accountCredential = authenticated ? await CredentialAsync(linked.Token) : null;
            if (accountCredential != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accountCredential);
            string kind = path == "/sessions" ? "SessionCreate" : path == "/sessions/join" ? "SessionJoin"
                : path.EndsWith("/runtime-preparation", StringComparison.Ordinal) ? "RuntimePreparation"
                : path.EndsWith("/start", StringComparison.Ordinal) ? "SessionStart"
                : diagnosticSessionId != null && body == null ? "SessionRead" : path == "/presentations" ? "Presentations" : "DeviceAuthorization";
            var diagnosticScope = diagnosticSessionId == null ? diagnostics : diagnostics?.ForSession(diagnosticSessionId);
            diagnosticScope?.Record("http.request", direction: "send", kind: kind);
            try
            {
                HttpResponseMessage response = await client.SendAsync(request, linked.Token);
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized && accountCredential != null && accountCredential == credential)
                    ForgetAuthentication();
                diagnosticScope?.Record("http.response", direction: "receive", kind: kind, code: "http-" + (int)response.StatusCode);
                return response;
            }
            catch (Exception)
            {
                diagnosticScope?.Record("http.response", direction: "receive", kind: kind, code: "request-failed");
                throw;
            }
        }
    }

    private void RequireSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        int status = (int)response.StatusCode;
        throw new QuestOnboardingApiException(status == 401 ? "authentication-required" : status == 403 ? "forbidden"
            : status == 404 ? "not-found" : status == 409 ? "not-ready" : status == 429 ? "rate-limited" : "request-failed");
    }

    public void ForgetAuthentication()
    {
        credential = null;
        credentialExpiresAt = default;
        try { credentialStore?.Delete(credentialScope); }
        catch (Exception) { }
    }

    internal static bool ValidCredential(string value) => !String.IsNullOrEmpty(value)
        && value.Length <= 16384 && value.IndexOfAny(new[] { '\r', '\n' }) < 0;

    internal static void ValidateId(string value)
    {
        if (String.IsNullOrEmpty(value) || !Regex.IsMatch(value, @"\A[A-Za-z0-9_-]{1,128}\z")) throw new QuestOnboardingApiException("invalid-response");
    }
    internal static void ValidateJoinCode(string value)
    {
        if (value == null || !Regex.IsMatch(value, @"\A[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\z")) throw new QuestOnboardingApiException("invalid-room-code");
    }
    private void ThrowIfDisposed() { if (disposed) throw new ObjectDisposedException(nameof(QuestOnboardingApi)); }
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        deviceCode = credential = null;
        lifetime.Cancel();
        _ = DisposeClientAsync();
    }

    private async Task DisposeClientAsync()
    {
        try { await viewer.DisposeAsync(); }
        finally { client.Dispose(); }
    }
}

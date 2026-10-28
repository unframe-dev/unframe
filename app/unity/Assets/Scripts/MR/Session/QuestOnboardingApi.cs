using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

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
    [Serializable] private sealed class SessionRecord { public string id; public string state; }
    [Serializable] private sealed class CreateResponse { public SessionRecord session; public string joinCode; }
    [Serializable] private sealed class RuntimePreparation { public string state; public string runtimeId; public ulong assignmentEpoch; public string leaseExpiresAt; }
    [Serializable] private sealed class ApiError { public string code; }
    [Serializable] private sealed class ApiErrorResponse { public ApiError error; }

    private readonly HttpClient client;
    private readonly Uri origin;
    private readonly Uri webOrigin;
    private readonly string clientId;
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
    public bool IsAuthenticated => !disposed && !String.IsNullOrEmpty(credential) && DateTimeOffset.UtcNow < credentialExpiresAt;

    public QuestOnboardingApi(Uri origin, Uri webOrigin, string clientId, HttpMessageHandler handler = null)
    {
        ValidateOrigin(origin);
        ValidateOrigin(webOrigin);
        if (String.IsNullOrWhiteSpace(clientId) || clientId.Length > 256) throw new ArgumentException("Device client ID is required.");
        this.origin = origin;
        this.webOrigin = webOrigin;
        this.clientId = clientId;
        client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(30),
            MaxResponseContentBufferSize = 4 * 1024 * 1024
        };
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
            deviceCode = credential = null;
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
                ThrowIfDisposed();
                deviceCode = data.device_code;
                authorizationExpiresAt = DateTimeOffset.UtcNow.AddSeconds(data.expires_in);
                pollSeconds = data.interval;
                nextPoll = DateTimeOffset.UtcNow.AddSeconds(pollSeconds);
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
            if (String.IsNullOrEmpty(deviceCode) || DateTimeOffset.UtcNow >= authorizationExpiresAt)
            {
                deviceCode = null;
                throw new QuestOnboardingApiException("authorization-expired");
            }
            if (DateTimeOffset.UtcNow < nextPoll) return false;
            nextPoll = DateTimeOffset.UtcNow.AddSeconds(pollSeconds);
            using (HttpResponseMessage response = await SendAsync("/api/auth/device/token", new TokenRequest { client_id = clientId, device_code = deviceCode }, false, token))
            {
                TokenResponse data = JsonUtility.FromJson<TokenResponse>(await response.Content.ReadAsStringAsync());
                if (!response.IsSuccessStatusCode)
                {
                    if (data?.error == "authorization_pending") return false;
                    if (data?.error == "slow_down") { pollSeconds += 5; nextPoll = DateTimeOffset.UtcNow.AddSeconds(pollSeconds); return false; }
                    deviceCode = null;
                    throw new QuestOnboardingApiException(data?.error == "expired_token" ? "authorization-expired" : "authorization-denied");
                }
                if (data == null || data.token_type != "Bearer" || String.IsNullOrEmpty(data.access_token)
                    || data.access_token.Length > 16384 || data.access_token.IndexOfAny(new[] { '\r', '\n' }) >= 0 || data.expires_in <= 0)
                    throw new QuestOnboardingApiException("invalid-authorization-response");
                ThrowIfDisposed();
                credential = data.access_token;
                credentialExpiresAt = DateTimeOffset.UtcNow.AddSeconds(data.expires_in);
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

    public async Task<QuestOnboardingRoom> CreateSessionAsync(string presentationId, CancellationToken token)
    {
        ValidateId(presentationId);
        using (HttpResponseMessage response = await SendAsync("/sessions", new CreateRequest { presentationId = presentationId }, true, token))
        {
            RequireSuccess(response);
            CreateResponse data = JsonUtility.FromJson<CreateResponse>(await response.Content.ReadAsStringAsync());
            ValidateId(data?.session?.id);
            ValidateJoinCode(data.joinCode);
            return new QuestOnboardingRoom { SessionId = data.session.id, JoinCode = data.joinCode };
        }
    }

    public async Task<QuestOnboardingRoom> JoinSessionAsync(string code, CancellationToken token)
    {
        code = (code ?? String.Empty).Trim().ToUpperInvariant();
        ValidateJoinCode(code);
        using (HttpResponseMessage response = await SendAsync("/sessions/join", new JoinRequest { joinCode = code }, true, token))
        {
            RequireSuccess(response);
            SessionRecord data = JsonUtility.FromJson<SessionRecord>(await response.Content.ReadAsStringAsync());
            ValidateId(data?.id);
            return new QuestOnboardingRoom { SessionId = data.id, JoinCode = code };
        }
    }

    public async Task StartSessionAsync(string id, CancellationToken token)
    {
        ValidateId(id);
        string state = await SessionStateAsync(id, token);
        if (state == "Presenting") return;
        if (state != "Waiting") throw new QuestOnboardingApiException("not-ready");
        using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id) + "/start", new object(), true, token))
        {
            if (response.StatusCode == System.Net.HttpStatusCode.Conflict && await SessionStateAsync(id, token) == "Presenting") return;
            RequireSuccess(response);
        }
    }

    private async Task<string> SessionStateAsync(string id, CancellationToken token)
    {
        using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id), null, true, token))
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
                    using (HttpResponseMessage response = await SendAsync("/sessions/" + Uri.EscapeDataString(id) + "/runtime-preparation", requestAssignment ? new object() : null, true, deadline.Token))
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
                            || expiresAt <= DateTimeOffset.UtcNow
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

    private async Task<HttpResponseMessage> SendAsync(string path, object body, bool authenticated, CancellationToken token)
    {
        ThrowIfDisposed();
        using (var linked = CancellationTokenSource.CreateLinkedTokenSource(token, lifetime.Token))
        using (var request = new HttpRequestMessage(body == null ? HttpMethod.Get : HttpMethod.Post, new Uri(origin, path)))
        {
            if (body != null) request.Content = new StringContent(JsonUtility.ToJson(body), Encoding.UTF8, "application/json");
            if (authenticated) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await CredentialAsync(linked.Token));
            return await client.SendAsync(request, linked.Token);
        }
    }

    private void RequireSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        int status = (int)response.StatusCode;
        if (status == 401) credential = null;
        throw new QuestOnboardingApiException(status == 401 ? "authentication-required" : status == 403 ? "forbidden"
            : status == 404 ? "not-found" : status == 409 ? "not-ready" : status == 429 ? "rate-limited" : "request-failed");
    }

    private static void ValidateId(string value)
    {
        if (String.IsNullOrEmpty(value) || !Regex.IsMatch(value, @"\A[A-Za-z0-9_-]{1,128}\z")) throw new QuestOnboardingApiException("invalid-response");
    }
    private static void ValidateJoinCode(string value)
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
        client.Dispose();
    }
}

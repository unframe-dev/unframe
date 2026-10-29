using System;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

internal sealed class QuestAnonymousViewer
{
    [Serializable] private sealed class JoinRequest { public string joinCode; }
    [Serializable] private sealed class CredentialResponse { public string token; public string expiresAt; public string sessionId; public string participantId; }
    [Serializable] private sealed class RoomResponse { public string id; public string presentationId; public string state; }
    private readonly HttpClient client;
    private readonly Uri origin;
    private readonly Func<DateTimeOffset> now;
    private readonly SemaphoreSlim gate = new SemaphoreSlim(1, 1);
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private CancellationTokenSource renewal;
    private string credential, sessionId;
    private DateTimeOffset expiresAt, refreshAt;
    private bool disposed;

    public QuestAnonymousViewer(HttpClient client, Uri origin, Func<DateTimeOffset> now)
    { this.client = client; this.origin = origin; this.now = now; }

    public bool IsValid(string id) => !disposed && sessionId == id && credential != null && expiresAt > now();

    public async Task<QuestOnboardingRoom> JoinAsync(string code, CancellationToken token)
    {
        QuestOnboardingApi.ValidateJoinCode(code);
        await gate.WaitAsync(token);
        try
        {
            if (disposed) throw new ObjectDisposedException(nameof(QuestAnonymousViewer));
            await ClearAndRevokeAsync();
            using (var linked = CancellationTokenSource.CreateLinkedTokenSource(token, lifetime.Token))
            {
                // A cancelled UI must still revoke a credential whose issuance response arrives late.
                using (var response = await SendAsync(HttpMethod.Post, "/viewer-credentials", new JoinRequest { joinCode = code }, null, lifetime.Token))
                {
                    RequireSuccess(response);
                    SetCredential(JsonUtility.FromJson<CredentialResponse>(await response.Content.ReadAsStringAsync()), null);
                }
                try
                {
                    if (disposed) throw new ObjectDisposedException(nameof(QuestAnonymousViewer));
                    linked.Token.ThrowIfCancellationRequested();
                    using (var response = await SendAsync(HttpMethod.Get, "/sessions/" + Uri.EscapeDataString(sessionId), null, credential, linked.Token))
                    {
                        RequireSuccess(response);
                        var room = JsonUtility.FromJson<RoomResponse>(await response.Content.ReadAsStringAsync());
                        if (room?.id != sessionId || room.state != "Waiting" && room.state != "Presenting")
                            throw new QuestOnboardingApiException(room?.state == "Ended" ? "session-ended" : "invalid-response");
                        QuestOnboardingApi.ValidateId(room.presentationId);
                        if (disposed) throw new ObjectDisposedException(nameof(QuestAnonymousViewer));
                        linked.Token.ThrowIfCancellationRequested();
                        var lease = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                        renewal = lease;
                        _ = MaintainAsync(sessionId, lease.Token);
                        return new QuestOnboardingRoom { SessionId = sessionId, JoinCode = code, State = room.state, PresentationId = room.presentationId };
                    }
                }
                catch { await ClearAndRevokeAsync(); throw; }
            }
        }
        finally { gate.Release(); }
    }

    public async Task<string> CredentialAsync(string id, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            if (!IsValid(id)) throw new QuestOnboardingApiException("viewer-authentication-required");
            if (now() >= refreshAt)
            {
                try
                {
                    // Capture the replacement before honoring cancellation; the old token is invalid after rotation.
                    using (var response = await SendAsync(HttpMethod.Post, "/viewer-credentials/refresh", new object(), credential, lifetime.Token))
                    {
                        RequireSuccess(response);
                        SetCredential(JsonUtility.FromJson<CredentialResponse>(await response.Content.ReadAsStringAsync()), id);
                        token.ThrowIfCancellationRequested();
                    }
                }
                catch (OperationCanceledException) { throw; }
                catch (QuestOnboardingApiException error) when (error.Code == "viewer-authentication-required" || error.Code == "invalid-response")
                { await ClearAndRevokeAsync(); throw; }
                catch (Exception) when (IsValid(id))
                { refreshAt = now().AddMilliseconds(Math.Max(100, Math.Min(5000, (expiresAt - now()).TotalMilliseconds / 2))); }
            }
            if (!IsValid(id)) throw new QuestOnboardingApiException("viewer-authentication-required");
            return credential;
        }
        finally { gate.Release(); }
    }

    private async Task MaintainAsync(string id, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested && IsValid(id))
            {
                await Task.Delay(TimeSpan.FromMilliseconds(Math.Max(100, Math.Min(60000, (refreshAt - now()).TotalMilliseconds))), token);
                await CredentialAsync(id, token);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception) { }
    }

    public async Task LeaveAsync(CancellationToken token)
    {
        StopRenewal();
        await gate.WaitAsync(token);
        try { await ClearAndRevokeAsync(); }
        finally { gate.Release(); }
    }

    public async Task DisposeAsync()
    {
        disposed = true;
        StopRenewal();
        await LeaveAsync(CancellationToken.None);
        lifetime.Cancel();
    }

    private void SetCredential(CredentialResponse data, string expectedSession)
    {
        if (data == null || !QuestOnboardingApi.ValidCredential(data.token) || !data.token.StartsWith("viewer_", StringComparison.Ordinal)
            || !DateTimeOffset.TryParse(data.expiresAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out DateTimeOffset expiry)
            || expiry <= now() || expectedSession != null && expectedSession != data.sessionId)
            throw new QuestOnboardingApiException("invalid-response");
        QuestOnboardingApi.ValidateId(data.sessionId);
        QuestOnboardingApi.ValidateId(data.participantId);
        credential = data.token; sessionId = data.sessionId; expiresAt = expiry;
        refreshAt = expiry.Subtract(TimeSpan.FromMilliseconds(Math.Min(30000, (expiry - now()).TotalMilliseconds / 2)));
    }

    private void StopRenewal()
    {
        var previous = Interlocked.Exchange(ref renewal, null);
        previous?.Cancel(); previous?.Dispose();
    }

    private async Task ClearAndRevokeAsync()
    {
        StopRenewal();
        string previous = credential;
        credential = sessionId = null;
        if (previous == null) return;
        try
        {
            using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
            using (var response = await SendAsync(HttpMethod.Delete, "/viewer-credentials", null, previous, timeout.Token)) { }
        }
        catch (Exception) { }
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object body, string bearer, CancellationToken token)
    {
        using (var request = new HttpRequestMessage(method, new Uri(origin, path)))
        {
            if (bearer != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            if (body != null) request.Content = new StringContent(JsonUtility.ToJson(body), Encoding.UTF8, "application/json");
            return await client.SendAsync(request, token);
        }
    }

    private static void RequireSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        int status = (int)response.StatusCode;
        throw new QuestOnboardingApiException(status == 401 ? "viewer-authentication-required" : status == 404 ? "not-found"
            : status == 409 ? "not-ready" : status == 429 ? "rate-limited" : status == 403 ? "forbidden" : "request-failed");
    }
}

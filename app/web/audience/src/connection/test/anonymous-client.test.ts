import { audienceWebCapabilityProfileId } from "@unframe/contracts/presentation";
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createAnonymousAudienceClient } from "../anonymous-client";

const config = {
  apiOrigin: "https://api.example",
  capabilityProfileId: audienceWebCapabilityProfileId,
};
const session = {
  id: "session",
  presentationId: "presentation",
  presenterId: "presenter",
  state: "Presenting",
  participantCount: 2,
  maxParticipants: 50,
  createdAt: "2026-10-27T00:00:00Z",
  endedAt: null,
  publicationFence: null,
};
const now = Date.parse("2026-10-27T00:00:00Z");
afterEach(() => vi.useRealTimers());
it("issues a scoped identity before join, rotates near expiry, and revokes on leave through HTTP", async () => {
  const requests: { path: string; auth: string | undefined; cookie: string | undefined }[] = [];
  let clock = now;
  const server = createServer((req, res) => {
    requests.push({ path: req.url!, auth: req.headers.authorization, cookie: req.headers.cookie });
    res.setHeader("Content-Type", "application/json");
    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/viewer-credentials" || req.url === "/viewer-credentials/refresh") {
      res.writeHead(req.url.endsWith("refresh") ? 200 : 201);
      res.end(
        JSON.stringify({
          token: req.url.endsWith("refresh") ? "viewer_new" : "viewer_old",
          expiresAt: new Date(clock + 3600000).toISOString(),
          sessionId: "session",
          participantId: "anonymous_test",
        }),
      );
      return;
    }
    if (req.url === "/sessions/join") {
      res.end(JSON.stringify(session));
      return;
    }
    res.writeHead(409);
    res.end(JSON.stringify({ error: { code: "conflict", message: "conflict" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const client = createAnonymousAudienceClient(config, {
    now: () => clock,
    fetch: (url, init) =>
      fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init),
  });
  try {
    expect(await client.join("ABCD-EFGH")).toEqual(session);
    clock += 58 * 60000;
    await expect(client.delivery("session")).rejects.toMatchObject({ status: 409 });
    await client.leave();
    expect(requests.map((r) => [r.path, r.auth])).toEqual([
      ["/viewer-credentials", undefined],
      ["/sessions/join", "Bearer viewer_old"],
      ["/viewer-credentials/refresh", "Bearer viewer_old"],
      ["/sessions/session/delivery", "Bearer viewer_new"],
      ["/viewer-credentials", "Bearer viewer_new"],
    ]);
    expect(requests.every((r) => r.cookie === undefined)).toBe(true);
    await expect(client.bootstrap("session")).rejects.toMatchObject({ code: "unauthorized" });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
it("does not allocate identity for invalid join codes", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createAnonymousAudienceClient(config, { fetch });
  await expect(client.join("invalid")).rejects.toMatchObject({ code: "invalid-join-code" });
  expect(fetch).not.toHaveBeenCalled();
});
it("rechecks credential expiry when dispatching after asynchronous preparation", async () => {
  let clock = now;
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          token: "viewer_private",
          expiresAt: new Date(now + 3600000).toISOString(),
          sessionId: "session",
          participantId: "anonymous_test",
        },
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(Response.json(session));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => clock });
  await client.join("ABCD-EFGH");
  const delivery = client.delivery("session");
  clock += 3600000;
  await expect(delivery).rejects.toMatchObject({ code: "unauthorized" });
  expect(requestFetch).toHaveBeenCalledTimes(2);
});
it("does not revive a credential when rotation completes after the old expiry", async () => {
  let clock = now;
  let complete!: (response: Response) => void;
  const credential = (token: string, expiresAt: number, status: number) =>
    Response.json(
      {
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        sessionId: "session",
        participantId: "anonymous_test",
      },
      { status },
    );
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(credential("viewer_old", now + 3600000, 201))
    .mockResolvedValueOnce(Response.json(session))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => clock });
  await client.join("ABCD-EFGH");
  clock += 58 * 60000;
  const delivery = client.delivery("session");
  await vi.waitFor(() => expect(requestFetch).toHaveBeenCalledTimes(3));
  clock = now + 3600000;
  complete(credential("viewer_late", clock + 3600000, 200));
  await expect(delivery).rejects.toMatchObject({ code: "unauthorized" });
  expect(requestFetch).toHaveBeenLastCalledWith(
    "https://api.example/viewer-credentials",
    expect.objectContaining({ method: "DELETE" }),
  );
  await expect(client.bootstrap("session")).rejects.toMatchObject({ code: "unauthorized" });
});
it("rejects a credential response bound to a different session and never stores secrets persistently", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          token: "viewer_secret",
          expiresAt: new Date(now + 3600000).toISOString(),
          sessionId: "other",
          participantId: "anonymous_test",
        },
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const client = createAnonymousAudienceClient(config, { fetch, now: () => now });
  await expect(client.join("ABCD-EFGH")).rejects.toMatchObject({ code: "invalid-response" });
  await expect(client.delivery("session")).rejects.toMatchObject({ code: "unauthorized" });
});
it("cancels a superseded join while its prior credential revocation is pending", async () => {
  let revoked!: (response: Response) => void;
  const issue = (token: string) =>
    Response.json(
      {
        token,
        expiresAt: new Date(now + 3600000).toISOString(),
        sessionId: "session",
        participantId: "anonymous_test",
      },
      { status: 201 },
    );
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(issue("viewer_initial"))
    .mockResolvedValueOnce(Response.json(session))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          revoked = resolve;
        }),
    )
    .mockResolvedValueOnce(issue("viewer_latest"))
    .mockResolvedValueOnce(Response.json(session));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => now });
  await client.join("ABCD-EFGH");
  const old = client.join("ABCD-EFGH");
  await client.join("ABCD-EFGH");
  const rejected = expect(old).rejects.toMatchObject({ code: "aborted" });
  revoked(new Response(null, { status: 204 }));
  await rejected;
  expect(requestFetch).toHaveBeenCalledTimes(5);
});

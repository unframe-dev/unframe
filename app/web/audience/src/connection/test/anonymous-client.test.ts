import { audienceWebCapabilityProfileId } from "@unframe-dev/contracts/presentation";
import { createServer } from "node:http";
import { afterEach, assert, expect, it, vi } from "vite-plus/test";
import { createAnonymousAudienceClient } from "../anonymous-client";
import { createJoinController } from "../join-controller";
import { encodeWireMessage, type DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import deliveryFixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { readSharedJoinCode } from "../shared-join-code";

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
it("uses the shared URL to issue a scoped identity, then rotates and revokes it through HTTP", async () => {
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
    const code = readSharedJoinCode(new URL("https://app.example/#join=ABCD-EFGH").hash);
    assert.isNotNull(code);
    expect(await client.join(code)).toEqual(session);
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
it("rejects a credential that expires while the session response is in flight", async () => {
  let clock = now;
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          token: "viewer_expiring",
          expiresAt: new Date(now + 1000).toISOString(),
          sessionId: "session",
          participantId: "anonymous_test",
        },
        { status: 201 },
      ),
    )
    .mockImplementationOnce(async () => {
      clock += 1000;
      return Response.json(session);
    })
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => clock });
  await expect(client.join("ABCD-EFGH")).rejects.toMatchObject({ code: "unauthorized" });
  await expect(client.delivery("session")).rejects.toMatchObject({ code: "unauthorized" });
});
it("does not complete a join after the viewer has left while the session response is pending", async () => {
  let completeJoin!: (response: Response) => void;
  let sessionRequested!: () => void;
  const sessionRequest = new Promise<void>((resolve) => {
    sessionRequested = resolve;
  });
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          token: "viewer_leaving",
          expiresAt: new Date(now + 3600000).toISOString(),
          sessionId: "session",
          participantId: "anonymous_test",
        },
        { status: 201 },
      ),
    )
    .mockImplementationOnce(() => {
      sessionRequested();
      return new Promise<Response>((resolve) => {
        completeJoin = resolve;
      });
    })
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => now });
  const joining = client.join("ABCD-EFGH");
  await sessionRequest;
  await client.leave();
  completeJoin(Response.json(session));
  await expect(joining).rejects.toMatchObject({ code: "aborted" });
  await expect(client.bootstrap("session")).rejects.toMatchObject({ code: "unauthorized" });
});

it.each(["response", "body"])(
  "bounds a stalled credential refresh %s and ignores its late result",
  async (stage) => {
    vi.useFakeTimers();
    let clock = now;
    let complete!: (response: Response) => void;
    let completeBody!: (value: unknown) => void;
    const issue = (token: string, status = 200) =>
      Response.json(
        {
          token,
          expiresAt: new Date(clock + 3600000).toISOString(),
          sessionId: "session",
          participantId: "anonymous_test",
        },
        { status },
      );
    const stalled = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const stalledBody = new Promise<unknown>((resolve) => {
      completeBody = resolve;
    });
    const response = issue("viewer_late");
    if (stage === "body") vi.spyOn(response, "json").mockReturnValue(stalledBody);
    const requestFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(issue("viewer_old", 201))
      .mockResolvedValueOnce(Response.json(session))
      .mockImplementationOnce(() => (stage === "response" ? stalled : Promise.resolve(response)))
      .mockImplementationOnce(async () => issue("viewer_current"))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => clock });
    await client.join("ABCD-EFGH");
    clock += 58 * 60000;
    const first = client.delivery("session");
    const failed = expect(first).rejects.toMatchObject({ code: "network-error" });
    await vi.advanceTimersByTimeAsync(30000);
    await failed;
    await expect(client.delivery("session")).rejects.toMatchObject({ status: 409 });
    requestFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    if (stage === "response") complete(response);
    else completeBody(await issue("viewer_late").json());
    await vi.advanceTimersByTimeAsync(0);
    const [revocationUrl, revocation] = requestFetch.mock.calls.at(-1)!;
    expect(revocationUrl).toBe("https://api.example/viewer-credentials");
    expect(revocation?.method).toBe("DELETE");
    expect(new Headers(revocation?.headers).get("Authorization")).toBe("Bearer viewer_late");
    requestFetch.mockResolvedValueOnce(new Response(null, { status: 409 }));
    await expect(client.bootstrap("session")).rejects.toMatchObject({ status: 409 });
    const [url, init] = requestFetch.mock.calls.at(-1)!;
    expect(url).toBe("https://api.example/sessions/session/bootstrap");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer viewer_current");
  },
);

it("bounds credential revocation even when fetch ignores cancellation", async () => {
  vi.useFakeTimers();
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          token: "viewer_old",
          expiresAt: new Date(now + 3600000).toISOString(),
          sessionId: "session",
          participantId: "anonymous_test",
        },
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(Response.json(session))
    .mockImplementationOnce(() => new Promise<Response>(() => {}));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => now });
  await client.join("ABCD-EFGH");
  const leaving = expect(client.leave()).rejects.toMatchObject({ code: "network-error" });
  await vi.advanceTimersByTimeAsync(30000);
  await leaving;
  await expect(client.delivery("session")).rejects.toMatchObject({ code: "unauthorized" });
});

it("cancels a pending credential rotation with its delivery request", async () => {
  let clock = now;
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          token: "viewer_old",
          expiresAt: new Date(now + 3600000).toISOString(),
          sessionId: "session",
          participantId: "anonymous_test",
        },
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(Response.json(session))
    .mockImplementationOnce(() => new Promise<Response>(() => {}));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => clock });
  await client.join("ABCD-EFGH");
  clock += 58 * 60000;
  const controller = new AbortController();
  const pending = client.delivery("session", controller.signal);
  await vi.waitFor(() => expect(requestFetch).toHaveBeenCalledTimes(3));
  const failure = expect(pending).rejects.toMatchObject({ code: "aborted" });
  controller.abort();
  await failure;
  expect(requestFetch.mock.calls[2]![1]?.signal?.aborted).toBe(true);
});

it("does not dispatch credential rotation for an already cancelled request", async () => {
  let clock = now;
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          token: "viewer_old",
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
  clock += 58 * 60000;
  const controller = new AbortController();
  controller.abort();
  await expect(client.delivery("session", controller.signal)).rejects.toMatchObject({
    code: "aborted",
  });
  expect(requestFetch).toHaveBeenCalledTimes(2);
});

it("revokes a late credential issuance after its join was cancelled", async () => {
  let complete!: (value: Response) => void;
  const requestFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const client = createAnonymousAudienceClient(config, { fetch: requestFetch, now: () => now });
  const controller = new AbortController();
  const joining = client.join("ABCD-EFGH", controller.signal);
  await vi.waitFor(() => expect(requestFetch).toHaveBeenCalledOnce());
  const failure = expect(joining).rejects.toMatchObject({ code: "aborted" });
  controller.abort();
  await failure;
  complete(
    Response.json(
      {
        token: "viewer_late",
        expiresAt: new Date(now + 3600000).toISOString(),
        sessionId: "session",
        participantId: "anonymous_test",
      },
      { status: 201 },
    ),
  );
  await vi.waitFor(() => expect(requestFetch).toHaveBeenCalledTimes(2));
  const [url, init] = requestFetch.mock.calls[1]!;
  expect(url).toBe("https://api.example/viewer-credentials");
  expect(init?.method).toBe("DELETE");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer viewer_late");
  await expect(client.delivery("session")).rejects.toMatchObject({ code: "unauthorized" });
});

it("requires rejoining when a timed-out server rotation has invalidated the old API credential", async () => {
  vi.useFakeTimers();
  let clock = now;
  const delivery = structuredClone(deliveryFixture.value) as DeliveryManifestWire;
  delivery.projectionProfile!.key!.role = 2;
  for (const asset of delivery.assetAccess!) asset.expiresAtUnixMs = String(now + 86400000);
  const publicSession = {
    ...session,
    id: delivery.sessionId!,
    presentationId: delivery.publication!.presentationId!,
    publicationFence: { ...delivery.publication!, publicationEpoch: 1 },
  };
  const bootstrap = {
    endpoint: "https://runtime.example.test",
    fingerprint: null,
    runtimeId: "runtime",
    runtimeKind: "Cloud",
    assignmentEpoch: 1,
    presentationId: publicSession.presentationId,
    presentationRevision: 1,
    credential: "runtime-jwt",
    expiresAt: new Date(now + 86400000).toISOString(),
    publicationFence: publicSession.publicationFence,
    projectionProfileId: delivery.projectionProfile!.projectionProfileId!,
  };
  let issued = 0;
  let rotated = false;
  let complete!: (value: Response) => void;
  const credential = (token: string, status: number) =>
    Response.json(
      {
        token,
        sessionId: publicSession.id,
        participantId: "anonymous_test",
        expiresAt: new Date(clock + 3600000).toISOString(),
      },
      { status },
    );
  const requestFetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/viewer-credentials" && init?.method === "DELETE")
      return new Response(null, { status: 204 });
    if (path === "/viewer-credentials") return credential(`viewer_join_${++issued}`, 201);
    if (path === "/viewer-credentials/refresh") {
      if (rotated) return new Response(null, { status: 401 });
      rotated = true;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    }
    if (path === "/sessions/join") return Response.json(publicSession);
    if (path.endsWith("/delivery"))
      return new Response(new Uint8Array(encodeWireMessage(deliveryFixture.typeName, delivery)), {
        headers: { "Content-Type": "application/x-protobuf" },
      });
    if (path.endsWith("/bootstrap")) return Response.json(bootstrap);
    throw new Error("Unexpected test request");
  });
  const client = createAnonymousAudienceClient(
    { ...config, capabilityProfileId: "synthetic-test-only" },
    { fetch: requestFetch, now: () => clock },
  );
  const controller = createJoinController({
    client,
    capabilityProfileId: "synthetic-test-only",
    now: () => clock,
  });
  try {
    await controller.join("ABCD-EFGH");
    expect(controller.getSnapshot().phase).toBe("prepared");
    clock += 58 * 60000;
    const refreshing = controller.refresh();
    await vi.advanceTimersByTimeAsync(30000);
    await refreshing;
    expect(rotated).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "prepared", refreshing: false });
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "unauthorized" });
    expect(controller.getPrepared()).toBeNull();
    await controller.join("ABCD-EFGH");
    expect(controller.getSnapshot().phase).toBe("prepared");
    complete(credential("viewer_late_rotation", 200));
    await vi.advanceTimersByTimeAsync(0);
    const revoked = requestFetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(
      revoked.some(
        ([, init]) =>
          new Headers(init?.headers).get("Authorization") === "Bearer viewer_late_rotation",
      ),
    ).toBe(true);
    expect(controller.getSnapshot().phase).toBe("prepared");
    await controller.refresh();
    expect(controller.getSnapshot().phase).toBe("prepared");
  } finally {
    controller.dispose();
  }
});

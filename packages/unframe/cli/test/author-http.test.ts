import { createProjectChanges } from "../src/author/project-changes.js";
import { request, Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { startAuthorHost } from "../src/author/http.js";
import { AuthorError, type AuthorService } from "@unframe-dev/author-service";
import type { LocalPublicationService } from "../src/author/publication.js";
import type { BuildJob } from "@unframe-dev/contracts/author-http";
import { createLocalPreviewService } from "../src/author/local-preview.js";

const hosts: Awaited<ReturnType<typeof startAuthorHost>>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  vi.restoreAllMocks();
});
const setup = async (development = false, publication?: LocalPublicationService) => {
  if (development) {
    const listen = Server.prototype.listen;
    // Keep development-origin checks independent of a running CLI on its fixed port.
    vi.spyOn(Server.prototype, "listen").mockImplementationOnce(function (
      this: Server,
      ...args: unknown[]
    ) {
      args[0] = 0;
      return Reflect.apply(listen, this, args) as Server;
    });
  }
  const service: AuthorService = {
    project: vi.fn(async () => ({
      revision: "rev",
      sourceHash: "source",
      irHash: "ir",
      definition: null,
      instances: [],
      diagnostics: [],
    })),
    patch: vi.fn(),
    build: vi.fn(),
    job: vi.fn(),
    cancel: vi.fn(),
    artifact: vi.fn(),
    close: vi.fn(async () => {}),
  };
  const previews = createLocalPreviewService("/missing");
  const changes = createProjectChanges();
  const host = await startAuthorHost({
    changes,
    service,
    previews,
    ...(publication ? { publication } : {}),
    ...(development ? { development: true } : {}),
    assets: new Map([["/", { bytes: new TextEncoder().encode("editor"), mediaType: "text/html" }]]),
  });
  hosts.push(host);
  return { host, service, previews, changes };
};
describe("local author HTTP boundary", () => {
  it("bootstraps an Editor session from its own origin without an existing credential", async () => {
    const { host } = await setup();
    const response = await fetch(`${host.origin}/api/editor-session`, {
      method: "POST",
      headers: { origin: host.origin, "x-unframe-editor": "1" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const session = (await response.json()) as { token: string };
    expect(session).toEqual({ token: host.token });
    const project = await fetch(`${host.origin}/api/project`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(project.status).toBe(200);
  });
  it.each([undefined, "null", "https://elsewhere.invalid", "http://127.0.0.1:5174"])(
    "does not disclose an Editor credential to origin %s",
    async (origin) => {
      const { host } = await setup();
      const response = await fetch(`${host.origin}/api/editor-session`, {
        method: "POST",
        headers: { "x-unframe-editor": "1", ...(origin ? { origin } : {}) },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await response.text()).not.toContain(host.token);
    },
  );
  it.each([undefined, "0"])(
    "requires the Editor request header rather than a simple browser request (%s)",
    async (header) => {
      const { host } = await setup();
      const response = await fetch(`${host.origin}/api/editor-session`, {
        method: "POST",
        headers: { origin: host.origin, ...(header ? { "x-unframe-editor": header } : {}) },
      });
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(host.token);
    },
  );
  it.each(["GET", "OPTIONS", "PUT"])(
    "does not disclose an Editor credential through %s",
    async (method) => {
      const { host } = await setup();
      const response = await fetch(`${host.origin}/api/editor-session`, {
        method,
        headers: { origin: host.origin, "x-unframe-editor": "1" },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await response.text()).not.toContain(host.token);
    },
  );
  it("rejects a forged Host before issuing an Editor credential", async () => {
    const { host } = await setup();
    const response = await new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        const req = request(
          `${host.origin}/api/editor-session`,
          {
            method: "POST",
            headers: { host: "attacker.invalid", origin: host.origin, "x-unframe-editor": "1" },
          },
          (incoming) => {
            let body = "";
            incoming.setEncoding("utf8");
            incoming.on("data", (chunk: string) => (body += chunk));
            incoming.on("end", () => resolve({ status: incoming.statusCode, body }));
            incoming.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(response.status).toBe(403);
    expect(response.body).not.toContain(host.token);
  });
  it("bootstraps development only from the fixed Editor origin", async () => {
    const { host } = await setup(true);
    const response = await fetch(`${host.origin}/api/editor-session`, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5174", "x-unframe-editor": "1" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: host.token });
    const rejected = await fetch(`${host.origin}/api/editor-session`, {
      method: "POST",
      headers: { origin: host.origin, "x-unframe-editor": "1" },
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).not.toContain(host.token);
  });
  it("allows verified Blob videos in the editor content security policy", async () => {
    const { host } = await setup();
    const response = await fetch(host.origin);
    expect(response.headers.get("content-security-policy")).toContain("media-src 'self' blob:");
  });
  it("protects playback and rejects client state, clocks, and malformed input commands", async () => {
    const { host } = await setup();
    const headers = {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/json",
      origin: host.origin,
    };
    const body = JSON.stringify({ requestId: "a".repeat(32), command: "poll" });
    const post = (requestBody: string, requestHeaders = headers) =>
      fetch(`${host.origin}/api/preview-playback`, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody,
      });
    expect((await post(body, { ...headers, authorization: "" })).status).toBe(401);
    expect((await post(body, { ...headers, origin: "https://elsewhere.invalid" })).status).toBe(
      403,
    );
    expect((await post(body)).status).toBe(409);
    expect(
      (
        await post(
          JSON.stringify({ requestId: "a".repeat(32), command: "play", runtimeTimeMs: 1000 }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await post(JSON.stringify({ requestId: "a".repeat(32), command: "input" }))).status,
    ).toBe(400);
    expect(
      (
        await post(
          JSON.stringify({
            requestId: "a".repeat(32),
            command: "input",
            cueId: "continue",
            state: {},
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          JSON.stringify({ requestId: "a".repeat(32), command: "poll", cueId: "continue" }),
        )
      ).status,
    ).toBe(400);
  });

  it("does not start a delayed Preview after a later display invalidation", async () => {
    const { host, service, previews } = await setup();
    let entered!: () => void;
    const readingJob = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let resolveJob!: (job: BuildJob) => void;
    service.job = vi.fn(() => {
      entered();
      return new Promise<BuildJob>((resolve) => {
        resolveJob = resolve;
      });
    });
    const load = vi.spyOn(previews, "load");
    const headers = {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/json",
      origin: host.origin,
    };
    const delayed = fetch(`${host.origin}/api/previews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel: "dev", requestId: "a".repeat(32), buildId: "b".repeat(32) }),
    });
    await readingJob;
    expect(
      (await fetch(`${host.origin}/api/preview-display`, { method: "DELETE", headers, body: "{}" }))
        .status,
    ).toBe(204);
    resolveJob({
      buildId: "b".repeat(32),
      channel: "dev",
      revision: "rev",
      generationId: "c".repeat(32),
      status: "succeeded",
      diagnostics: [],
      artifacts: [],
    });
    const response = await delayed;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "preview-request-superseded" });
    expect(load).not.toHaveBeenCalled();
  });
  it("exposes only public authorization status and validates publication commands", async () => {
    const { host } = await setup();
    const headers = {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/json",
      origin: host.origin,
    };
    expect(await (await fetch(`${host.origin}/api/publication-auth`, { headers })).json()).toEqual({
      status: "unconfigured",
    });
    expect(
      (
        await fetch(`${host.origin}/api/publication-auth`, {
          headers,
          method: "DELETE",
          body: "{}",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await fetch(`${host.origin}/api/publications`, {
          headers,
          method: "POST",
          body: JSON.stringify({ requestId: "a".repeat(32), path: "/tmp" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${host.origin}/api/publications`, {
          headers,
          method: "POST",
          body: JSON.stringify({ requestId: "a".repeat(32) }),
        })
      ).status,
    ).toBe(409);
  });
  it("protects Preview load and display receipts with the same origin and bearer boundary", async () => {
    const { host } = await setup();
    const body = JSON.stringify({ requestId: "a".repeat(32), buildIdentity: "build" });
    const headers = {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/json",
      origin: host.origin,
    };
    expect(
      (
        await fetch(`${host.origin}/api/preview-display`, {
          method: "POST",
          body,
          headers: { ...headers, authorization: "" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${host.origin}/api/preview-display`, {
          method: "POST",
          body,
          headers: { ...headers, origin: "https://elsewhere.invalid" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${host.origin}/api/preview-display`, { method: "POST", body, headers })).status,
    ).toBe(409);
    expect(
      (await fetch(`${host.origin}/api/preview-display`, { method: "DELETE", body: "{}", headers }))
        .status,
    ).toBe(204);
    expect(
      (
        await fetch(`${host.origin}/api/previews`, {
          method: "POST",
          headers,
          body: JSON.stringify({ requestId: "a".repeat(32), channel: "dist", path: "/etc/passwd" }),
        })
      ).status,
    ).toBe(400);
  });
  it("requires the ephemeral bearer token even for project reads", async () => {
    const { host, service } = await setup();
    expect((await fetch(`${host.origin}/api/project`)).status).toBe(401);
    expect(service.project).not.toHaveBeenCalled();
    const response = await fetch(`${host.origin}/api/project`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"rev"');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects cross-origin writes and unknown command fields before calling the service", async () => {
    const { host, service } = await setup();
    const headers = {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/json",
      "if-match": '"rev"',
      origin: "https://elsewhere.invalid",
    };
    expect(
      (await fetch(`${host.origin}/api/project`, { method: "PATCH", headers, body: "{}" })).status,
    ).toBe(403);
    headers.origin = host.origin;
    const body = {
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
      command: {
        kind: "setProp",
        instanceId: "one",
        propId: "title",
        value: "new",
        fileName: "secrets",
      },
    };
    expect(
      (
        await fetch(`${host.origin}/api/project`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
    expect(service.patch).not.toHaveBeenCalled();
  });
  it("serves only the trusted editor asset catalog and never project paths", async () => {
    const { host } = await setup();
    const response = await fetch(host.origin);
    expect(response.headers.get("content-length")).toBe("6");
    expect(await response.text()).toBe("editor");
    expect((await fetch(`${host.origin}/unframe.lock`)).status).toBe(404);
    expect((await fetch(`${host.origin}/api/builds/../../secret`)).status).toBe(404);
  });
});

it("returns a bounded-input diagnostic without invoking a save", async () => {
  const { host, service } = await setup();
  const response = await fetch(`${host.origin}/api/project`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${host.token}`,
      origin: host.origin,
      "content-type": "application/json",
      "if-match": '"rev"',
    },
    body: JSON.stringify({
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
      command: { kind: "setProp", instanceId: "a", propId: "title", value: "x".repeat(256 * 1024) },
    }),
  });
  expect(response.status).toBe(413);
  expect(service.patch).not.toHaveBeenCalled();
});

it("rejects a forged Host header before serving trusted assets", async () => {
  const { host } = await setup();
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(host.origin, { headers: { host: "attacker.invalid" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
  expect(status).toBe(403);
});

it("accepts only the fixed Vite origin for development writes and still requires a bearer", async () => {
  const { host } = await setup(true);
  const headers = {
    authorization: `Bearer ${host.token}`,
    "content-type": "application/json",
    origin: "http://127.0.0.1:5174",
  };
  expect(
    (await fetch(`${host.origin}/api/preview-display`, { method: "DELETE", headers, body: "{}" }))
      .status,
  ).toBe(204);
  expect(
    (
      await fetch(`${host.origin}/api/preview-display`, {
        method: "DELETE",
        headers: { ...headers, origin: host.origin },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${host.origin}/api/preview-display`, {
        method: "DELETE",
        headers: { ...headers, authorization: "" },
        body: "{}",
      })
    ).status,
  ).toBe(401);
});

it("keeps unknown publication operations available through receipt queries", async () => {
  const unknown = {
    ok: false as const,
    code: "cli-publish-outcome-unknown" as const,
    outcome: "outcome-unknown" as const,
    operation: {
      presentationId: "p",
      buildId: "fixed",
      publicationEpoch: 2,
      definitionHash: `sha256:${"a".repeat(64)}`,
      renderBundleHash: `sha256:${"b".repeat(64)}`,
      assetSetHash: `sha256:${"c".repeat(64)}`,
    },
  };
  const publish = vi.fn(async () => unknown);
  const query = vi
    .fn()
    .mockResolvedValueOnce(unknown)
    .mockResolvedValueOnce({ ok: true, buildId: "fixed", publicationEpoch: 2 });
  const { host } = await setup(false, { publish, query, close() {} });
  const headers = {
    authorization: `Bearer ${host.token}`,
    "content-type": "application/json",
    origin: host.origin,
  };
  const body = JSON.stringify({ requestId: "a".repeat(32) });
  const unresolved = await fetch(`${host.origin}/api/publications`, {
    method: "POST",
    headers,
    body,
  });
  expect(unresolved.status).toBe(202);
  expect(await unresolved.json()).toEqual(unknown);
  const stillUnknown = await fetch(`${host.origin}/api/publication-status`, {
    method: "POST",
    headers,
    body,
  });
  expect(stillUnknown.status).toBe(202);
  expect(await stillUnknown.json()).toEqual(unknown);
  const confirmed = await fetch(`${host.origin}/api/publication-status`, {
    method: "POST",
    headers,
    body,
  });
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toEqual({ ok: true, buildId: "fixed", publicationEpoch: 2 });
  expect(publish).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(2);
});

it("invalidates Preview only when a build is accepted and forwards connection cancellation", async () => {
  const { host, service, previews } = await setup();
  const invalidate = vi.spyOn(previews, "invalidate");
  const started = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  vi.mocked(service.build).mockImplementation(async (_revision, _requestId, _channel, options) => {
    options?.onAccepted?.();
    started.resolve();
    await new Promise<void>((resolve) =>
      options?.signal?.addEventListener(
        "abort",
        () => {
          disconnected.resolve();
          resolve();
        },
        { once: true },
      ),
    );
    throw Object.assign(new Error("Disconnected"), { status: 409, code: "cli-cancelled" });
  });
  const controller = new AbortController();
  const response = fetch(`${host.origin}/api/builds`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${host.token}`,
      origin: host.origin,
      "content-type": "application/json",
      "if-match": '"rev"',
    },
    body: JSON.stringify({ requestId: "a".repeat(32) }),
  });
  const rejected = expect(response).rejects.toBeDefined();
  await started.promise;
  expect(invalidate).toHaveBeenCalledOnce();
  controller.abort();
  await disconnected.promise;
  await rejected;
});

it("does not invalidate the current Preview when a stale build POST is rejected", async () => {
  const { host, service, previews } = await setup();
  const invalidate = vi.spyOn(previews, "invalidate");
  vi.mocked(service.build).mockRejectedValue(
    new AuthorError(412, "author-revision-mismatch", "Changed"),
  );
  const response = await fetch(`${host.origin}/api/builds`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${host.token}`,
      origin: host.origin,
      "content-type": "application/json",
      "if-match": '"old"',
    },
    body: JSON.stringify({ requestId: "a".repeat(32) }),
  });
  expect(response.status).toBe(412);
  expect(invalidate).not.toHaveBeenCalled();
});

it("authenticates cursor observations, rejects unknown query fields and resumes missed changes", async () => {
  const { host, changes, service } = await setup();
  expect((await fetch(`${host.origin}/api/project/changes`)).status).toBe(401);
  const headers = { authorization: `Bearer ${host.token}` };
  const first = await fetch(`${host.origin}/api/project/changes`, { headers });
  expect(first.status).toBe(200);
  const initial = await first.json();
  expect(initial.changed).toBe(true);
  expect((await fetch(`${host.origin}/api/project/changes?token=secret`, { headers })).status).toBe(
    400,
  );
  expect((await fetch(`${host.origin}/api/project/changes?cursor=bad`, { headers })).status).toBe(
    400,
  );
  expect(
    (
      await fetch(
        `${host.origin}/api/project/changes?cursor=${initial.cursor}&cursor=${initial.cursor}`,
        { headers },
      )
    ).status,
  ).toBe(400);
  const abort = new AbortController();
  const pending = fetch(`${host.origin}/api/project/changes?cursor=${initial.cursor}`, {
    headers,
    signal: abort.signal,
  });
  const cancelled = expect(pending).rejects.toBeDefined();
  abort.abort();
  await cancelled;
  changes.notify();
  const resumed = await fetch(`${host.origin}/api/project/changes?cursor=${initial.cursor}`, {
    headers,
  });
  expect(await resumed.json()).toMatchObject({ changed: true });
  expect(service.project).not.toHaveBeenCalled();
});

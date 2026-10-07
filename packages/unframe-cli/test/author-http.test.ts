import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuthorHost } from "../src/author/http.js";
import type { AuthorService, BuildJob } from "../src/author/contract.js";
import { createLocalPreviewService } from "../src/author/local-preview.js";

const hosts: Awaited<ReturnType<typeof startAuthorHost>>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});
const setup = async () => {
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
  const host = await startAuthorHost({
    service,
    previews,
    assets: new Map([["/", { bytes: new TextEncoder().encode("editor"), mediaType: "text/html" }]]),
  });
  hosts.push(host);
  return { host, service, previews };
};
describe("local author HTTP boundary", () => {
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

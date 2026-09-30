import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuthorHost } from "../src/author/http.js";
import type { AuthorService } from "../src/author/contract.js";

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
  const host = await startAuthorHost({
    service,
    assets: new Map([["/", { bytes: new TextEncoder().encode("editor"), mediaType: "text/html" }]]),
  });
  hosts.push(host);
  return { host, service };
};
describe("local author HTTP boundary", () => {
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
    expect(await (await fetch(host.origin)).text()).toBe("editor");
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

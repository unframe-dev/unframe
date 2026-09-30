import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuthorHost } from "../src/author/http.js";
import type { AuthorService } from "../src/author/contract.js";

const hosts: Array<Awaited<ReturnType<typeof startAuthorHost>>> = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});
const setup = async () => {
  const service: AuthorService = {
    artifact: vi.fn(),
    build: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(async () => {}),
    job: vi.fn(),
    patch: vi.fn(),
    project: vi.fn(async () => ({
      diagnostics: [],
      instances: [],
      irHash: "ir",
      revision: "rev",
      sourceHash: "source",
    })),
  };
  const host = await startAuthorHost({
    assets: new Map([["/", { bytes: new TextEncoder().encode("editor"), mediaType: "text/html" }]]),
    service,
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
      (await fetch(`${host.origin}/api/project`, { body: "{}", headers, method: "PATCH" })).status,
    ).toBe(403);
    headers.origin = host.origin;
    const body = {
      command: {
        fileName: "secrets",
        instanceId: "one",
        kind: "setProp",
        propId: "title",
        value: "new",
      },
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
    };
    expect(
      (
        await fetch(`${host.origin}/api/project`, {
          body: JSON.stringify(body),
          headers,
          method: "PATCH",
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
    body: JSON.stringify({
      command: { instanceId: "a", kind: "setProp", propId: "title", value: "x".repeat(256 * 1024) },
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
    }),
    headers: {
      authorization: `Bearer ${host.token}`,
      "content-type": "application/json",
      "if-match": '"rev"',
      origin: host.origin,
    },
    method: "PATCH",
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

import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { runtimeEnvironment } from "./runtime-environment";

describe("control plane HTTP boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a JSON health response", async () => {
    const response = await SELF.fetch("https://example.com/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("allows credentialed browser requests from the configured web origin", async () => {
    const response = await SELF.fetch("https://api.un-fra.me/presentations", {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "GET",
        origin: "https://un-fra.me",
      },
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://un-fra.me");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("does not grant CORS access to an untrusted origin", async () => {
    const response = await SELF.fetch("https://api.un-fra.me/presentations", {
      headers: { "access-control-request-method": "GET", origin: "https://attacker.example" },
      method: "OPTIONS",
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects cookie-authenticated unsafe requests without the configured origin", async () => {
    const app = createApp();
    app.post("/cookie-write", (context) => context.json({ ok: true }));

    const response = await app.fetch(
      new Request("https://api.un-fra.me/cookie-write", {
        body: "cross-site form body",
        headers: {
          "content-type": "text/plain",
          cookie: "better-auth.session_token=session",
          origin: "https://evil.un-fra.me",
        },
        method: "POST",
      }),
      { ...runtimeEnvironment(), WEB_ORIGIN: "https://un-fra.me" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("allows bearer requests without cookies outside browser origins", async () => {
    const app = createApp();
    app.post("/bearer-write", (context) => context.json({ ok: true }));

    const response = await app.fetch(
      new Request("https://api.un-fra.me/bearer-write", {
        body: "device request",
        headers: { authorization: "Bearer session", "content-type": "text/plain" },
        method: "POST",
      }),
      { ...runtimeEnvironment(), WEB_ORIGIN: "https://un-fra.me" },
    );

    expect(response.status).toBe(200);
  });

  it("returns a JSON 404 response", async () => {
    const response = await SELF.fetch("https://example.com/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });

  it("does not expose internal errors", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp();
    app.get("/throw/:secret", () => {
      throw new Error("database password must not be exposed");
    });

    const response = await app.fetch(
      new Request("https://example.com/throw/sensitive-reset-token"),
      runtimeEnvironment(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "internal_error", message: "Internal Server Error" },
    });
    expect(errorLog).toHaveBeenCalledOnce();

    const log = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
    expect(log).toEqual({
      errorName: "Error",
      event: "unhandled_error",
      incidentId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      method: "GET",
      route: "/throw/:secret",
    });
    expect(response.headers.get("x-unframe-incident-id")).toBe(log.incidentId);
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("database password");
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("sensitive-reset-token");
  });
});

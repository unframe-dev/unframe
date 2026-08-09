import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

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
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "internal_error", message: "Internal Server Error" },
    });
    expect(errorLog).toHaveBeenCalledOnce();

    const log = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
    expect(log).toEqual({
      event: "unhandled_error",
      errorName: "Error",
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

import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

describe("control plane HTTP boundary", () => {
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
    app.get("/throw", () => {
      throw new Error("database password must not be exposed");
    });

    const response = await app.fetch(new Request("https://example.com/throw"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "internal_error", message: "Internal Server Error" },
    });
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({ event: "unhandled_error", method: "GET", path: "/throw" }),
    );
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("database password");
    errorLog.mockRestore();
  });
});

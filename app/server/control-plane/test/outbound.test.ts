import { describe, expect, it } from "vitest";

describe("Test outbound services", () => {
  it("accepts repeated Dash event deliveries", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("https://dash.better-auth.com/events/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventType: "user_created" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
    }
  });

  it.each([
    ["GET", "https://dash.better-auth.com/events/track"],
    ["POST", "https://dash.better-auth.com/unknown"],
    ["POST", "https://unmocked.example.test/events/track"],
    ["POST", "https://unmocked.example.test/events/track?token=secret"],
  ])("rejects unmocked %s requests to %s", async (method, url) => {
    const response = await fetch(url, { method });

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("Unmocked outbound request");
    expect(body).not.toContain("token=secret");
  });
});

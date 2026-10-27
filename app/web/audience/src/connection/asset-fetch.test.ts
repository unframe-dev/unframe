import { describe, expect, it } from "vitest";
import { createAudienceAssetFetch } from "./asset-fetch";
import type { PreparedConnection } from "./join-controller";

const now = Date.parse("2026-10-27T00:00:00Z");
function connection(): Pick<PreparedConnection, "session" | "bootstrap"> {
  return {
    session: { id: "session-1" } as PreparedConnection["session"],
    bootstrap: {
      endpoint: "https://venue.example:9443",
      runtimeKind: "VenueEdge",
      credential: "runtime-private",
      expiresAt: "2026-10-27T00:05:00Z",
    } as PreparedConnection["bootstrap"],
  };
}
const respond: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  return Response.json({
    authorization: request.headers.get("authorization"),
    redirect: request.redirect,
  });
};

describe("Audience asset authorization", () => {
  it("uses the current Runtime credential for the assigned Venue Edge session asset", async () => {
    let current = connection();
    const fetch = createAudienceAssetFetch(() => current, { fetch: respond, now: () => now });
    const url = "https://venue.example:9443/sessions/session-1/assets/image-1";
    expect(await (await fetch(url)).json()).toEqual({
      authorization: "Bearer runtime-private",
      redirect: "error",
    });
    current = { ...current, bootstrap: { ...current.bootstrap, credential: "rotated-private" } };
    expect(await (await fetch(url)).json()).toEqual({
      authorization: "Bearer rotated-private",
      redirect: "error",
    });
  });
  it.each([
    "https://cloud.example/publication-assets/p/b/image?signature=signed",
    "https://venue.example:9444/sessions/session-1/assets/image-1",
    "https://venue.example:9443/sessions/other/assets/image-1",
    "https://venue.example:9443/sessions/session-1/assets/image-1/extra",
    "https://venue.example:9443/sessions/session-1/assets/image-1?redirect=elsewhere",
    "https://venue.example:9443/sessions/session-1/assets/image-1#fragment",
    "https://venue.example:9443/browser/control",
  ])("does not disclose the Runtime credential to %s", async (url) => {
    const fetch = createAudienceAssetFetch(connection, { fetch: respond, now: () => now });
    expect(await (await fetch(url, { headers: { Authorization: "Bearer stale" } })).json()).toEqual(
      { authorization: null, redirect: "error" },
    );
  });
  it("does not attach a Cloud credential even to a matching Runtime asset path", async () => {
    const current = connection();
    current.bootstrap.runtimeKind = "Cloud";
    const fetch = createAudienceAssetFetch(() => current, { fetch: respond, now: () => now });
    expect(
      await (await fetch("https://venue.example:9443/sessions/session-1/assets/image-1")).json(),
    ).toEqual({ authorization: null, redirect: "error" });
  });
  it("rejects an expired Runtime credential before requesting a Venue Edge asset", async () => {
    const current = connection();
    current.bootstrap.expiresAt = "2026-10-27T00:00:00Z";
    const fetch = createAudienceAssetFetch(() => current, { fetch: respond, now: () => now });
    await expect(
      fetch("https://venue.example:9443/sessions/session-1/assets/image-1"),
    ).rejects.toMatchObject({ code: "expired-bootstrap" });
  });
});

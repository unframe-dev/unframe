import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorApi, takeEditorToken } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("author API", () => {
  it("invalidates and confirms display through authenticated writes with empty success bodies", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    const api = createEditorApi("a".repeat(64));
    await expect(api.invalidateDisplay()).resolves.toBeUndefined();
    await expect(api.confirmDisplay("request", "build")).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/preview-display",
      expect.objectContaining({ method: "DELETE", body: "{}" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/preview-display",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ requestId: "request", buildIdentity: "build" }),
      }),
    );
  });
  it("removes the bearer token from browser history before requests", async () => {
    history.replaceState(null, "", "#token=" + "a".repeat(64));
    const token = takeEditorToken();
    expect(token).toBe("a".repeat(64));
    expect(location.hash).toBe("");
  });

  it("sends cancellation to the dedicated build endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            buildId: "b",
            revision: "r",
            status: "cancelled",
            diagnostics: [],
            artifacts: [],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await createEditorApi("a".repeat(64)).cancel("b");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/builds/b/cancellation",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("sends conditional project edits to the same origin", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ revision: "r2", sourceHash: "s2", irHash: "i2", commandId: "c" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const api = createEditorApi("a".repeat(64));
    await api.patch("r1", {
      commandId: "c".repeat(32),
      expectedIrHash: "i1",
      command: { kind: "setProp", instanceId: "one", propId: "label", value: "next" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/project",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          Authorization: `Bearer ${"a".repeat(64)}`,
          "If-Match": '"r1"',
        }),
      }),
    );
  });
});

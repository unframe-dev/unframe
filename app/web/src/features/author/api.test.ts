import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthorApi, takeAuthorToken } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("author API", () => {
  it("removes the bearer token from browser history before requests", async () => {
    history.replaceState(null, "", "#token=" + "a".repeat(64));
    const token = takeAuthorToken();
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
    await createAuthorApi("a".repeat(64)).cancel("b");
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
    const api = createAuthorApi("a".repeat(64));
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

// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { getEditorToken } from "../host-api";

afterEach(() => vi.unstubAllGlobals());

it("obtains a credential from the local Host without a token URL or browser storage", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ token: "a".repeat(64) }));
  vi.stubGlobal("fetch", transport);
  expect(await getEditorToken()).toBe("a".repeat(64));
  expect(transport).toHaveBeenCalledWith("/api/editor-session", {
    method: "POST",
    headers: { "x-unframe-editor": "1" },
    mode: "same-origin",
    credentials: "omit",
    cache: "no-store",
  });
});

it("obtains the current Host credential on each page startup", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "a".repeat(64) }))
      .mockResolvedValueOnce(Response.json({ token: "b".repeat(64) })),
  );
  expect(await getEditorToken()).toBe("a".repeat(64));
  expect(await getEditorToken()).toBe("b".repeat(64));
});

it("reports a rejected connection instead of using an old credential", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
  await expect(getEditorToken()).rejects.toMatchObject({
    status: 403,
    code: "editor-session-unavailable",
  });
});

it.each([{ token: "invalid" }, { token: "a".repeat(64), unexpected: true }, {}])(
  "rejects a malformed Host credential response: %j",
  async (body) => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(getEditorToken()).rejects.toThrow();
  },
);

it("reports an unavailable CLI", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await expect(getEditorToken()).rejects.toThrow("Failed to fetch");
});

import { describe, expect, it } from "vitest";
import { rewriteEditorAssetRequest } from "./index";

describe("rewriteEditorAssetRequest", () => {
  it.each([
    ["https://un-fra.me/editor", "/"],
    ["https://un-fra.me/editor/", "/"],
    ["https://un-fra.me/editor/assets/index.js", "/assets/index.js"],
    ["https://un-fra.me/editor/presentations/demo/view", "/presentations/demo/view"],
  ])("rewrites %s to the static asset path %s", (source, pathname) => {
    const rewritten = rewriteEditorAssetRequest(new Request(source));

    expect(new URL(rewritten.url).pathname).toBe(pathname);
  });

  it("preserves query parameters and request metadata", () => {
    const request = new Request("https://un-fra.me/editor/foo?panel=properties", {
      headers: { "x-request-id": "request-1" },
    });

    const rewritten = rewriteEditorAssetRequest(request);

    expect(new URL(rewritten.url).search).toBe("?panel=properties");
    expect(rewritten.headers.get("x-request-id")).toBe("request-1");
  });

  it("does not rewrite a path that only starts with the same letters", () => {
    const rewritten = rewriteEditorAssetRequest(new Request("https://un-fra.me/editorial/article"));

    expect(new URL(rewritten.url).pathname).toBe("/editorial/article");
  });
});

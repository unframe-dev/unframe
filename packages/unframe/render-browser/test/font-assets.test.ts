import { createHash } from "node:crypto";
import { assert, expect, it } from "vite-plus/test";
import { decodeFontAsset } from "../src/rendering/font-assets.js";
import { testFontAsset } from "./fixtures/static-renderer.js";

it("decodes a 16 MiB font without overflowing the validation stack", () => {
  const font = testFontAsset("Unframe日本語");
  const bytes = Buffer.alloc(16 * 1024 * 1024);
  Buffer.from(font.dataBase64, "base64").copy(bytes);
  const result = decodeFontAsset("panel", {
    mediaType: "font/ttf",
    dataBase64: bytes.toString("base64"),
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });

  assert(!("ok" in result), "Large canonical font must decode successfully");
  expect(result.supports("日".codePointAt(0)!)).toBe(true);
  expect(result.supports("A".codePointAt(0)!)).toBe(false);
});

it.each([
  ["invalid character", "AA?="],
  ["whitespace", "AA==\n"],
  ["extra padding", "AA==="],
  ["missing padding", "AAA"],
  ["nonzero unused bits", "AB=="],
  ["URL-safe alphabet", "__8="],
  ["embedded padding", "AQ=A"],
  ["empty bytes", ""],
])("rejects font base64 with %s", (_description, dataBase64) => {
  expect(decodeFontAsset("panel", { ...testFontAsset("A"), dataBase64 })).toMatchObject({
    ok: false,
    diagnostics: [
      {
        code: "invalid-font-asset",
        message: "Font asset data must be canonical base64.",
        path: ["fontAssets", "panel", "dataBase64"],
      },
    ],
  });
});

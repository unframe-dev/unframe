import { expect, it } from "vitest";
import { validateOpaqueAsset } from "../src/opaque/capture/assets.js";

it.each([
  "image/svg+xml",
  "image/gif",
  "image/avif",
  "font/woff",
  "font/woff2",
  "application/javascript",
])("rejects unsupported capture media %s", (mediaType) => {
  expect(validateOpaqueAsset({ path: "asset.bin", mediaType, dataBase64: "AA==" })).toBe(false);
});
it("rejects an image whose bytes disagree with its extension and media type", () => {
  expect(
    validateOpaqueAsset({
      path: "image.png",
      mediaType: "image/png",
      dataBase64: Buffer.from("<svg/>").toString("base64"),
    }),
  ).toBe(false);
});
it("rejects animated WebP before browser decoding", () => {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBPVP8X", 8);
  bytes[20] = 2;
  expect(
    validateOpaqueAsset({
      path: "image.webp",
      mediaType: "image/webp",
      dataBase64: bytes.toString("base64"),
    }),
  ).toBe(false);
});
it.each(["theme.css", "theme.CSS", "theme.CsS"])(
  "accepts CSS capture asset %s without changing its path",
  (path) => {
    expect(
      validateOpaqueAsset({
        path,
        mediaType: "text/css",
        dataBase64: Buffer.from("main { color: red; }").toString("base64"),
      }),
    ).toBe(true);
  },
);
it.each(["theme.CSS.map", "theme.CSS.MAP", "theme.css.js"])(
  "rejects non-stylesheet capture asset %s declared as CSS",
  (path) => {
    expect(
      validateOpaqueAsset({
        path,
        mediaType: "text/css",
        dataBase64: Buffer.from("{}").toString("base64"),
      }),
    ).toBe(false);
  },
);

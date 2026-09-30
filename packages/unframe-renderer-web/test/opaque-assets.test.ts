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
  expect(validateOpaqueAsset({ dataBase64: "AA==", mediaType, path: "asset.bin" })).toBe(false);
});
it("rejects an image whose bytes disagree with its extension and media type", () => {
  expect(
    validateOpaqueAsset({
      dataBase64: Buffer.from("<svg/>").toString("base64"),
      mediaType: "image/png",
      path: "image.png",
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
      dataBase64: bytes.toString("base64"),
      mediaType: "image/webp",
      path: "image.webp",
    }),
  ).toBe(false);
});

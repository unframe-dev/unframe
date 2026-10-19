import { createHash } from "node:crypto";
import * as z from "zod";
import { parseStrictJson } from "./strict-json.js";

export const buildReceiptSchema = z.strictObject({
  generationId: z.string().regex(/^[0-9a-f]{32}$/),
  buildManifestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

export const buildManifestBytesHash = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const encodeBuildReceipt = (generationId: string, buildManifest: Uint8Array) =>
  new TextEncoder().encode(
    JSON.stringify({ generationId, buildManifestHash: buildManifestBytesHash(buildManifest) }),
  );

export const parseBuildReceipt = (bytes: Uint8Array) => {
  if (!parseStrictJson(bytes).ok) throw new Error("Invalid build receipt JSON.");
  return buildReceiptSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
};

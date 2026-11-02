import { createHash } from "node:crypto";
export const checksumBytes = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

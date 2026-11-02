import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const samplePorts = {
  controlPlane: 18443,
  realtime: 18444,
  worker: 17887,
  grpc: 18090,
} as const;
export async function cleanupSample(
  revoke: () => Promise<void>,
  stopServices: () => Promise<void>,
  releaseLock: () => Promise<void>,
): Promise<boolean> {
  let succeeded = true;
  for (const action of [revoke, stopServices, releaseLock]) {
    try {
      await action();
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}

export type SampleConnection = Readonly<{
  version: 1;
  controlPlaneOrigin: string;
  sessionId: string;
  credential: string;
  caFile: string;
  expiresAt: string;
  advanceLogicalEvent: string;
  presentationId: string;
  buildId: string;
}>;
export function sessionExpiry(now: number, credentialExpiry: number, runExpiry: number): string {
  const expiry = Math.min(credentialExpiry, runExpiry);
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error("Sample session expired.");
  return new Date(expiry).toISOString();
}
export async function advertiseConnection(path: string, connection: SampleConnection) {
  const bytes = JSON.stringify(connection, null, 2) + "\n";
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return async () => {
    try {
      if ((await readFile(path, "utf8")) === bytes) await rm(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}

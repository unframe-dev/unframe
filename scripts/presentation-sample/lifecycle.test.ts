import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { advertiseConnection, cleanupSample, samplePorts, sessionExpiry } from "./lifecycle.ts";

test("failed advertisement removal still stops services and releases the launcher lock", async () => {
  const steps: string[] = [];
  const cleaned = await cleanupSample(
    async () => {
      steps.push("revoke");
      throw new Error("private filesystem failure");
    },
    async () => {
      steps.push("stop");
    },
    async () => {
      steps.push("unlock");
    },
  );
  assert.equal(cleaned, false);
  assert.deepEqual(steps, ["revoke", "stop", "unlock"]);
});

test("sample listeners are distinct and leases cannot outlive the credential", () => {
  assert.equal(new Set(Object.values(samplePorts)).size, 4);
  assert.equal(sessionExpiry(1_000, 2_000, 3_000), new Date(2_000).toISOString());
  assert.throws(() => sessionExpiry(2_000, 2_000, 3_000), /expired/);
});

test("connection advertisement is private and cleanup cannot remove another run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-sample-"));
  try {
    const path = join(directory, "active-connection.json");
    const connection = {
      version: 1 as const,
      controlPlaneOrigin: "https://localhost:18443",
      sessionId: "session",
      credential: "secret",
      caFile: "/private/ca.pem",
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      advanceLogicalEvent: "",
      presentationId: "presentation",
      buildId: "build",
    };
    const revoke = await advertiseConnection(path, connection);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), connection);
    await writeFile(path, '{"sessionId":"other"}');
    await revoke();
    assert.equal(await readFile(path, "utf8"), '{"sessionId":"other"}');
    const revokeOwn = await advertiseConnection(path, connection);
    await revokeOwn();
    await assert.rejects(readFile(path), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

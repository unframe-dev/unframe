import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, expect, it, vi } from "vite-plus/test";
import {
  acquireSourceLock,
  discoverPresentationProjectFiles,
  NativeFilesystem,
  publishProjectBuild,
  readExpectedBuildGeneration,
} from "../src/index.js";

it("keeps artifact staging outside the Source lease and project input snapshot", async () => {
  const project = await mkdtemp(join(tmpdir(), "unframe-output-staging-"));
  const write = NativeFilesystem.prototype.write;
  const leaseAvailability: boolean[] = [];
  const revisions: (string | undefined)[] = [];
  try {
    await writeFile(
      join(project, "unframe.config.ts"),
      'export default {entryFile:"presentation.ts"};',
    );
    await writeFile(join(project, "unframe.lock"), "{}");
    await writeFile(join(project, "presentation.ts"), "export default {};");
    const captured = await discoverPresentationProjectFiles(project);
    assert(captured.ok);
    vi.spyOn(NativeFilesystem.prototype, "write").mockImplementation(async function (
      this: NativeFilesystem,
      path,
      bytes,
    ) {
      const lease = await acquireSourceLock(project);
      leaseAvailability.push(lease.ok);
      if (lease.ok) await lease.value.release();
      await write.call(this, path, bytes);
      const current = await discoverPresentationProjectFiles(project, { sourceLeaseHeld: true });
      revisions.push(current.ok ? current.revision : undefined);
    });
    const result = await publishProjectBuild({
      projectDirectory: project,
      revision: captured.revision,
      expectedGeneration: null,
      artifacts: {
        definition: new Uint8Array(),
        renderBundle: new Uint8Array(),
        assetSet: new Uint8Array(),
        buildManifest: new Uint8Array(),
        assets: [],
      },
    });
    expect(result, JSON.stringify(result)).toMatchObject({
      kind: "publication",
      result: { ok: true },
    });
    expect(leaseAvailability.length).toBeGreaterThan(0);
    expect(leaseAvailability.every(Boolean)).toBe(true);
    expect(revisions.every((revision) => revision === captured.revision)).toBe(true);
  } finally {
    vi.restoreAllMocks();
    await rm(project, { recursive: true, force: true });
  }
});

it("distinguishes a missing output from an unmanaged one", async () => {
  const project = await mkdtemp(join(tmpdir(), "unframe-output-inspect-"));
  try {
    await expect(readExpectedBuildGeneration(project, "dist")).resolves.toBeNull();
    await writeFile(join(project, "dist"), "unmanaged");
    await expect(readExpectedBuildGeneration(project, "dist")).rejects.toThrow();
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

it("does not publish while another Source writer owns the lease", async () => {
  const project = await mkdtemp(join(tmpdir(), "unframe-output-lease-"));
  try {
    const held = await acquireSourceLock(project);
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    try {
      const result = await publishProjectBuild({
        projectDirectory: project,
        revision: "sha256:stale",
        artifacts: {
          definition: new Uint8Array(),
          renderBundle: new Uint8Array(),
          assetSet: new Uint8Array(),
          buildManifest: new Uint8Array(),
          assets: [],
        },
      });
      expect(result).toMatchObject({ kind: "lease-error" });
    } finally {
      await held.value.release();
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

it("rejects publication when the project revision cannot be rediscovered", async () => {
  const project = await mkdtemp(join(tmpdir(), "unframe-output-stale-"));
  try {
    const result = await publishProjectBuild({
      projectDirectory: project,
      revision: "sha256:old",
      expectedGeneration: null,
      artifacts: {
        definition: new Uint8Array(),
        renderBundle: new Uint8Array(),
        assetSet: new Uint8Array(),
        buildManifest: new Uint8Array(),
        assets: [],
      },
    });
    expect(result).toMatchObject({
      kind: "publication",
      result: { ok: false, code: "cli-output-stale" },
    });
    await expect(readExpectedBuildGeneration(project, "dist")).resolves.toBeNull();
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

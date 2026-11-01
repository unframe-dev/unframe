import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  acquireSourceLock,
  publishProjectBuild,
  readExpectedBuildGeneration,
} from "../src/index.js";

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

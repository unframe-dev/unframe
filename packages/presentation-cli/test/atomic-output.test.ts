import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { publishAtomicArtifacts } from "../src/filesystem/atomic-output.js";

const directories: string[] = [];
const encoder = new TextEncoder();

const project = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-atomic-output-"));
  directories.push(directory);
  return directory;
};

const artifacts = (suffix = "one") => ({
  definition: encoder.encode(`definition-${suffix}`),
  renderBundle: encoder.encode(`bundle-${suffix}`),
  assets: [
    { assetId: "z asset", bytes: encoder.encode(`z-${suffix}`) },
    { assetId: "a/asset", bytes: encoder.encode(`a-${suffix}`) },
  ],
});

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("atomic artifact publication", () => {
  it("writes a complete first generation and atomically replaces it on a second build", async () => {
    const directory = await project();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "a".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await readlink(join(directory, "dist"))).toBe(
      ".unframe/generations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts("two"),
        generationId: () => "b".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await readlink(join(directory, "dist"))).toBe(
      ".unframe/generations/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    await expect(readFile(join(directory, "dist", "definition.json"), "utf8")).resolves.toBe(
      "definition-two",
    );
  });

  it("uses deterministic file bytes and encoded asset paths", async () => {
    const directory = await project();
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts(),
      generationId: () => "c".repeat(32),
    });
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts(),
      generationId: () => "d".repeat(32),
    });
    const first = join(directory, ".unframe/generations", "c".repeat(32));
    const second = join(directory, ".unframe/generations", "d".repeat(32));
    await expect(readFile(join(first, "assets", "a%2Fasset.png"))).resolves.toEqual(
      await readFile(join(second, "assets", "a%2Fasset.png")),
    );
    await expect(readFile(join(first, "definition.json"))).resolves.toEqual(
      await readFile(join(second, "definition.json")),
    );
  });

  it("refuses unmanaged output and leaves it untouched", async () => {
    const directory = await project();
    await writeFile(join(directory, "dist"), "user output");
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "e".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(readFile(join(directory, "dist"), "utf8")).resolves.toBe("user output");
  });

  it.each([
    ["absolute", "/tmp/outside"],
    ["external", "../outside"],
    ["malformed", ".unframe/generations/not-an-id"],
    ["dangling", ".unframe/generations/0123456789abcdef0123456789abcdef"],
  ])("refuses %s dist symlinks", async (_kind, target) => {
    const directory = await project();
    await mkdir(join(directory, ".unframe/generations"), { recursive: true });
    await symlink(target, join(directory, "dist"));
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "0".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(readlink(join(directory, "dist"))).resolves.toBe(target);
  });

  it("refuses a dist directory and nested .unframe symlink", async () => {
    const directory = await project();
    await mkdir(join(directory, "dist"));
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "9".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });

    const second = await project();
    const external = await project();
    await symlink(external, join(second, ".unframe"));
    await expect(
      publishAtomicArtifacts({
        projectDirectory: second,
        artifacts: artifacts(),
        generationId: () => "8".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
  });

  it("rejects malformed generation IDs and duplicate encoded asset paths without publishing partial output", async () => {
    const directory = await project();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "not-an-id",
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();

    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        generationId: () => "f".repeat(32),
        artifacts: {
          ...artifacts(),
          assets: [
            { assetId: "x", bytes: encoder.encode("a") },
            { assetId: "x", bytes: encoder.encode("b") },
          ],
        },
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });

  it("cancels before the first phase without publishing output", async () => {
    const directory = await project();
    const controller = new AbortController();
    controller.abort();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "1".repeat(32),
        signal: controller.signal,
      }),
    ).resolves.toEqual({ ok: false, family: "cancel", code: "cli-output-cancel" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });

  it("cleans only this staging directory and preserves the previous dist on a mid-phase cancel", async () => {
    const directory = await project();
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("previous"),
      generationId: () => "2".repeat(32),
    });
    const controller = new AbortController();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts("cancelled"),
        generationId: () => "3".repeat(32),
        signal: controller.signal,
        testing: {
          onPhase: (phase) => {
            if (phase === "staging-created") controller.abort();
          },
        },
      }),
    ).resolves.toEqual({ ok: false, family: "cancel", code: "cli-output-cancel" });
    await expect(readlink(join(directory, "dist"))).resolves.toBe(
      ".unframe/generations/22222222222222222222222222222222",
    );
    await expect(
      lstat(join(directory, ".unframe/generations/.staging-33333333333333333333333333333333")),
    ).rejects.toThrow();
  });

  it("rejects an asset ID with a lone surrogate without publishing output", async () => {
    const directory = await project();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        generationId: () => "4".repeat(32),
        artifacts: {
          ...artifacts(),
          assets: [{ assetId: "\ud800", bytes: encoder.encode("asset") }],
        },
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });

  it("does not publish partial output when a write path becomes unsafe", async () => {
    const directory = await project();
    const external = await project();
    let changed = false;
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        generationId: () => "5".repeat(32),
        artifacts: artifacts(),
        testing: {
          onPhase: async (phase) => {
            if (phase !== "artifact-written" || changed) return;
            changed = true;
            const assets = join(
              directory,
              ".unframe/generations/.staging-55555555555555555555555555555555/assets",
            );
            await rm(assets, { force: true, recursive: true });
            await symlink(external, assets);
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
    await expect(
      lstat(join(directory, ".unframe/generations/.staging-55555555555555555555555555555555")),
    ).rejects.toThrow();
  });

  it("does not remove a staging path that is replaced after it is created", async () => {
    const directory = await project();
    const id = "6".repeat(32);
    const staging = join(directory, ".unframe/generations", `.staging-${id}`);
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => id,
        testing: {
          onPhase: async (phase) => {
            if (phase !== "staging-created") return;
            await rm(staging, { force: true, recursive: true });
            await mkdir(staging, { mode: 0o700 });
            await writeFile(join(staging, "replacement.txt"), "do not remove");
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
    await expect(readFile(join(staging, "replacement.txt"), "utf8")).resolves.toBe("do not remove");
  });

  it("does not overwrite an unmanaged dist inserted after the managed-output check", async () => {
    const directory = await project();
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("previous"),
      generationId: () => "7".repeat(32),
    });
    const external = await project();
    await writeFile(join(external, "sentinel.txt"), "user output");
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts("next"),
        generationId: () => "8".repeat(32),
        testing: {
          onPhase: async (phase) => {
            if (phase !== "before-dist-replace") return;
            await unlink(join(directory, "dist"));
            await symlink("../external-output", join(directory, "dist"));
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(readlink(join(directory, "dist"))).resolves.toBe("../external-output");
    await expect(readFile(join(external, "sentinel.txt"), "utf8")).resolves.toBe("user output");
  });

  it("does not create a first dist when output appears after the absent-dist check", async () => {
    const directory = await project();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "9".repeat(32),
        testing: {
          onPhase: async (phase) => {
            if (phase !== "before-dist-replace") return;
            await symlink("user-managed-output", join(directory, "dist"));
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false, family: "io" });
    await expect(readlink(join(directory, "dist"))).resolves.toBe("user-managed-output");
  });

  it("cancels before generation rename and preserves the previous dist", async () => {
    const directory = await project();
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("previous"),
      generationId: () => "a".repeat(32),
    });
    const controller = new AbortController();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts("cancelled"),
        generationId: () => "b".repeat(32),
        signal: controller.signal,
        testing: {
          onPhase: (phase) => {
            if (phase === "before-generation-rename") controller.abort();
          },
        },
      }),
    ).resolves.toEqual({ ok: false, family: "cancel", code: "cli-output-cancel" });
    await expect(readlink(join(directory, "dist"))).resolves.toBe(
      ".unframe/generations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    await expect(lstat(join(directory, ".unframe/generations", "b".repeat(32)))).rejects.toThrow();
  });

  it("cancels before dist replacement without publishing a first dist", async () => {
    const directory = await project();
    const controller = new AbortController();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "c".repeat(32),
        signal: controller.signal,
        testing: {
          onPhase: (phase) => {
            if (phase === "before-dist-replace") controller.abort();
          },
        },
      }),
    ).resolves.toEqual({ ok: false, family: "cancel", code: "cli-output-cancel" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });

  it("reports an initial dist metadata access failure as I/O instead of missing output", async () => {
    const directory = await project();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "d".repeat(32),
        testing: {
          lstat: async (path) => {
            if (path === join(directory, "dist")) {
              throw Object.assign(new Error("permission denied"), { code: "EACCES" });
            }
            return lstat(path);
          },
        },
      }),
    ).resolves.toEqual({ ok: false, family: "io", code: "cli-output-io" });
  });

  it("reports an absent-dist recheck metadata failure as I/O without publishing dist", async () => {
    const directory = await project();
    let distLookups = 0;
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "e".repeat(32),
        testing: {
          lstat: async (path) => {
            if (path === join(directory, "dist") && ++distLookups === 2) {
              throw Object.assign(new Error("I/O error"), { code: "EIO" });
            }
            return lstat(path);
          },
        },
      }),
    ).resolves.toEqual({ ok: false, family: "io", code: "cli-output-io" });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });
});

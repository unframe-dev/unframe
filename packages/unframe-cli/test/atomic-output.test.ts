import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeFilesystem } from "../src/filesystem/native-filesystem.js";
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
  assetSet: encoder.encode(`assets-${suffix}`),
  buildManifest: encoder.encode(`build-${suffix}`),
  assets: [
    { assetId: "z asset", mediaType: "image/png" as const, bytes: encoder.encode(`z-${suffix}`) },
    { assetId: "a/asset", mediaType: "image/png" as const, bytes: encoder.encode(`a-${suffix}`) },
  ],
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("atomic artifact publication", () => {
  it("publishes GLB bytes under an encoded logical Asset ID", async () => {
    const directory = await project();
    const bytes = Uint8Array.of(0x67, 0x6c, 0x54, 0x46);
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: {
        ...artifacts(),
        assets: [{ assetId: "models/chair", mediaType: "model/gltf-binary", bytes }],
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(
      new Uint8Array(await readFile(join(directory, "dist/assets/models%2Fchair.glb"))),
    ).toEqual(bytes);
  });

  it("creates output directories inside the owned parent when its visible path is replaced", async () => {
    const directory = await project();
    const outside = await project();
    const originalMkdir = NativeFilesystem.prototype.mkdir;
    let replaced = false;
    vi.spyOn(NativeFilesystem.prototype, "mkdir").mockImplementation(
      async function (this: NativeFilesystem, path) {
        if (!replaced && path.endsWith("/generations")) {
          replaced = true;
          const unframe = join(directory, ".unframe");
          await rename(unframe, `${unframe}-owned`);
          await symlink(outside, unframe);
        }
        return originalMkdir.call(this, path);
      },
    );
    expect(
      await publishAtomicArtifacts({ projectDirectory: directory, artifacts: artifacts() }),
    ).toMatchObject({ ok: false, family: "io" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("keeps artifact writes pinned when a parent is replaced after the identity check", async () => {
    const directory = await project();
    const outside = await project();
    const generations = join(directory, ".unframe/generations");
    const id = "1".repeat(32);
    await mkdir(join(outside, `.staging-${id}`, "assets"), { recursive: true });
    const originalWrite = NativeFilesystem.prototype.write;
    let replaced = false;
    vi.spyOn(NativeFilesystem.prototype, "write").mockImplementation(
      async function (this: NativeFilesystem, path, bytes) {
        if (!replaced) {
          replaced = true;
          await rename(generations, `${generations}-owned`);
          await symlink(outside, generations);
        }
        return originalWrite.call(this, path, bytes);
      },
    );
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      generationId: () => id,
      artifacts: artifacts(),
    });
    expect(result).toMatchObject({ ok: false, family: "io" });
    expect(await readdir(join(outside, `.staging-${id}`))).toEqual(["assets"]);
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });

  it("rejects publication when the visible parent changes during pointer rename", async () => {
    const directory = await project();
    const outside = await project();
    const id = "2".repeat(32);
    const originalRename = NativeFilesystem.prototype.rename;
    let swapped = false;
    vi.spyOn(NativeFilesystem.prototype, "rename").mockImplementation(
      async function (this: NativeFilesystem, path, target) {
        if (!swapped && target.endsWith("/current")) {
          swapped = true;
          const preview = join(directory, ".unframe/preview");
          await rename(preview, `${preview}-owned`);
          await symlink(outside, preview);
          await symlink("outside-output", join(outside, "current"));
          await symlink("outside-temporary", join(outside, `.current-${id}`));
        }
        return originalRename.call(this, path, target);
      },
    );
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      channel: "dev",
      generationId: () => id,
      artifacts: artifacts(),
    });
    expect(result).toMatchObject({ ok: false, family: "io", detail: { stage: "replace-dist" } });
    expect(await readdir(outside)).toEqual([`.current-${id}`, "current"]);
    expect(await readlink(join(outside, "current"))).toBe("outside-output");
  });

  it.each(["dev", "dist"] as const)(
    "rejects publication when the visible %s pointer is replaced during rename",
    async (channel) => {
      const directory = await project();
      const pointerName = channel === "dev" ? "current" : "dist";
      const pointerPath = join(directory, channel === "dev" ? ".unframe/preview/current" : "dist");
      const operation = channel === "dev" ? "rename" : "renameNoReplace";
      const originalRename = NativeFilesystem.prototype[operation];
      vi.spyOn(NativeFilesystem.prototype, operation).mockImplementation(
        async function (this: NativeFilesystem, path, target) {
          await originalRename.call(this, path, target);
          if (target.endsWith(`/${pointerName}`)) {
            await rm(pointerPath, { recursive: true, force: true });
            await symlink("user-output", pointerPath);
          }
        },
      );
      const result = await publishAtomicArtifacts({
        projectDirectory: directory,
        channel,
        artifacts: artifacts(),
      });
      expect(result).toMatchObject({ ok: false, family: "io", detail: { stage: "replace-dist" } });
      expect(await readlink(pointerPath)).toBe("user-output");
    },
  );

  it.each(["dev", "dist"] as const)(
    "keeps the last %s generation on stale or cancelled updates",
    async (channel) => {
      const directory = await project();
      const pointer = channel === "dev" ? ".unframe/preview/current" : "dist";
      await publishAtomicArtifacts({
        projectDirectory: directory,
        channel,
        artifacts: artifacts(),
      });
      const previous = await readFile(join(directory, pointer, "definition.json"), "utf8");
      const stale = await publishAtomicArtifacts({
        projectDirectory: directory,
        channel,
        artifacts: artifacts("stale"),
        isCurrentRevision: async () => false,
      });
      expect(stale).toEqual({ ok: false, family: "io", code: "cli-output-stale" });
      const controller = new AbortController();
      const cancelled = await publishAtomicArtifacts({
        projectDirectory: directory,
        channel,
        artifacts: artifacts("cancelled"),
        signal: controller.signal,
        testing: {
          onPhase: (phase) => {
            if (phase === "before-dist-replace") controller.abort();
          },
        },
      });
      expect(cancelled).toEqual({ ok: false, family: "cancel", code: "cli-output-cancel" });
      expect(await readFile(join(directory, pointer, "definition.json"), "utf8")).toBe(previous);
      expect(
        await readdir(
          join(
            directory,
            channel === "dev" ? ".unframe/preview/generations" : ".unframe/generations",
          ),
        ),
      ).toHaveLength(1);
    },
  );

  it.each(["../outside", ".unframe/generations/" + "a".repeat(32), "generations/not-an-id"])(
    "refuses an unmanaged Dev pointer to %s",
    async (target) => {
      const directory = await project();
      await mkdir(join(directory, ".unframe/preview"), { recursive: true });
      await symlink(target, join(directory, ".unframe/preview/current"));
      expect(
        await publishAtomicArtifacts({
          projectDirectory: directory,
          channel: "dev",
          artifacts: artifacts(),
        }),
      ).toMatchObject({ ok: false, family: "io" });
      expect(await readlink(join(directory, ".unframe/preview/current"))).toBe(target);
    },
  );

  it("refuses a symlinked Dev directory without writing outside the project", async () => {
    const directory = await project();
    const outside = await project();
    await mkdir(join(directory, ".unframe"));
    await symlink(outside, join(directory, ".unframe/preview"));
    expect(
      await publishAtomicArtifacts({
        projectDirectory: directory,
        channel: "dev",
        artifacts: artifacts(),
      }),
    ).toMatchObject({ ok: false, family: "io" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("publishes Dev generations without changing the Dist pointer or bytes", async () => {
    const directory = await project();
    await publishAtomicArtifacts({ projectDirectory: directory, artifacts: artifacts("dist") });
    const dist = await readFile(join(directory, "dist/build-receipt.json"), "utf8");
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      channel: "dev",
      artifacts: artifacts("dev"),
      generationId: () => "a".repeat(32),
    });
    expect(result).toEqual({ ok: true, generationId: "a".repeat(32) });
    expect(await readlink(join(directory, ".unframe/preview/current"))).toBe(
      "generations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(
      await readFile(join(directory, ".unframe/preview/current/definition.json"), "utf8"),
    ).toBe("definition-dev");
    expect(await readFile(join(directory, "dist/build-receipt.json"), "utf8")).toBe(dist);
    expect(await readFile(join(directory, "dist/definition.json"), "utf8")).toBe("definition-dist");
  });

  it("preserves JPEG asset bytes at the path consumed by publish", async () => {
    const directory = await project();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: {
        ...artifacts(),
        assets: [{ assetId: "photo/cover", mediaType: "image/jpeg", bytes: jpeg }],
      },
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(directory, "dist/assets/photo%2Fcover.jpg"))).toEqual(
      Buffer.from(jpeg),
    );
  });

  it("keeps the successful generation when its source revision expires during staging", async () => {
    const directory = await project();
    const initial = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts(),
    });
    expect(initial.ok).toBe(true);
    const previous = await readFile(join(directory, "dist/build-receipt.json"), "utf8");
    let current = true;
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("stale"),
      isCurrentRevision: async () => current,
      testing: {
        onPhase: (phase) => {
          if (phase === "before-dist-replace") current = false;
        },
      },
    });
    expect(result).toEqual({ ok: false, family: "io", code: "cli-output-stale" });
    expect(await readFile(join(directory, "dist/build-receipt.json"), "utf8")).toBe(previous);
    expect(await readdir(join(directory, ".unframe/generations"))).toHaveLength(1);
    expect(await readFile(join(directory, "dist/definition.json"), "utf8")).toBe("definition-one");
  });

  it("publishes all v2 manifests and preserves font bytes with their media type", async () => {
    const directory = await project();
    const value = artifacts();
    const font = new Uint8Array([0, 1, 0, 0]);
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: {
        ...value,
        assets: [...value.assets, { assetId: "font", mediaType: "font/ttf", bytes: font }],
      },
    });
    expect(result.ok).toBe(true);
    expect(await readFile(join(directory, "dist/asset-set.json"))).toEqual(
      Buffer.from(value.assetSet),
    );
    expect(await readFile(join(directory, "dist/build-manifest.json"))).toEqual(
      Buffer.from(value.buildManifest),
    );
    expect(await readFile(join(directory, "dist/assets/font.ttf"))).toEqual(Buffer.from(font));
  });
  it("writes a complete first generation and atomically replaces it on a second build", async () => {
    const directory = await project();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        generationId: () => "a".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      JSON.parse(await readFile(join(directory, "dist/build-receipt.json"), "utf8")).generationId,
    ).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect((await lstat(join(directory, "dist"))).isDirectory()).toBe(true);

    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts("two"),
        generationId: () => "b".repeat(32),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      JSON.parse(await readFile(join(directory, "dist/build-receipt.json"), "utf8")).generationId,
    ).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect((await lstat(join(directory, "dist"))).isDirectory()).toBe(true);
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
            { assetId: "x", mediaType: "image/png" as const, bytes: encoder.encode("a") },
            { assetId: "x", mediaType: "image/png" as const, bytes: encoder.encode("b") },
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
    expect(
      JSON.parse(await readFile(join(directory, "dist/build-receipt.json"), "utf8")).generationId,
    ).toBe("22222222222222222222222222222222");
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
          assets: [
            { assetId: "\ud800", mediaType: "image/png" as const, bytes: encoder.encode("asset") },
          ],
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
            await rm(join(directory, "dist"), { recursive: true, force: true });
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
    expect(
      JSON.parse(await readFile(join(directory, "dist/build-receipt.json"), "utf8")).generationId,
    ).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
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
    ).resolves.toEqual({
      ok: false,
      family: "io",
      code: "cli-output-io",
      detail: { stage: "inspect-dist", code: "EACCES" },
    });
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
    ).resolves.toEqual({
      ok: false,
      family: "io",
      code: "cli-output-io",
      detail: { stage: "verify-generation", code: "EIO" },
    });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });

  it("does not expose hostile error metadata while reporting a publication failure", async () => {
    const directory = await project();
    await expect(
      publishAtomicArtifacts({
        projectDirectory: directory,
        artifacts: artifacts(),
        testing: {
          lstat: async () => {
            throw Object.assign(new Error("private detail"), { code: "EPRIVATE" });
          },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      family: "io",
      code: "cli-output-io",
      detail: { stage: "inspect-dist" },
    });
  });

  it("identifies the file operation when synchronization fails", async () => {
    const directory = await project();
    vi.spyOn(NativeFilesystem.prototype, "write").mockRejectedValueOnce(
      Object.assign(new Error("bad file descriptor"), { code: "EBADF", operation: "sync" }),
    );

    await expect(
      publishAtomicArtifacts({ projectDirectory: directory, artifacts: artifacts() }),
    ).resolves.toEqual({
      ok: false,
      family: "io",
      code: "cli-output-io",
      detail: { stage: "write-artifacts", operation: "sync", code: "EBADF" },
    });
  });
  it("restores the previous Dist if visible publication verification fails after exchange", async () => {
    const directory = await project();
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("previous"),
      generationId: () => "1".repeat(32),
    });
    const originalExchange = NativeFilesystem.prototype.exchange;
    let corrupted = false;
    vi.spyOn(NativeFilesystem.prototype, "exchange").mockImplementation(
      async function (this: NativeFilesystem, path, target) {
        await originalExchange.call(this, path, target);
        if (!corrupted) {
          corrupted = true;
          await writeFile(join(directory, "dist/definition.json"), "corrupted");
        }
      },
    );
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("next"),
      generationId: () => "2".repeat(32),
    });
    expect(result).toMatchObject({ ok: false, code: "cli-output-io" });
    expect(await readFile(join(directory, "dist/definition.json"), "utf8")).toBe(
      "definition-previous",
    );
    expect(await readdir(join(directory, ".unframe/generations"))).toEqual(["1".repeat(32)]);
    expect(await readdir(directory)).toEqual([".unframe", "dist"]);
  });

  it("rejects modified staged Dist bytes while keeping the successful directory", async () => {
    const directory = await project();
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("previous"),
      generationId: () => "3".repeat(32),
    });
    const id = "4".repeat(32);
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("next"),
      generationId: () => id,
      testing: {
        onPhase: async (phase) => {
          if (phase === "before-dist-replace")
            await writeFile(join(directory, `.dist-${id}/definition.json`), "corrupted");
        },
      },
    });
    expect(result).toMatchObject({ ok: false, code: "cli-output-io" });
    expect(await readFile(join(directory, "dist/definition.json"), "utf8")).toBe(
      "definition-previous",
    );
  });
  it("restores a competing directory inserted during the revision check instead of publishing over it", async () => {
    const directory = await project();
    await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("previous"),
      generationId: () => "a".repeat(32),
    });
    const competitor = join(directory, "competitor");
    const displaced = join(directory, "previous-dist");
    await mkdir(competitor);
    await writeFile(join(competitor, "sentinel.txt"), "competing output");
    const expected = await lstat(competitor);
    let revisionChecks = 0;
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts("next"),
      generationId: () => "b".repeat(32),
      isCurrentRevision: async () => {
        if (revisionChecks++ === 0) {
          await rename(join(directory, "dist"), displaced);
          await rename(competitor, join(directory, "dist"));
        }
        return true;
      },
    });
    expect(result).toMatchObject({ ok: false, code: "cli-output-io" });
    const actual = await lstat(join(directory, "dist"));
    expect({ dev: actual.dev, ino: actual.ino }).toEqual({ dev: expected.dev, ino: expected.ino });
    expect(await readFile(join(directory, "dist/sentinel.txt"), "utf8")).toBe("competing output");
    expect(await readFile(join(displaced, "definition.json"), "utf8")).toBe("definition-previous");
    expect(await readdir(directory)).toEqual([".unframe", "dist", "previous-dist"]);
    expect(await readdir(join(directory, ".unframe/generations"))).toEqual(["a".repeat(32)]);
  });

  it("preserves an empty directory inserted during the first publication revision check", async () => {
    const directory = await project();
    let inserted: Awaited<ReturnType<typeof lstat>> | undefined;
    const result = await publishAtomicArtifacts({
      projectDirectory: directory,
      artifacts: artifacts(),
      generationId: () => "c".repeat(32),
      isCurrentRevision: async () => {
        if (!inserted) {
          await mkdir(join(directory, "dist"));
          inserted = await lstat(join(directory, "dist"));
        }
        return true;
      },
    });
    expect(result).toMatchObject({ ok: false, code: "cli-output-io" });
    const actual = await lstat(join(directory, "dist"));
    expect({ dev: actual.dev, ino: actual.ino }).toEqual({
      dev: inserted?.dev,
      ino: inserted?.ino,
    });
    expect(await readdir(join(directory, "dist"))).toEqual([]);
    expect(await readdir(join(directory, ".unframe/generations"))).toEqual([]);
    expect(await readdir(directory)).toEqual([".unframe", "dist"]);
  });
});

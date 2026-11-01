import {
  cp,
  lstat,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashCanonicalJsonPayload } from "@unframe/artifacts";
import { writePortableBuild } from "./helpers/portable-dist.js";
import { readDistBuild } from "../src/filesystem/read-dist-build.js";
import { createDistPreviewService } from "../src/author/local-preview.js";
import { publishPresentation } from "../src/application/publish.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const createTemporaryDirectory = async () => {
  const path = await mkdtemp(join(temporaryDirectory(), "unframe-portable-dist-"));
  directories.push(path);
  return path;
};

const portableBuild = async () => {
  const project = await createTemporaryDirectory();
  const { artifacts, assets } = await writePortableBuild(project);
  const copied = join(await createTemporaryDirectory(), "release");
  await cp(join(project, "dist"), copied, { recursive: true });
  await writeFile(join(copied, "assets/unlisted.png"), "private unregistered image");
  await rm(project, { recursive: true, force: true });
  return { copied, artifacts, assets };
};

describe("portable Dist", () => {
  it("reads all artifacts and media bytes from a copied ordinary directory after removing the project", async () => {
    const { copied, artifacts, assets } = await portableBuild();
    expect((await lstat(copied)).isDirectory()).toBe(true);
    const fixed = await readDistBuild(copied);
    expect(fixed.generationId).toBe("a".repeat(32));
    expect(fixed.artifacts).toEqual(artifacts);
    await expect(fixed.readAsset("unlisted")).rejects.toThrow(/asset/);
    for (const asset of assets)
      expect(await fixed.readAsset(asset.assetId)).toEqual({
        bytes: asset.bytes,
        mediaType: asset.mediaType,
      });
    expect(await readFile(join(copied, "assets/model-asset.glb"))).toEqual(
      Buffer.from(assets[3]!.bytes),
    );
    expect(await readFile(join(copied, "assets/video-asset.mp4"))).toEqual(
      Buffer.from(assets[4]!.bytes),
    );
  });
  it("publishes every copied asset without the Source or internal generation store", async () => {
    const { copied, artifacts, assets } = await portableBuild();
    const uploaded = new Map<string, { bytes: Uint8Array; mediaType: string | null }>();
    const result = await publishPresentation({
      directory: copied,
      presentationId: artifacts.buildManifest.presentationId,
      controlPlaneUrl: "http://127.0.0.1:8787",
      bearerToken: "private",
      fetch: async (url, init) => {
        const path = url.pathname;
        if (init.method === "GET") {
          // Replacing local media after capture must not change uploaded bytes.
          await writeFile(join(copied, "assets/video-asset.mp4"), new Uint8Array(64));
          return new Response(null, { status: 404 });
        }
        if (path === "/presentations")
          return Response.json({ id: artifacts.buildManifest.presentationId }, { status: 201 });
        if (path.endsWith("/builds"))
          return Response.json(
            {
              buildId: artifacts.buildManifest.buildId,
              assetIds: assets.map((asset) => asset.assetId),
            },
            { status: 201 },
          );
        if (init.method === "PUT") {
          uploaded.set(decodeURIComponent(path.split("/").at(-1)!), {
            bytes: new Uint8Array(await new Response(init.body).arrayBuffer()),
            mediaType: new Headers(init.headers).get("content-type"),
          });
          return new Response(null, { status: 204 });
        }
        const payload = { ...artifacts.buildManifest, publicationEpoch: 1 };
        return Response.json(
          { ...payload, publicationManifestHash: hashCanonicalJsonPayload(payload) },
          { status: 201 },
        );
      },
    });
    expect(result).toEqual({
      ok: true,
      buildId: artifacts.buildManifest.buildId,
      publicationEpoch: 1,
    });
    expect(uploaded.size).toBe(assets.length);
    for (const asset of assets)
      expect(uploaded.get(asset.assetId)).toEqual({
        bytes: asset.bytes,
        mediaType: asset.mediaType,
      });
  });

  it.each(["missing", "checksum", "size", "symlink"] as const)(
    "rejects %s media before any authenticated request",
    async (fault) => {
      const { copied, artifacts } = await portableBuild();
      const media = join(copied, "assets/video-asset.mp4");
      const changes = {
        missing: () => rm(media),
        checksum: () => writeFile(media, new Uint8Array(64)),
        size: () => writeFile(media, new Uint8Array(63)),
        symlink: async () => {
          await rm(media);
          await symlink("model-asset.glb", media);
        },
      };
      await changes[fault]();
      const requests: string[] = [];
      const result = await publishPresentation({
        directory: copied,
        presentationId: artifacts.buildManifest.presentationId,
        controlPlaneUrl: "http://127.0.0.1:8787",
        bearerToken: "private",
        fetch: async (url) => {
          requests.push(url.pathname);
          throw new Error("Unexpected network request");
        },
      });
      expect(result).toEqual({ ok: false, code: "cli-publish-build-invalid" });
      expect(requests).toEqual([]);
    },
  );

  it("rejects an oversized sparse PNG before preparing a Preview candidate", async () => {
    const { copied } = await portableBuild();
    const file = await open(join(copied, "assets/texture.png"), "w");
    try {
      await file.truncate(512 * 1024 * 1024);
    } finally {
      await file.close();
    }
    const preview = createDistPreviewService(copied);
    try {
      await expect(preview.load({ channel: "dist", requestId: "c".repeat(32) })).rejects.toThrow(
        /asset integrity/,
      );
    } finally {
      preview.close();
    }
  });

  it("rejects a receipt detached from its build manifest", async () => {
    const { copied } = await portableBuild();
    const receipt = join(copied, "build-receipt.json");
    const value = JSON.parse(await readFile(receipt, "utf8"));
    await writeFile(
      receipt,
      JSON.stringify({ ...value, buildManifestHash: "sha256:" + "0".repeat(64) }),
    );
    await expect(readDistBuild(copied)).rejects.toThrow(/receipt integrity/);
  });

  it("rejects asset reads after the captured Dist directory is replaced", async () => {
    const { copied } = await portableBuild();
    const fixed = await readDistBuild(copied);
    await rename(copied, copied + "-old");
    await cp(copied + "-old", copied, { recursive: true });
    await expect(fixed.readAsset("video-asset")).rejects.toThrow(/changed/);
  });

  it("rejects symlinked Dist roots and unknown asset paths", async () => {
    const { copied } = await portableBuild();
    const alias = join(await createTemporaryDirectory(), "alias");
    await symlink(copied, alias);
    await expect(readDistBuild(alias)).rejects.toThrow(/Unsafe/);
    const fixed = await readDistBuild(copied);
    await expect(fixed.readAsset("../../secret")).rejects.toThrow(/asset/);
  });
});

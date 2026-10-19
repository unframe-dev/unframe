import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, expect, it } from "vitest";
import { createDistPreviewService } from "../src/author/local-preview.js";
import { startDistPreviewHost } from "../src/author/start.js";
import { writePortableBuild } from "./helpers/portable-dist.js";

it("prepares copied Dist media and pins publication without the source project", async () => {
  const source = await mkdtemp(join(tmpdir(), "unframe-preview-source-"));
  const destination = await mkdtemp(join(tmpdir(), "unframe-preview-copy-"));
  try {
    const { artifacts, assets } = await writePortableBuild(source);
    const directory = join(destination, "dist");
    await cp(join(source, "dist"), directory, { recursive: true });
    await rm(source, { recursive: true, force: true });
    const preview = createDistPreviewService(directory);
    try {
      const requestId = "b".repeat(32);
      const envelope = await preview.load({ channel: "dist", requestId });
      expect(envelope.projection?.modelResidency?.models).toHaveLength(1);
      expect(envelope.projection?.videoResidency?.videos).toHaveLength(1);
      preview.committed({ requestId, buildIdentity: artifacts.buildManifest.buildId });
      const pinned = await preview.pinDisplayedDist(requestId);
      for (const asset of assets)
        expect(await pinned.readAsset(asset.assetId)).toEqual({
          bytes: asset.bytes,
          mediaType: asset.mediaType,
        });
      await expect(
        preview.load({
          channel: "dev",
          requestId: "c".repeat(32),
          generationId: "d".repeat(32),
          sourceRevision: "latest",
        }),
      ).rejects.toMatchObject({ code: "preview-dist-only" });
    } finally {
      preview.close();
    }
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

it("serves copied Dist through the authenticated Unity Preview API without authoring routes", async () => {
  const source = await mkdtemp(join(tmpdir(), "unframe-preview-source-"));
  const destination = await mkdtemp(join(tmpdir(), "unframe-preview-copy-"));
  try {
    const { artifacts } = await writePortableBuild(source);
    const directory = join(destination, "dist");
    await cp(join(source, "dist"), directory, { recursive: true });
    await rm(source, { recursive: true, force: true });
    const host = await startDistPreviewHost(directory, { assets: new Map() });
    try {
      const headers = {
        authorization: `Bearer ${host.token}`,
        origin: host.origin,
        "content-type": "application/json",
      };
      const project = await fetch(`${host.origin}/api/project`, { headers });
      expect(await project.json()).toMatchObject({
        definition: artifacts.definition,
        instances: [],
      });
      const requestId = "a".repeat(32);
      const prepared = await fetch(`${host.origin}/api/previews`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId, channel: "dist" }),
      });
      expect(prepared.status).toBe(200);
      const envelope = (await prepared.json()) as {
        assets: { assetId: string; reference: string }[];
      };
      const model = envelope.assets.find((asset) => asset.assetId === "model-asset");
      assert(model);
      const asset = await fetch(
        `${host.origin}/api/previews/${requestId}/assets/${model.reference}`,
        { headers },
      );
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toBe("model/gltf-binary");
      const build = await fetch(`${host.origin}/api/builds`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId }),
      });
      expect(build.status).toBe(409);
      expect(await build.json()).toMatchObject({ code: "preview-dist-read-only" });
    } finally {
      await host.close();
    }
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

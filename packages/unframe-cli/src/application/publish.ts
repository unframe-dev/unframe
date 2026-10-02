import { createHash } from "node:crypto";
import { readlink } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalizeJsonPayload,
  verifyBuildIntegrityV2,
  verifyPublicationIntegrityV2,
} from "@unframe/unframe-core";
import { projectDirectory, readBoundedRegularFile } from "../filesystem/path-policy.js";

export type PublishInput = Readonly<{
  directory: string;
  presentationId: string;
  controlPlaneUrl: string;
  bearerToken: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}>;

export type PublishResult =
  | Readonly<{ ok: true; buildId: string; publicationEpoch: number }>
  | Readonly<{ ok: false; code: string }>;

const failure = (code: string): PublishResult => ({ ok: false, code });
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assetBudget = 256 * 1024 * 1024;
const extensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "video/mp4": "mp4",
  "model/gltf-binary": "glb",
};

export const publishPresentation = async (input: PublishInput): Promise<PublishResult> => {
  if (!input.bearerToken || /[\r\n]/u.test(input.bearerToken))
    return failure("cli-publish-token-invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(input.presentationId))
    return failure("cli-publish-presentation-id-invalid");
  let origin: URL;
  try {
    origin = new URL(input.controlPlaneUrl);
  } catch {
    return failure("cli-publish-origin-invalid");
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    !(
      origin.protocol === "https:" ||
      (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    )
  )
    return failure("cli-publish-origin-invalid");
  try {
    const link = await readlink(join(input.directory, "dist"));
    if (!/^\.unframe\/generations\/[0-9a-f]{32}$/u.test(link))
      return failure("cli-publish-dist-invalid");
    const generation = join(input.directory, link);
    if (!(await projectDirectory(generation))) return failure("cli-publish-dist-invalid");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const readJson = async (name: string) => {
      const bytes = await readBoundedRegularFile(join(generation, `${name}.json`), 8 * 1024 * 1024);
      if (!bytes) throw new Error("missing artifact");
      return JSON.parse(decoder.decode(bytes)) as unknown;
    };
    const [definition, renderBundle, assetSet, buildManifest] = await Promise.all([
      readJson("definition"),
      readJson("render-bundle"),
      readJson("asset-set"),
      readJson("build-manifest"),
    ]);
    const integrity = verifyBuildIntegrityV2({ definition, renderBundle, assetSet, buildManifest });
    if (!integrity.valid) return failure("cli-publish-build-invalid");
    const artifacts = integrity.value;
    const envelope = {
      definitionJson: canonicalizeJsonPayload(artifacts.definition),
      renderBundleJson: canonicalizeJsonPayload(artifacts.renderBundle),
      assetSetJson: canonicalizeJsonPayload(artifacts.assetSet),
      buildManifestJson: canonicalizeJsonPayload(artifacts.buildManifest),
    };
    if (
      Object.values(envelope).some(
        (value) => new TextEncoder().encode(value).byteLength > 8 * 1024 * 1024,
      )
    )
      return failure("cli-publish-build-too-large");
    if (artifacts.buildManifest.presentationId !== input.presentationId)
      return failure("cli-publish-presentation-id-mismatch");
    const descriptors = Object.entries(artifacts.assetSet.assets);
    let totalAssetBytes = 0;
    for (const [, descriptor] of descriptors) {
      totalAssetBytes += descriptor.encodedSizeBytes;
      if (totalAssetBytes > assetBudget) return failure("cli-publish-asset-invalid");
    }
    const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
    for (const [assetId, descriptor] of descriptors) {
      const extension = extensions[descriptor.mediaType];
      if (!extension) return failure("cli-publish-asset-invalid");
      const bytes = await readBoundedRegularFile(
        join(generation, "assets", `${encodeURIComponent(assetId)}.${extension}`),
        descriptor.encodedSizeBytes,
        descriptor.encodedSizeBytes,
      );
      if (
        !bytes ||
        bytes.byteLength !== descriptor.encodedSizeBytes ||
        digest(bytes) !== descriptor.checksum
      )
        return failure("cli-publish-asset-invalid");
      assets.set(assetId, { bytes, mediaType: descriptor.mediaType });
    }
    if (input.signal?.aborted) return failure("cli-publish-cancelled");
    const request = input.fetch ?? globalThis.fetch;
    const path = `/presentations/${encodeURIComponent(input.presentationId)}`;
    const headers = { authorization: `Bearer ${input.bearerToken}` };
    const send = (suffix: string, init: RequestInit) =>
      request(new URL(path + suffix, origin), {
        ...init,
        headers: { ...headers, ...init.headers },
        redirect: "error",
        ...(input.signal ? { signal: input.signal } : {}),
      });
    const previous = await send("/publication", { method: "GET" });
    if (previous.status !== 200 && previous.status !== 404)
      return failure("cli-publish-publication-read-failed");
    let epoch = 0;
    if (previous.status === 200) {
      const published = (await previous.json()) as {
        presentationId?: unknown;
        publicationEpoch?: unknown;
      };
      if (
        published.presentationId !== input.presentationId ||
        !Number.isSafeInteger(published.publicationEpoch) ||
        Number(published.publicationEpoch) < 1
      )
        return failure("cli-publish-publication-invalid");
      epoch = Number(published.publicationEpoch);
    }
    const created = await send("/builds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    if (created.status !== 201) return failure("cli-publish-build-rejected");
    const build = (await created.json()) as { buildId?: unknown; assetIds?: unknown };
    if (
      build.buildId !== artifacts.buildManifest.buildId ||
      !Array.isArray(build.assetIds) ||
      JSON.stringify([...build.assetIds].sort()) !== JSON.stringify([...assets.keys()].sort())
    )
      return failure("cli-publish-build-response-invalid");
    for (const [assetId, asset] of assets) {
      const response = await send(
        `/builds/${encodeURIComponent(build.buildId)}/assets/${encodeURIComponent(assetId)}`,
        {
          method: "PUT",
          headers: { "content-type": asset.mediaType },
          body: new Uint8Array(asset.bytes),
        },
      );
      if (response.status !== 204) return failure("cli-publish-asset-rejected");
    }
    const publication = await send("/publications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId: build.buildId, expectedPublicationEpoch: epoch }),
    });
    if (publication.status !== 201) return failure("cli-publish-publication-rejected");
    const published = (await publication.json()) as unknown;
    const verified = verifyPublicationIntegrityV2({
      ...artifacts,
      publishedPresentation: published,
    });
    if (!verified.valid || verified.value.publishedPresentation.publicationEpoch !== epoch + 1)
      return failure("cli-publish-publication-response-invalid");
    return { ok: true, buildId: build.buildId, publicationEpoch: epoch + 1 };
  } catch {
    return failure(input.signal?.aborted ? "cli-publish-cancelled" : "cli-publish-io");
  }
};

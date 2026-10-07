import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashCanonicalJsonPayload, type BuildArtifacts } from "@unframe/unframe-core";
import { verifyBuildIntegrity } from "@unframe/unframe-core";
import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import assetsFixture from "../../contracts/presentation/fixtures/asset-set-manifest.json";
import manifestFixture from "../../contracts/presentation/fixtures/build-manifest.json";
import { publishFixedBuild } from "../src/application/publish.js";

function build() {
  const parsed = verifyBuildIntegrity({
    definition: definitionFixture,
    renderBundle: bundleFixture,
    assetSet: assetsFixture,
    buildManifest: manifestFixture,
  });
  if (!parsed.valid) throw new Error("Invalid canonical fixture.");
  const artifacts: BuildArtifacts = structuredClone(parsed.value);
  const bytes = new Map(
    Object.entries(artifacts.assetSet.assets).map(([id, descriptor]) => {
      const value = new Uint8Array(descriptor.encodedSizeBytes).fill(7);
      descriptor.checksum = `sha256:${createHash("sha256").update(value).digest("hex")}`;
      return [id, value] as const;
    }),
  );
  const walk = (input: unknown) => {
    if (!input || typeof input !== "object") return;
    const record = input as Record<string, unknown>;
    if (typeof record["assetId"] === "string" && typeof record["checksum"] === "string")
      record["checksum"] = artifacts.assetSet.assets[record["assetId"]]!.checksum;
    for (const value of Object.values(record)) walk(value);
  };
  walk(artifacts.renderBundle);
  artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(artifacts.definition);
  artifacts.buildManifest.definitionHash = artifacts.renderBundle.definitionHash;
  artifacts.buildManifest.renderBundleHash = hashCanonicalJsonPayload(artifacts.renderBundle);
  artifacts.buildManifest.assetSetHash = hashCanonicalJsonPayload(artifacts.assetSet);
  return {
    artifacts,
    readAsset: async (id: string) => ({
      bytes: bytes.get(id)!.slice(),
      mediaType: artifacts.assetSet.assets[id]!.mediaType,
    }),
  };
}

describe("fixed build publication", () => {
  it("registers the Source identity, fixes the whole expected fence, and verifies the returned artifact hashes", async () => {
    const fixed = build();
    const expected = {
      presentationId: fixed.artifacts.buildManifest.presentationId,
      publicationEpoch: 4,
      publicationManifestHash: "sha256:" + "a".repeat(64),
    };
    const requests: { path: string; body: unknown }[] = [];
    const result = await publishFixedBuild({
      ...fixed,
      controlPlaneUrl: "http://127.0.0.1:8787",
      bearerToken: "private",
      expectedPublicationFence: expected,
      fetch: (async (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ path, body });
        if (path === "/presentations")
          return Response.json({ id: expected.presentationId }, { status: 201 });
        if (path.endsWith("/builds"))
          return Response.json(
            {
              buildId: fixed.artifacts.buildManifest.buildId,
              assetIds: Object.keys(fixed.artifacts.assetSet.assets),
            },
            { status: 201 },
          );
        if (path.includes("/assets/")) return new Response(null, { status: 204 });
        const payload = { ...fixed.artifacts.buildManifest, publicationEpoch: 5 };
        return Response.json(
          { ...payload, publicationManifestHash: hashCanonicalJsonPayload(payload) },
          { status: 201 },
        );
      }) as typeof fetch,
    });
    expect(result).toEqual({
      ok: true,
      buildId: fixed.artifacts.buildManifest.buildId,
      publicationEpoch: 5,
    });
    expect(requests[0]?.body).toEqual({
      id: expected.presentationId,
      name: fixed.artifacts.definition.metadata.title,
    });
    expect(requests.at(-1)?.body).toEqual({
      buildId: fixed.artifacts.buildManifest.buildId,
      expectedPublicationFence: expected,
    });
    expect(requests.some(({ path }) => path.includes("draft"))).toBe(false);
  });
  it("does not retry a publication conflict with a refreshed fence", async () => {
    const fixed = build();
    let publications = 0;
    const result = await publishFixedBuild({
      ...fixed,
      controlPlaneUrl: "http://127.0.0.1:8787",
      bearerToken: "private",
      expectedPublicationFence: null,
      fetch: (async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/presentations")
          return Response.json(
            { id: fixed.artifacts.buildManifest.presentationId },
            { status: 201 },
          );
        if (path.endsWith("/builds"))
          return Response.json(
            {
              buildId: fixed.artifacts.buildManifest.buildId,
              assetIds: Object.keys(fixed.artifacts.assetSet.assets),
            },
            { status: 201 },
          );
        if (path.includes("/assets/")) return new Response(null, { status: 204 });
        ++publications;
        return new Response(null, { status: 409 });
      }) as typeof fetch,
    });
    expect(result).toEqual({ ok: false, code: "cli-publish-conflict" });
    expect(publications).toBe(1);
  });
  it("rejects corrupted bytes before sending any registration or upload", async () => {
    const fixed = build();
    let sent = false;
    const result = await publishFixedBuild({
      ...fixed,
      readAsset: async (id) => ({ ...(await fixed.readAsset(id)), bytes: new Uint8Array(0) }),
      controlPlaneUrl: "http://127.0.0.1:8787",
      bearerToken: "private",
      expectedPublicationFence: null,
      fetch: (async () => {
        sent = true;
        throw new Error();
      }) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(sent).toBe(false);
  });
});

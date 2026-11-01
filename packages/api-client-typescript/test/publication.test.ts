import { describe, expect, it, vi } from "vitest";
import {
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  type BuildArtifacts,
} from "@unframe/artifacts";
import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import assetsFixture from "../../contracts/presentation/fixtures/asset-set-manifest.json";
import manifestFixture from "../../contracts/presentation/fixtures/build-manifest.json";
import { createPublicationClient } from "../src/publication";

async function build() {
  const parsed = verifyBuildIntegrity({
    definition: definitionFixture,
    renderBundle: bundleFixture,
    assetSet: assetsFixture,
    buildManifest: manifestFixture,
  });
  if (!parsed.valid) throw new Error("Invalid canonical fixture.");
  const artifacts: BuildArtifacts = structuredClone(parsed.value);
  const bytes = new Map(
    await Promise.all(
      Object.entries(artifacts.assetSet.assets).map(async ([id, descriptor]) => {
        const value = new Uint8Array(descriptor.encodedSizeBytes).fill(7);
        const hashed = await crypto.subtle.digest("SHA-256", value);
        descriptor.checksum =
          "sha256:" +
          Array.from(new Uint8Array(hashed), (byte) => byte.toString(16).padStart(2, "0")).join("");
        return [id, value] as const;
      }),
    ),
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

function uploadedBuildResponse(
  fixed: Awaited<ReturnType<typeof build>>,
  url: URL,
): Response | undefined {
  if (url.pathname === "/presentations")
    return Response.json({ id: fixed.artifacts.buildManifest.presentationId }, { status: 201 });
  if (url.pathname.endsWith("/builds"))
    return Response.json(
      {
        buildId: fixed.artifacts.buildManifest.buildId,
        assetIds: Object.keys(fixed.artifacts.assetSet.assets),
      },
      { status: 201 },
    );
  if (url.pathname.includes("/assets/")) return new Response(null, { status: 204 });
}
function publishedResponse(fixed: Awaited<ReturnType<typeof build>>, epoch: number) {
  const payload = { ...fixed.artifacts.buildManifest, publicationEpoch: epoch };
  return Response.json(
    { ...payload, publicationManifestHash: hashCanonicalJsonPayload(payload) },
    { status: 201 },
  );
}

describe("publication client", () => {
  it("uses cookie authentication to inspect an existing unpublished presentation", async () => {
    const requests: RequestInit[] = [];
    const client = createPublicationClient({
      baseUrl: "http://127.0.0.1:8787",
      credentials: "include",
      fetch: async (url, init) => {
        requests.push(init!);
        return String(url).endsWith("/publication")
          ? Response.json({ error: { code: "not_found" } }, { status: 404 })
          : Response.json({ id: "presentation-1", name: "Example" });
      },
    });
    await expect(client.getTarget("presentation-1")).resolves.toEqual({
      kind: "existing",
      presentation: { id: "presentation-1", name: "Example" },
      publication: null,
      expectedPublicationFence: null,
    });
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (request) => request.credentials === "include" && request.redirect === "error",
      ),
    ).toBe(true);
    expect(requests.every((request) => !new Headers(request.headers).has("authorization"))).toBe(
      true,
    );
  });

  it("recognizes a new presentation only when its parent resource is missing", async () => {
    const request = vi.fn(async () =>
      Response.json({ error: { code: "not_found" } }, { status: 404 }),
    );
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: request,
    });
    await expect(client.getTarget("new-presentation")).resolves.toEqual({
      kind: "new",
      presentation: null,
      publication: null,
      expectedPublicationFence: null,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a forbidden target for a new presentation", async () => {
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: async () => Response.json({ error: { code: "forbidden" } }, { status: 403 }),
    });
    await expect(client.getTarget("other-presentation")).rejects.toMatchObject({
      code: "publication-target-rejected",
      status: 403,
      reason: "forbidden",
    });
  });

  it("uses the confirmed fence unchanged and verifies publication integrity", async () => {
    const fixed = await build();
    const expected = {
      presentationId: fixed.artifacts.buildManifest.presentationId,
      publicationEpoch: 4,
      publicationManifestHash: "sha256:" + "a".repeat(64),
    };
    const requests: { url: URL; init: RequestInit }[] = [];
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      bearerToken: "credential",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return uploadedBuildResponse(fixed, url) ?? publishedResponse(fixed, 5);
      },
    });
    await expect(client.publish({ ...fixed, expectedPublicationFence: expected })).resolves.toEqual(
      { ok: true, buildId: fixed.artifacts.buildManifest.buildId, publicationEpoch: 5 },
    );
    expect(requests.every(({ init }) => init.method !== "GET")).toBe(true);
    expect(
      requests.every(
        ({ init }) =>
          new Headers(init.headers).get("authorization") === "Bearer credential" &&
          init.credentials === "omit",
      ),
    ).toBe(true);
    expect(JSON.parse(String(requests.at(-1)?.init.body))).toEqual({
      buildId: fixed.artifacts.buildManifest.buildId,
      expectedPublicationFence: expected,
    });
  });

  it("rejects corrupted assets before any write", async () => {
    const fixed = await build();
    const request = vi.fn(async () => new Response(null, { status: 500 }));
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: request,
    });
    await expect(
      client.publish({
        ...fixed,
        expectedPublicationFence: null,
        readAsset: async (id) => ({ ...(await fixed.readAsset(id)), bytes: new Uint8Array(0) }),
      }),
    ).resolves.toMatchObject({ ok: false, code: "publication-asset-invalid", outcome: "rejected" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not refresh the fence or resend a publication conflict", async () => {
    const fixed = await build();
    let publications = 0;
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: async (url) => {
        const response = uploadedBuildResponse(fixed, url);
        if (response) return response;
        publications++;
        return Response.json({ error: { code: "conflict" } }, { status: 409 });
      },
    });
    await expect(
      client.publish({ ...fixed, expectedPublicationFence: null }),
    ).resolves.toMatchObject({
      ok: false,
      code: "publication-conflict",
      outcome: "rejected",
      status: 409,
    });
    expect(publications).toBe(1);
  });

  it("distinguishes an unknown publication outcome after a lost final response", async () => {
    const fixed = await build();
    let publications = 0;
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: async (url) => {
        const response = uploadedBuildResponse(fixed, url);
        if (response) return response;
        publications++;
        throw new TypeError("connection lost");
      },
    });
    await expect(client.publish({ ...fixed, expectedPublicationFence: null })).resolves.toEqual({
      ok: false,
      code: "publication-io",
      outcome: "unknown",
    });
    expect(publications).toBe(1);
  });

  it("requires reconciliation when a successful response contains a different build", async () => {
    const fixed = await build();
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: async (url) =>
        uploadedBuildResponse(fixed, url) ??
        Response.json({ buildId: "wrong-build" }, { status: 201 }),
    });
    await expect(client.publish({ ...fixed, expectedPublicationFence: null })).resolves.toEqual({
      ok: false,
      code: "publication-publication-response-invalid",
      outcome: "unknown",
    });
  });

  it("does not send a credential to an insecure or non-origin target", () => {
    expect(() =>
      createPublicationClient({ baseUrl: "http://example.test", bearerToken: "credential" }),
    ).toThrow("publication-origin-invalid");
    expect(() =>
      createPublicationClient({ baseUrl: "https://example.test/path", credentials: "include" }),
    ).toThrow("publication-origin-invalid");
  });
  it("rejects an overflowing publication epoch before uploading", async () => {
    const fixed = await build();
    const request = vi.fn(async () => new Response(null, { status: 500 }));
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: request,
    });
    await expect(
      client.publish({
        ...fixed,
        expectedPublicationFence: {
          presentationId: fixed.artifacts.buildManifest.presentationId,
          publicationEpoch: Number.MAX_SAFE_INTEGER,
          publicationManifestHash: "sha256:" + "a".repeat(64),
        },
      }),
    ).resolves.toMatchObject({ ok: false, code: "publication-fence-invalid", outcome: "rejected" });
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps the existing verified publication fence for confirmation", async () => {
    const fixed = await build();
    const published = await publishedResponse(fixed, 3).json();
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: async (url) =>
        url.pathname.endsWith("/publication")
          ? Response.json(published)
          : Response.json({ id: published.presentationId, name: "Remote name" }),
    });
    await expect(client.getTarget(published.presentationId)).resolves.toMatchObject({
      kind: "existing",
      presentation: { name: "Remote name" },
      expectedPublicationFence: {
        presentationId: published.presentationId,
        publicationEpoch: 3,
        publicationManifestHash: published.publicationManifestHash,
      },
    });
  });

  it("rejects a malformed current-publication hash instead of approving an overwrite", async () => {
    const fixed = await build();
    const published = await publishedResponse(fixed, 3).json();
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: async (url) =>
        url.pathname.endsWith("/publication")
          ? Response.json({ ...published, publicationManifestHash: "sha256:" + "f".repeat(64) })
          : Response.json({ id: published.presentationId, name: "Remote name" }),
    });
    await expect(client.getTarget(published.presentationId)).rejects.toMatchObject({
      code: "publication-target-invalid",
    });
  });

  it("keeps cancellation after publication submission uncertain", async () => {
    const fixed = await build();
    const controller = new AbortController();
    const client = createPublicationClient({
      baseUrl: "https://api.example.test",
      credentials: "include",
      fetch: async (url) => {
        const response = uploadedBuildResponse(fixed, url);
        if (response) return response;
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    });
    await expect(
      client.publish({ ...fixed, expectedPublicationFence: null, signal: controller.signal }),
    ).resolves.toEqual({ ok: false, code: "publication-cancelled", outcome: "unknown" });
  });
});

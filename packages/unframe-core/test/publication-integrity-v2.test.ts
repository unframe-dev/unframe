import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import { describe, expect, it } from "vitest";

import definitionFixture from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import assetSetFixture from "../../contracts/presentation/v2/fixtures/asset-set-manifest.json";
import buildManifestFixture from "../../contracts/presentation/v2/fixtures/build-manifest.json";
import publishedPresentationFixture from "../../contracts/presentation/v2/fixtures/published-presentation.json";
import renderBundleFixture from "../../contracts/presentation/v2/fixtures/render-bundle.json";
import { hashCanonicalJsonPayload, verifyPublicationIntegrityV2 } from "../src/index.js";

type JsonRecord = Record<string, unknown>;

type PublicationFixture = {
  definition: JsonRecord;
  renderBundle: JsonRecord;
  assetSet: JsonRecord;
  buildManifest: JsonRecord;
  publishedPresentation: JsonRecord;
};

const makeFixture = (): PublicationFixture => ({
  definition: structuredClone(definitionFixture) as JsonRecord,
  renderBundle: structuredClone(renderBundleFixture) as JsonRecord,
  assetSet: structuredClone(assetSetFixture) as JsonRecord,
  buildManifest: structuredClone(buildManifestFixture) as JsonRecord,
  publishedPresentation: structuredClone(publishedPresentationFixture) as JsonRecord,
});

const recordAt = (value: unknown, ...segments: string[]): JsonRecord => {
  let current = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null || Array.isArray(current))
      throw new TypeError(`Expected an object at ${segments.join("/")}`);
    current = (current as JsonRecord)[segment];
  }
  if (typeof current !== "object" || current === null || Array.isArray(current))
    throw new TypeError(`Expected an object at ${segments.join("/")}`);
  return current as JsonRecord;
};

const arrayAt = (value: unknown, ...segments: string[]): unknown[] => {
  const record = recordAt(value, ...segments.slice(0, -1));
  const child = record[segments.at(-1)!];
  if (!Array.isArray(child)) throw new TypeError(`Expected an array at ${segments.join("/")}`);
  return child;
};

const differentHash = `sha256:${"0".repeat(64)}`;

const expectDiagnostic = (
  result: ReturnType<typeof verifyPublicationIntegrityV2>,
  code: string,
) => {
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    for (const diagnostic of result.diagnostics) expect(Array.isArray(diagnostic.path)).toBe(true);
  }
};

const canonicalHash = (value: JsonRecord): string => {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new TypeError("Expected a canonical publication payload.");
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
};

const publicationHashWithoutSelf = (publication: JsonRecord): string => {
  const payload = structuredClone(publication);
  delete payload.publicationManifestHash;
  return canonicalHash(payload);
};

describe("verifyPublicationIntegrityV2", () => {
  it("rejects a trailing lone high surrogate in the generic canonical JSON helper", () => {
    expect(() => hashCanonicalJsonPayload("invalid\ud800")).toThrow(TypeError);
  });

  it("accepts the complete v2 publication fixture when all artifact hashes agree", () => {
    const result = verifyPublicationIntegrityV2(makeFixture());

    expect(result).toMatchObject({ valid: true, diagnostics: [] });
  });

  it.each([
    "definition",
    "renderBundle",
    "assetSet",
    "buildManifest",
    "publishedPresentation",
  ] as const)("rejects a malformed %s artifact at the schema boundary", (artifact) => {
    const input = makeFixture();
    recordAt(input[artifact]).schemaVersion = 1;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "structure.invalid");
  });

  it.each([
    "definition",
    "renderBundle",
    "assetSet",
    "buildManifest",
    "publishedPresentation",
  ] as const)("rejects an unknown field in the %s artifact", (artifact) => {
    const input = makeFixture();
    recordAt(input[artifact]).unexpected = true;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "structure.invalid");
  });

  it("rejects a non-finite number before schema validation", () => {
    const input = makeFixture();
    (recordAt(input.definition, "stage").size as number[])[0] = Number.NaN;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "canonical.invalid");
  });

  it("rejects negative zero instead of canonicalizing it to zero", () => {
    const input = makeFixture();
    (recordAt(input.definition, "stage").size as number[])[0] = -0;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "canonical.invalid");
  });

  it("rejects a trailing lone high surrogate", () => {
    const input = makeFixture();
    recordAt(input.definition, "metadata").title = "invalid\ud800";

    expectDiagnostic(verifyPublicationIntegrityV2(input), "canonical.invalid");
  });

  it("rejects a cyclic artifact without recursing indefinitely", () => {
    const input = makeFixture();
    const metadata = recordAt(input.definition, "metadata");
    metadata.self = metadata;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "canonical.invalid");
  });

  it("rejects a sparse array at the maximum representable array length", () => {
    const input = makeFixture();
    const sparse = [] as unknown[];
    sparse.length = 2 ** 32 - 1;
    recordAt(input.definition, "stage").size = sparse;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "canonical.invalid");
  });

  it("rejects a nested accessor without invoking it", () => {
    const input = makeFixture();
    let reads = 0;
    Object.defineProperty(recordAt(input.definition, "metadata"), "title", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("accessor must not be invoked");
      },
    });

    const result = verifyPublicationIntegrityV2(input);

    expectDiagnostic(result, "canonical.invalid");
    expect(reads).toBe(0);
  });

  it("rejects a top-level envelope accessor without invoking it", () => {
    const input = makeFixture() as PublicationFixture & JsonRecord;
    let reads = 0;
    Object.defineProperty(input, "definition", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("accessor must not be invoked");
      },
    });

    const result = verifyPublicationIntegrityV2(input);

    expectDiagnostic(result, "canonical.invalid");
    expect(reads).toBe(0);
  });

  it("keeps array order significant when validating the bundle hash", () => {
    const input = makeFixture();
    const features = arrayAt(input.renderBundle, "models", "model-asset", "requiredFeatures");
    features.reverse();

    const result = verifyPublicationIntegrityV2(input);

    expectDiagnostic(result, "hash.invalid");
    expect(features).toEqual(["unlit", "animation"]);
  });

  it("does not mutate artifacts while inspecting publication integrity", () => {
    const input = makeFixture();
    const before = structuredClone(input);

    verifyPublicationIntegrityV2(input);

    expect(input).toEqual(before);
  });

  it("rejects a RenderBundle whose definition hash does not match the Definition", () => {
    const input = makeFixture();
    recordAt(input.renderBundle).definitionHash = differentHash;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "hash.invalid");
  });

  it.each(["definitionHash", "renderBundleHash", "assetSetHash"] as const)(
    "rejects a BuildManifest with a stale %s",
    (field) => {
      const input = makeFixture();
      recordAt(input.buildManifest)[field] = differentHash;

      expectDiagnostic(verifyPublicationIntegrityV2(input), "hash.invalid");
    },
  );

  it("computes publicationManifestHash after excluding its own field", () => {
    const input = makeFixture();
    const publication = recordAt(input.publishedPresentation);
    publication.publicationEpoch = 2;
    publication.publicationManifestHash = publicationHashWithoutSelf(publication);

    const result = verifyPublicationIntegrityV2(input);

    expect(result).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("allows a RenderBundle ID to differ from its BuildManifest ID", () => {
    const input = makeFixture();
    recordAt(input.renderBundle).bundleId = "independent-bundle";
    const renderBundleHash = canonicalHash(input.renderBundle);
    recordAt(input.buildManifest).renderBundleHash = renderBundleHash;
    const publication = recordAt(input.publishedPresentation);
    publication.renderBundleHash = renderBundleHash;
    publication.publicationManifestHash = publicationHashWithoutSelf(publication);

    const result = verifyPublicationIntegrityV2(input);

    expect(result).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("rejects a publication with a stale self hash", () => {
    const input = makeFixture();
    recordAt(input.publishedPresentation).publicationManifestHash = differentHash;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "publication.invalid");
  });

  it.each([
    ["buildId", "other-build"],
    ["presentationId", "other-presentation"],
    ["sourceDraftRevision", 2],
    ["definitionHash", differentHash],
    ["renderBundleHash", differentHash],
    ["assetSetHash", differentHash],
  ] as const)(
    "rejects a PublishedPresentation with a different %s than its BuildManifest",
    (field, value) => {
      const input = makeFixture();
      recordAt(input.publishedPresentation)[field] = value;

      expectDiagnostic(verifyPublicationIntegrityV2(input), "publication.invalid");
    },
  );

  it("rejects a PublishedPresentation with different contract versions", () => {
    const input = makeFixture();
    recordAt(input.publishedPresentation, "contractVersions").runtime = 1;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "publication.invalid");
  });

  it.each(["image", "texture", "font", "video-asset", "model-asset"] as const)(
    "rejects an AssetSet missing directly referenced asset %s",
    (assetId) => {
      const input = makeFixture();
      delete recordAt(input.assetSet, "assets")[assetId];

      expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
    },
  );

  it("rejects an AssetSet missing an image selected by a State content override", () => {
    const input = makeFixture();
    recordAt(
      input.definition,
      "scene",
      "surfaces",
      "baked",
      "states",
      "default",
      "contentOverrides",
    ).image = {
      kind: "image",
      assetId: "state-image",
    };

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects an AssetSet missing a font selected by a State text override", () => {
    const input = makeFixture();
    const style = structuredClone(
      recordAt(input.definition, "scene", "surfaces", "baked", "contentNodes", "text", "style"),
    );
    recordAt(style).fontAssetId = "state-font";
    recordAt(
      input.definition,
      "scene",
      "surfaces",
      "baked",
      "states",
      "default",
      "contentOverrides",
    ).text = { kind: "text", style };

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects an AssetSet missing a Native UI fallback font", () => {
    const input = makeFixture();
    const fallbacks = arrayAt(
      input.renderBundle,
      "surfaces",
      "native",
      "renderSurfaces",
      "render-native",
      "artifacts",
      "artifact-native",
      "nodes",
      "text",
      "font",
      "fallbacks",
    );
    fallbacks.push({
      assetId: "fallback-font",
      supportedCodePointRanges: [[32, 126]],
    });

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects an AssetSet containing an unrelated asset", () => {
    const input = makeFixture();
    recordAt(input.assetSet, "assets").unused = {
      checksum: differentHash,
      mediaType: "image/png",
      encodedSizeBytes: 1,
    };

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects a Bundle asset descriptor that differs from the AssetSet", () => {
    const input = makeFixture();
    recordAt(
      input.renderBundle,
      "surfaces",
      "baked",
      "renderSurfaces",
      "render-baked",
      "artifacts",
      "artifact-baked",
      "states",
      "default",
      "texture",
    ).checksum = differentHash;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "artifact.invalid");
  });

  it("rejects a Bundle asset whose media type differs from the AssetSet descriptor", () => {
    const input = makeFixture();
    recordAt(input.assetSet, "assets", "texture").mediaType = "image/jpeg";

    expectDiagnostic(verifyPublicationIntegrityV2(input), "artifact.invalid");
  });

  it("rejects a ModelNode that references no compiled model asset", () => {
    const input = makeFixture();
    recordAt(input.definition, "scene", "nodes", "model").assetId = "missing-model";

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects a model clip action that references no compiled clip", () => {
    const input = makeFixture();
    const step = recordAt(input.definition, "flow", "groups", "intro", "steps", "start");
    const cue = recordAt(arrayAt(step, "cues")[0]);
    recordAt(arrayAt(cue, "actions")[0]).clipId = "missing-clip";

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects a model clip action that resolves only through Object.prototype", () => {
    const input = makeFixture();
    const step = recordAt(input.definition, "flow", "groups", "intro", "steps", "start");
    const cue = recordAt(arrayAt(step, "cues")[0]);
    recordAt(arrayAt(cue, "actions")[0]).clipId = "constructor";

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it.each([
    ["pause", "node-baked"],
    ["pause", "missing-node"],
    ["resume", "node-baked"],
    ["resume", "missing-node"],
    ["stop", "node-baked"],
    ["stop", "missing-node"],
  ] as const)("rejects modelClip.%s for a non-model or missing node", (kind, nodeId) => {
    const input = makeFixture();
    const step = recordAt(input.definition, "flow", "groups", "intro", "steps", "start");
    const cue = recordAt(arrayAt(step, "cues")[0]);
    arrayAt(cue, "actions")[0] = { kind: `modelClip.${kind}`, nodeId };

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects a compiled model whose referenced clip was removed", () => {
    const input = makeFixture();
    delete recordAt(input.renderBundle, "models", "model-asset", "clips").wave;

    expectDiagnostic(verifyPublicationIntegrityV2(input), "reference.invalid");
  });

  it("rejects a compiled model whose record key differs from assetId without a Definition ModelNode", () => {
    const input = makeFixture();
    delete recordAt(input.definition, "scene", "nodes").model;
    arrayAt(
      recordAt(input.definition, "flow", "groups", "intro", "steps", "start"),
      "cues",
    ).forEach((cue) => {
      const actions = arrayAt(cue, "actions");
      actions.splice(0, 1);
    });

    const models = recordAt(input.renderBundle, "models");
    models["compiled-key"] = models["model-asset"];
    delete models["model-asset"];

    const definitionHash = canonicalHash(input.definition);
    recordAt(input.renderBundle).definitionHash = definitionHash;
    const renderBundleHash = canonicalHash(input.renderBundle);
    recordAt(input.buildManifest).definitionHash = definitionHash;
    recordAt(input.buildManifest).renderBundleHash = renderBundleHash;
    const publication = recordAt(input.publishedPresentation);
    publication.definitionHash = definitionHash;
    publication.renderBundleHash = renderBundleHash;
    publication.publicationManifestHash = publicationHashWithoutSelf(publication);

    expectDiagnostic(verifyPublicationIntegrityV2(input), "artifact.invalid");
  });
});

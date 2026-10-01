import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDeliveryManifest,
  calculateProjectionProfileId,
  hashCanonicalJsonPayload,
  selectDeliveryArtifacts,
  verifyPublicationIntegrityV2,
} from "../../packages/unframe-core/src/index.ts";
import {
  decodeWireMessage,
  encodeWireMessage,
  getPresentationWireType,
  type AssetSetManifestV2,
  type BuildManifestV2,
  type CapabilityProfileV2,
  type PresentationDefinitionV2,
  type RenderBundleV2,
} from "../../packages/contracts/src/presentation/v2/index.ts";
import type { WireMessageType } from "../../packages/contracts/src/presentation/v2/wire-metadata.ts";
import { formatGenerated } from "../../packages/contracts/scripts/format-generated.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const [mode, dist] = process.argv.slice(2);
if ((mode !== "generate" && mode !== "check") || !dist) {
  throw new Error("usage: generate-valid-delivery.ts <generate|check> <compiler-dist>");
}

const readArtifact = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(dist, name), "utf8")) as T;

// Proto3 scalar defaults have no wire presence; omit them before comparing decoded messages.
const canonicalWireValue = (
  type: WireMessageType,
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const field of type.fieldsArray) {
    const entry = value[field.name];
    if (entry === undefined) continue;
    const nested = field.resolvedType;
    const convert = (item: unknown): unknown =>
      nested && "fieldsArray" in nested
        ? canonicalWireValue(nested, item as Record<string, unknown>)
        : item;
    if (field.repeated) {
      result[field.name] = (entry as unknown[]).map(convert);
    } else if (field.map) {
      result[field.name] = Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).map(([key, item]) => [key, convert(item)]),
      );
    } else if (
      field.partOf === undefined &&
      (entry === false ||
        entry === "" ||
        entry === 0 ||
        (["uint64", "int64", "fixed64", "sfixed64", "sint64"].includes(field.type) &&
          entry === "0"))
    ) {
      continue;
    } else {
      result[field.name] = convert(entry);
    }
  }
  return result;
};
const definition = readArtifact<PresentationDefinitionV2>("definition.json");
const renderBundle = readArtifact<RenderBundleV2>("render-bundle.json");
const assetSet = readArtifact<AssetSetManifestV2>("asset-set.json");
const buildManifest = readArtifact<BuildManifestV2>("build-manifest.json");
const capability = readArtifact<CapabilityProfileV2>(
  resolve(root, "packages/contracts/presentation/v2/fixtures/capability-profile.json"),
);

const surfaces = Object.values(renderBundle.surfaces);
assert.ok(surfaces.length > 0, "Compiler output must contain a Semantic Surface");
assert.ok(
  surfaces.some((surface) => surface.renderSurfaceIds.length >= 2),
  "Compiler output must contain a multi-partition Render Surface",
);
assert.ok(
  surfaces.every(
    (surface) =>
      Object.keys(surface.interactionsByState).length > 0 &&
      surface.renderSurfaceIds.every((id) => surface.renderSurfaces[id] !== undefined),
  ),
  "Compiler output must contain completed interaction and render semantics",
);
assert.ok(
  Object.values(definition.scene.surfaces).some(
    (surface) => surface.baseSemanticTree && Object.keys(surface.baseSemanticTree.nodes).length > 0,
  ),
  "Compiler output must contain a completed Semantic Tree",
);

const publicationPayload = { ...buildManifest, publicationEpoch: 1 };
const publishedPresentation = {
  ...publicationPayload,
  publicationManifestHash: hashCanonicalJsonPayload(publicationPayload),
};
const source = {
  definition,
  renderBundle,
  assetSet,
  buildManifest,
  publishedPresentation,
  capability,
};
const integrity = verifyPublicationIntegrityV2({
  definition,
  renderBundle,
  assetSet,
  buildManifest,
  publishedPresentation,
});
assert.ok(integrity.valid, JSON.stringify(integrity.diagnostics));
const selection = selectDeliveryArtifacts(source, "presenter");
assert.ok(selection.renderSurfaces.length >= 2, "Core must select the partitioned surfaces");
const assetAccess = Object.fromEntries(
  selection.assets.map(({ assetId }) => [
    assetId,
    {
      url: `https://assets.example.invalid/${encodeURIComponent(assetId)}`,
      expiresAtUnixMilliseconds: 2_000,
    },
  ]),
);
const manifest = buildDeliveryManifest({
  ...source,
  role: "presenter",
  sessionId: "compiler-session",
  participantId: "compiler-participant",
  assignmentEpoch: 1,
  issuedAtUnixMilliseconds: 1_000,
  assetAccess,
});
assert.ok(manifest.projectionProfile?.semanticSurfaces.length);
assert.ok(manifest.projectionProfile?.renderSurfaces.length >= 2);
assert.ok(manifest.projectionProfile?.runtimeCatalog);
assert.equal(manifest.assetAccess.length, selection.assets.length);

const typeName = "unframe.delivery.v2.DeliveryManifest";
const value = canonicalWireValue(getPresentationWireType(typeName), manifest);
const bytes = encodeWireMessage(typeName, value);
assert.deepEqual(decodeWireMessage(typeName, bytes), value);
assert.equal(
  calculateProjectionProfileId(
    (decodeWireMessage(typeName, bytes) as { projectionProfile: unknown }).projectionProfile,
  ),
  manifest.projectionProfile.projectionProfileId,
  "Wire roundtrip must preserve the complete ProjectionProfile identity",
);
const target = resolve(
  root,
  "packages/contracts/presentation/v2/fixtures/wire/valid-delivery.json",
);
const fixture = formatGenerated(
  target,
  `${JSON.stringify({ typeName, value, hex: Buffer.from(bytes).toString("hex") }, null, 2)}\n`,
);
if (mode === "check") {
  assert.equal(readFileSync(target, "utf8"), fixture, "Compiler Delivery fixture has drifted");
} else {
  writeFileSync(target, fixture);
}

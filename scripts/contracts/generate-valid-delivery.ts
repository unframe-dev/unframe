import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDeliveryManifest,
  calculateProjectionProfileId,
  selectDeliveryArtifacts,
} from "@unframe/delivery";
import { hashCanonicalJsonPayload, verifyPublicationIntegrity } from "@unframe/artifacts";
import {
  decodeWireMessage,
  encodeWireMessage,
  getPresentationWireType,
  type AssetSetManifest,
  type BuildManifest,
  type CapabilityProfile,
  type PresentationDefinition,
  type RenderBundle,
} from "../../packages/contracts/src/presentation/index.ts";
import type { WireMessageType } from "../../packages/contracts/src/presentation/wire-metadata.ts";
import { formatGenerated } from "../../packages/contracts/scripts/format-generated.ts";
import { buildDeliveryFixtureArtifacts } from "./fixtures/delivery-project.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const [mode, dist] = process.argv.slice(2);
if (
  (mode !== "generate" && mode !== "check" && mode !== "validate") ||
  (mode === "validate" && !dist)
) {
  throw new Error(
    "usage: generate-valid-delivery.ts <generate|check> [compiler-dist] | validate <compiler-dist>",
  );
}

const compiled = dist ? undefined : await buildDeliveryFixtureArtifacts();
const readArtifact = <T>(name: string): T => {
  if (dist) return JSON.parse(readFileSync(resolve(dist, name), "utf8")) as T;
  if (!compiled) throw new Error("Compiler fixture was not generated.");
  const artifacts: Record<string, unknown> = {
    "definition.json": compiled.definition,
    "render-bundle.json": compiled.renderBundle,
    "asset-set.json": compiled.assetSet,
    "build-manifest.json": compiled.buildManifest,
  };
  return artifacts[name] as T;
};

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
const definition = readArtifact<PresentationDefinition>("definition.json");
const renderBundle = readArtifact<RenderBundle>("render-bundle.json");
const assetSet = readArtifact<AssetSetManifest>("asset-set.json");
const buildManifest = readArtifact<BuildManifest>("build-manifest.json");
const capability = JSON.parse(
  readFileSync(
    resolve(root, "packages/contracts/presentation/fixtures/capability-profile.json"),
    "utf8",
  ),
) as CapabilityProfile;

const surfaces = Object.values(renderBundle.surfaces);
assert.ok(surfaces.length > 0, "Compiler output must contain a Semantic Surface");
assert.ok(
  surfaces.some((surface) => surface.renderSurfaceIds.length >= 2),
  "Compiler output must contain a multi-partition Render Surface",
);
assert.ok(
  surfaces.every(
    (surface) =>
      Object.values(surface.interactionsByState).some((interactions) => interactions.length > 0) &&
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
assert.ok(
  Object.values(definition.flow.groups).some((group) =>
    Object.values(group.steps).some((step) => step.cues.length > 0),
  ),
  "Compiler output must contain an executable Cue",
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
const integrity = verifyPublicationIntegrity({
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
assert.ok(manifest.projectionProfile);
assert.ok(manifest.projectionProfile.semanticSurfaces?.length);
assert.ok((manifest.projectionProfile.renderSurfaces?.length ?? 0) >= 2);
assert.ok(manifest.projectionProfile?.runtimeCatalog);
assert.ok(manifest.assetAccess);
assert.equal(manifest.assetAccess.length, selection.assets.length);

const typeName = "unframe.delivery.DeliveryManifest";
const value = canonicalWireValue(getPresentationWireType(typeName), { ...manifest });
const bytes = encodeWireMessage(typeName, value);
assert.deepEqual(decodeWireMessage(typeName, bytes), value);
assert.equal(
  calculateProjectionProfileId(
    (decodeWireMessage(typeName, bytes) as { projectionProfile: unknown }).projectionProfile,
  ),
  manifest.projectionProfile.projectionProfileId,
  "Wire roundtrip must preserve the complete ProjectionProfile identity",
);
const target = resolve(root, "packages/contracts/presentation/fixtures/wire/valid-delivery.json");
const fixture = formatGenerated(
  target,
  `${JSON.stringify({ typeName, value, hex: Buffer.from(bytes).toString("hex") }, null, 2)}\n`,
);
if (mode === "check") {
  assert.equal(readFileSync(target, "utf8"), fixture, "Compiler Delivery fixture has drifted");
} else if (mode === "generate") {
  writeFileSync(target, fixture);
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  presentationDefinitionJsonSchema,
  presentationDefinitionSchema,
  renderBundleJsonSchema,
  renderBundleSchema,
} from "../src/presentation/index";

const root = resolve(import.meta.dirname, "..");
const fixture = async (name: string) =>
  JSON.parse(await readFile(resolve(root, "presentation/fixtures", name), "utf8"));

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
const validateDefinition = ajv.compile(presentationDefinitionJsonSchema);
const validateBundle = ajv.compile(renderBundleJsonSchema);

const minimalDefinition = await fixture("minimal.presentation-definition.v1.json");
const minimalBundle = await fixture("minimal.render-bundle.v1.json");

assert.equal(
  validateDefinition(minimalDefinition),
  true,
  ajv.errorsText(validateDefinition.errors),
);
assert.equal(validateBundle(minimalBundle), true, ajv.errorsText(validateBundle.errors));
assert.equal(presentationDefinitionSchema.safeParse(minimalDefinition).success, true);
assert.equal(renderBundleSchema.safeParse(minimalBundle).success, true);

const invalidSchemaVersion = structuredClone(minimalDefinition);
invalidSchemaVersion.schemaVersion = 2;
assert.equal(validateDefinition(invalidSchemaVersion), false, "schemaVersion must be fixed");
assert.equal(presentationDefinitionSchema.safeParse(invalidSchemaVersion).success, false);

const invalidMetadata = structuredClone(minimalDefinition);
invalidMetadata.metadata.extra = true;
assert.equal(validateDefinition(invalidMetadata), false, "metadata must reject unknown properties");
assert.equal(presentationDefinitionSchema.safeParse(invalidMetadata).success, false);

const invalidTopLevel = structuredClone(minimalDefinition);
invalidTopLevel.extra = true;
assert.equal(
  validateDefinition(invalidTopLevel),
  false,
  "the definition must reject unknown top-level properties",
);
assert.equal(presentationDefinitionSchema.safeParse(invalidTopLevel).success, false);

const invalidCoordinateSystem = structuredClone(minimalDefinition);
invalidCoordinateSystem.stage.coordinateSystem.forwardAxis = "+Z";
assert.equal(
  validateDefinition(invalidCoordinateSystem),
  false,
  "coordinate system must be canonical",
);
assert.equal(presentationDefinitionSchema.safeParse(invalidCoordinateSystem).success, false);

const invalidAudience = structuredClone(minimalDefinition);
invalidAudience.scene.nodes["surface-node-title"].audience = "all";
assert.equal(
  validateDefinition(invalidAudience),
  false,
  "audience must use the discriminated record",
);
assert.equal(presentationDefinitionSchema.safeParse(invalidAudience).success, false);

const invalidTransform = structuredClone(minimalDefinition);
invalidTransform.scene.nodes["surface-node-title"].transform.scale = [1, 1];
assert.equal(
  validateDefinition(invalidTransform),
  false,
  "transform must have a positive Vector3 scale",
);
assert.equal(presentationDefinitionSchema.safeParse(invalidTransform).success, false);

const invalidRecordValue = structuredClone(minimalDefinition);
invalidRecordValue.scene.surfaces["surface-title"].states["state-default"] = {};
assert.equal(
  validateDefinition(invalidRecordValue),
  false,
  "record values must use their strict definitions",
);
assert.equal(presentationDefinitionSchema.safeParse(invalidRecordValue).success, false);

const missingTextPlacement = structuredClone(minimalDefinition);
delete missingTextPlacement.scene.surfaces["surface-title"].contentNodes["text-title"].placement;
assert.equal(
  validateDefinition(missingTextPlacement),
  false,
  "text nodes require absolute placement within their parent frame",
);
assert.equal(presentationDefinitionSchema.safeParse(missingTextPlacement).success, false);

const invalidTextPlacement = structuredClone(minimalDefinition);
invalidTextPlacement.scene.surfaces["surface-title"].contentNodes["text-title"].placement.width = 0;
assert.equal(
  validateDefinition(invalidTextPlacement),
  false,
  "text placement dimensions must be positive",
);
assert.equal(presentationDefinitionSchema.safeParse(invalidTextPlacement).success, false);

const invalidRendererPreference = structuredClone(minimalDefinition);
invalidRendererPreference.scene.surfaces["surface-title"].renderIntent.rendererPreference =
  "canvas";
assert.equal(
  validateDefinition(invalidRendererPreference),
  false,
  "rendererPreference must reject unknown values",
);
assert.equal(presentationDefinitionSchema.safeParse(invalidRendererPreference).success, false);

const unsupportedCue = structuredClone(minimalDefinition);
unsupportedCue.flow.groups["group-intro"].steps["step-intro"].cues.push({
  id: "cue",
});
assert.equal(
  validateDefinition(unsupportedCue),
  false,
  "cues are intentionally unsupported in the first milestone",
);
assert.equal(presentationDefinitionSchema.safeParse(unsupportedCue).success, false);

const invalidDefinition = structuredClone(minimalDefinition);
invalidDefinition.scene.surfaces["surface-title"].logicalSize = [0, 1080];
assert.equal(validateDefinition(invalidDefinition), false, "logicalSize must be positive");
assert.equal(presentationDefinitionSchema.safeParse(invalidDefinition).success, false);

const invalidOpacity = structuredClone(minimalDefinition);
invalidOpacity.scene.nodes["surface-node-title"].opacity = 1.01;
assert.equal(validateDefinition(invalidOpacity), false, "opacity must be between zero and one");
assert.equal(presentationDefinitionSchema.safeParse(invalidOpacity).success, false);

const duplicateEnabledInteractionIds = structuredClone(minimalDefinition);
duplicateEnabledInteractionIds.scene.surfaces["surface-title"].states[
  "state-default"
].enabledInteractionIds = ["interaction-title", "interaction-title"];
assert.equal(
  validateDefinition(duplicateEnabledInteractionIds),
  false,
  "enabled interaction IDs must be unique",
);
assert.equal(presentationDefinitionSchema.safeParse(duplicateEnabledInteractionIds).success, false);

const definitionWithoutNodes = structuredClone(minimalDefinition);
definitionWithoutNodes.scene.nodes = {};
assert.equal(validateDefinition(definitionWithoutNodes), false, "a scene must contain a node");
assert.equal(presentationDefinitionSchema.safeParse(definitionWithoutNodes).success, false);

const definitionWithoutSurfaces = structuredClone(minimalDefinition);
definitionWithoutSurfaces.scene.surfaces = {};
assert.equal(
  validateDefinition(definitionWithoutSurfaces),
  false,
  "a scene must contain a surface",
);
assert.equal(presentationDefinitionSchema.safeParse(definitionWithoutSurfaces).success, false);

const invalidBundle = structuredClone(minimalBundle);
invalidBundle.surfaces["surface-title"].renderSurfaces["render-surface-title"].artifacts[
  "artifact-title-default"
].states["state-default"].textures[0].pixelSize = [0, 1152];
assert.equal(validateBundle(invalidBundle), false, "texture pixelSize must be positive");
assert.equal(renderBundleSchema.safeParse(invalidBundle).success, false);

const invalidRenderSurfaceLayer = structuredClone(minimalBundle);
invalidRenderSurfaceLayer.surfaces["surface-title"].renderSurfaces["render-surface-title"].layer =
  -1;
assert.equal(
  validateBundle(invalidRenderSurfaceLayer),
  false,
  "render surface layer must be a non-negative integer",
);
assert.equal(renderBundleSchema.safeParse(invalidRenderSurfaceLayer).success, false);

const fractionalRenderSurfaceLayer = structuredClone(minimalBundle);
fractionalRenderSurfaceLayer.surfaces["surface-title"].renderSurfaces[
  "render-surface-title"
].layer = 0.5;
assert.equal(
  validateBundle(fractionalRenderSurfaceLayer),
  false,
  "render surface layer must be an integer",
);
assert.equal(renderBundleSchema.safeParse(fractionalRenderSurfaceLayer).success, false);

const invalidBundleRecord = structuredClone(minimalBundle);
invalidBundleRecord.surfaces["surface-title"].renderSurfaces["render-surface-title"].stateBindings[
  "state-default"
] = { kind: "artifacts" };
assert.equal(validateBundle(invalidBundleRecord), false, "artifact bindings require artifact IDs");
assert.equal(renderBundleSchema.safeParse(invalidBundleRecord).success, false);

const legacyControlPlaneDefinition = {
  id: "legacy-presentation",
  metadata: { title: "Legacy" },
  stage: {},
  groups: [],
  elements: [],
};
assert.equal(
  validateDefinition(legacyControlPlaneDefinition),
  false,
  "the target schema must reject the existing Control Plane representation",
);
assert.equal(presentationDefinitionSchema.safeParse(legacyControlPlaneDefinition).success, false);

const generatedDefinition = JSON.parse(
  await readFile(resolve(root, "presentation/presentation-definition.schema.json"), "utf8"),
);
const generatedBundle = JSON.parse(
  await readFile(resolve(root, "presentation/render-bundle.schema.json"), "utf8"),
);
assert.deepEqual(generatedDefinition, presentationDefinitionJsonSchema);
assert.deepEqual(generatedBundle, renderBundleJsonSchema);

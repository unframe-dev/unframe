import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { presentationDefinitionSchema, renderBundleSchema } from "../src/presentation.schema";

const root = resolve(import.meta.dirname, "..");
const fixture = async (name: string) =>
  JSON.parse(await readFile(resolve(root, "presentation/fixtures", name), "utf8"));

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
const validateDefinition = ajv.compile(presentationDefinitionSchema);
const validateBundle = ajv.compile(renderBundleSchema);

const minimalDefinition = await fixture("minimal.presentation-definition.v1.json");
const minimalBundle = await fixture("minimal.render-bundle.v1.json");

assert.equal(
  validateDefinition(minimalDefinition),
  true,
  ajv.errorsText(validateDefinition.errors),
);
assert.equal(validateBundle(minimalBundle), true, ajv.errorsText(validateBundle.errors));

const invalidSchemaVersion = structuredClone(minimalDefinition);
invalidSchemaVersion.schemaVersion = 2;
assert.equal(validateDefinition(invalidSchemaVersion), false, "schemaVersion must be fixed");

const invalidMetadata = structuredClone(minimalDefinition);
invalidMetadata.metadata.extra = true;
assert.equal(validateDefinition(invalidMetadata), false, "metadata must reject unknown properties");

const invalidTopLevel = structuredClone(minimalDefinition);
invalidTopLevel.extra = true;
assert.equal(
  validateDefinition(invalidTopLevel),
  false,
  "the definition must reject unknown top-level properties",
);

const invalidCoordinateSystem = structuredClone(minimalDefinition);
invalidCoordinateSystem.stage.coordinateSystem.forwardAxis = "+Z";
assert.equal(
  validateDefinition(invalidCoordinateSystem),
  false,
  "coordinate system must be canonical",
);

const invalidAudience = structuredClone(minimalDefinition);
invalidAudience.scene.nodes["surface-node-title"].audience = "all";
assert.equal(
  validateDefinition(invalidAudience),
  false,
  "audience must use the discriminated record",
);

const invalidTransform = structuredClone(minimalDefinition);
invalidTransform.scene.nodes["surface-node-title"].transform.scale = [1, 1];
assert.equal(
  validateDefinition(invalidTransform),
  false,
  "transform must have a positive Vector3 scale",
);

const invalidRecordValue = structuredClone(minimalDefinition);
invalidRecordValue.scene.surfaces["surface-title"].states["state-default"] = {};
assert.equal(
  validateDefinition(invalidRecordValue),
  false,
  "record values must use their strict definitions",
);

const missingTextPlacement = structuredClone(minimalDefinition);
delete missingTextPlacement.scene.surfaces["surface-title"].contentNodes["text-title"].placement;
assert.equal(
  validateDefinition(missingTextPlacement),
  false,
  "text nodes require absolute placement within their parent frame",
);

const invalidTextPlacement = structuredClone(minimalDefinition);
invalidTextPlacement.scene.surfaces["surface-title"].contentNodes["text-title"].placement.width = 0;
assert.equal(
  validateDefinition(invalidTextPlacement),
  false,
  "text placement dimensions must be positive",
);

const invalidRendererPreference = structuredClone(minimalDefinition);
invalidRendererPreference.scene.surfaces["surface-title"].renderIntent.rendererPreference =
  "canvas";
assert.equal(
  validateDefinition(invalidRendererPreference),
  false,
  "rendererPreference must reject unknown values",
);

const unsupportedCue = structuredClone(minimalDefinition);
unsupportedCue.flow.groups["group-intro"].steps["step-intro"].cues.push({
  id: "cue",
});
assert.equal(
  validateDefinition(unsupportedCue),
  false,
  "cues are intentionally unsupported in the first milestone",
);

const invalidDefinition = structuredClone(minimalDefinition);
invalidDefinition.scene.surfaces["surface-title"].logicalSize = [0, 1080];
assert.equal(validateDefinition(invalidDefinition), false, "logicalSize must be positive");

const invalidBundle = structuredClone(minimalBundle);
invalidBundle.surfaces["surface-title"].renderSurfaces["render-surface-title"].artifacts[
  "artifact-title-default"
].states["state-default"].textures[0].pixelSize = [0, 1152];
assert.equal(validateBundle(invalidBundle), false, "texture pixelSize must be positive");

const invalidBundleRecord = structuredClone(minimalBundle);
invalidBundleRecord.surfaces["surface-title"].renderSurfaces["render-surface-title"].stateBindings[
  "state-default"
] = { kind: "artifacts" };
assert.equal(validateBundle(invalidBundleRecord), false, "artifact bindings require artifact IDs");

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

const generated = await readFile(resolve(root, "src/presentation.schema.ts"), "utf8");
assert.match(generated, /Generated from presentation\/.+schema\.json\. Do not edit\./);

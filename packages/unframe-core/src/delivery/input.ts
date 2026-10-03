import { capabilityProfileSchema, type CapabilityProfile } from "@unframe/contracts/presentation";
import {
  verifyPublicationIntegrity,
  type PublicationArtifacts,
  type PublicationIntegrityInput,
} from "../publication/integrity.js";
import { snapshotPlainJson } from "../publication/plain-json.js";
import { validatePresentationDefinition } from "../validation/definition.js";
import { validateRenderBundle } from "../validation/render-bundle.js";

export type DeliverySourceInput = PublicationArtifacts & {
  capability: CapabilityProfile;
};

export const parseDeliveryInputs = (
  input: DeliverySourceInput,
): PublicationArtifacts & {
  capability: CapabilityProfile;
} => {
  const frozen = snapshotPlainJson(input);
  if (
    !frozen.valid ||
    typeof frozen.value !== "object" ||
    frozen.value === null ||
    Array.isArray(frozen.value)
  )
    throw new TypeError("Delivery inputs must be plain JSON data properties.");
  const source = frozen.value as Record<string, unknown>;
  const expected = [
    "definition",
    "renderBundle",
    "assetSet",
    "buildManifest",
    "publishedPresentation",
    "capability",
  ];
  if (
    Object.keys(source).length !== expected.length ||
    Object.keys(source).some((key) => !expected.includes(key))
  )
    throw new TypeError(
      "Delivery input envelope must contain only required artifacts and CapabilityProfile.",
    );
  const { capability, ...artifacts } = source;
  const integrity = verifyPublicationIntegrity(artifacts as PublicationIntegrityInput);
  if (!integrity.valid)
    throw new Error(
      `Delivery publication is invalid: ${integrity.diagnostics.map((entry) => entry.message).join(" ")}`,
    );
  const definition = validatePresentationDefinition(integrity.value.definition, {
    fullDelivery: true,
  });
  if (!definition.valid)
    throw new Error(
      `Delivery Definition is invalid: ${definition.diagnostics.map((entry) => entry.message).join(" ")}`,
    );
  const renderBundle = validateRenderBundle(integrity.value.renderBundle, { fullDelivery: true });
  if (!renderBundle.valid)
    throw new Error(
      `Delivery RenderBundle is invalid: ${renderBundle.diagnostics.map((entry) => entry.message).join(" ")}`,
    );
  return {
    ...integrity.value,
    definition: definition.value,
    renderBundle: renderBundle.value,
    capability: capabilityProfileSchema.parse(capability),
  };
};

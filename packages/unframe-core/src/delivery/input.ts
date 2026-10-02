import {
  capabilityProfileV2Schema,
  type CapabilityProfileV2,
} from "@unframe/contracts/presentation/v2";
import {
  verifyPublicationIntegrityV2,
  type PublicationArtifactsV2,
  type PublicationIntegrityInputV2,
} from "../publication-v2/integrity.js";
import { snapshotPlainJson } from "../publication-v2/plain-json.js";
import { validatePresentationDefinition } from "../validation/definition.js";
import { validateRenderBundle } from "../validation/render-bundle.js";

export type DeliverySourceInput = PublicationArtifactsV2 & {
  capability: CapabilityProfileV2;
};

export const parseDeliveryInputs = (
  input: DeliverySourceInput,
): PublicationArtifactsV2 & {
  capability: CapabilityProfileV2;
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
  const integrity = verifyPublicationIntegrityV2(artifacts as PublicationIntegrityInputV2);
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
    capability: capabilityProfileV2Schema.parse(capability),
  };
};

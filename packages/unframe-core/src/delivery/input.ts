import { capabilityProfileSchema, type CapabilityProfile } from "@unframe/contracts/presentation";
import {
  verifyPublicationIntegrity,
  verifyBuildIntegrity,
  type BuildArtifacts,
  type PublicationArtifacts,
  type PublicationIntegrityInput,
} from "../publication/integrity.js";
import { snapshotPlainJson } from "../publication/plain-json.js";
import { validatePresentationArtifacts } from "../validation/artifacts.js";

export type BuildSourceInput = BuildArtifacts & { capability: CapabilityProfile };

export type DeliverySourceInput = PublicationArtifacts & {
  capability: CapabilityProfile;
};

function parseInputs(input: BuildSourceInput, publication: false): BuildSourceInput;
function parseInputs(input: DeliverySourceInput, publication: true): DeliverySourceInput;
function parseInputs(input: BuildSourceInput | DeliverySourceInput, publication: boolean) {
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
    ...(publication ? ["publishedPresentation"] : []),
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
  const integrity = publication
    ? verifyPublicationIntegrity(artifacts as PublicationIntegrityInput)
    : verifyBuildIntegrity(artifacts);
  if (!integrity.valid)
    throw new Error(
      `Delivery ${publication ? "publication" : "build"} is invalid: ${integrity.diagnostics.map((entry) => entry.message).join(" ")}`,
    );
  const presentation = validatePresentationArtifacts(
    integrity.value.definition,
    integrity.value.renderBundle,
    { fullDelivery: true },
  );
  if (!presentation.valid)
    throw new Error(
      `Delivery presentation artifacts are invalid: ${presentation.diagnostics.map((entry) => entry.message).join(" ")}`,
    );
  return {
    ...integrity.value,
    ...presentation.value,
    capability: capabilityProfileSchema.parse(capability),
  };
}

export const parseDeliveryInputs = (input: DeliverySourceInput): DeliverySourceInput =>
  parseInputs(input, true);

export const parseBuildInputs = (input: BuildSourceInput): BuildSourceInput =>
  parseInputs(input, false);

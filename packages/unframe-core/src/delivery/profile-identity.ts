import { getPresentationWireType } from "@unframe/contracts/presentation/v2";
import { hashCanonicalJsonPayload } from "../canonicalization/payload.js";
import { snapshotPlainJson } from "../publication-v2/plain-json.js";

type WireType = ReturnType<typeof getPresentationWireType>;
const profileTypeName = "unframe.delivery.v2.ProjectionProfileDescriptor";
const snakeCase = (name: string) =>
  name.replace(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};
const ascending = (left: string | number, right: string | number) => left < right;
const keyedEntry = (parent: string, field: string, item: unknown): string | number | undefined => {
  if (!isRecord(item)) return undefined;
  if (field === "renderSurfaces")
    return `${String(item["semanticSurfaceId"])}\u0000${String(item["layer"] ?? 0).padStart(10, "0")}`;
  if (field === "modelClips")
    return `${String(item["modelNodeId"])}\u0000${String(item["clipId"])}`;
  if (field === "nodes" && parent.endsWith(".ProjectedSemanticTree"))
    return item["semanticNodeId"] as string | undefined;
  if (field === "nodes" && parent.endsWith(".NativeUiArtifact")) {
    const node = isRecord(item["group"])
      ? item["group"]
      : isRecord(item["text"])
        ? item["text"]
        : undefined;
    return node?.["nodeId"] as string | undefined;
  }
  if (field === "artifacts") {
    const artifact = isRecord(item["bakedWeb"])
      ? item["bakedWeb"]
      : isRecord(item["nativeUi"])
        ? item["nativeUi"]
        : isRecord(item["video"])
          ? item["video"]
          : undefined;
    return artifact?.["artifactId"] as string | undefined;
  }
  const key = (
    {
      semanticSurfaces: "semanticSurfaceId",
      localOverlays: "overlayId",
      states: "stateId",
      nodes: "nodeId",
      surfaces: "surfaceId",
      variables: "variableId",
      timelines: "timelineId",
      modelClips: "modelNodeId",
    } as Record<string, string>
  )[field];
  return key ? (item[key] as string | number | undefined) : undefined;
};

const identityObject = (type: WireType, input: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(input)) return fail(path, "required message is missing");
  const fields = new Map(type.fieldsArray.map((field) => [field.name, field]));
  for (const key of Object.keys(input))
    if (!fields.has(key)) fail(`${path}.${key}`, "unknown field");
  const output: Record<string, unknown> = {};
  for (const oneof of type.oneofsArray) {
    if (oneof.name.startsWith("_") && oneof.oneof.length === 1) continue;
    const present = oneof.oneof.filter((name) => Object.hasOwn(input, name));
    if (present.length !== 1) fail(path, `oneof ${oneof.name} must select exactly one field`);
  }
  for (const field of type.fieldsArray) {
    const fieldPath = `${path}.${field.name}`;
    const value = input[field.name];
    const present = Object.hasOwn(input, field.name);
    if (!present && field.partOf) continue;
    const resolved = field.resolvedType;
    const childType = resolved && "fieldsArray" in resolved ? (resolved as WireType) : undefined;
    const convert = (item: unknown): unknown => {
      if (childType) return identityObject(childType, item, fieldPath);
      if (field.type === "bytes") return fail(fieldPath, "bytes cannot enter profile identity");
      if (["uint64", "fixed64"].includes(field.type)) {
        if (
          typeof item !== "string" ||
          !/^(0|[1-9][0-9]*)$/u.test(item) ||
          BigInt(item) > (1n << 64n) - 1n
        )
          return fail(fieldPath, "uint64 must be a canonical decimal string");
        return item;
      }
      if (resolved && "values" in resolved) {
        const values = Object.values(resolved.values as Record<string, number>);
        if (typeof item !== "number" || !Number.isInteger(item) || !values.includes(item))
          return fail(fieldPath, "enum value is unknown");
        if (item === 0) return fail(fieldPath, "UNSPECIFIED enum cannot enter profile identity");
        return item;
      }
      if (field.type === "string") {
        if (typeof item !== "string") return fail(fieldPath, "string required");
        return item;
      }
      if (field.type === "bool") {
        if (typeof item !== "boolean") return fail(fieldPath, "boolean required");
        return item;
      }
      if (["uint32", "fixed32"].includes(field.type)) {
        if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 0xffffffff)
          return fail(fieldPath, "uint32 required");
        return item;
      }
      if (field.type === "double") {
        if (typeof item !== "number" || !Number.isFinite(item) || Object.is(item, -0))
          return fail(fieldPath, "finite canonical double required");
        return item;
      }
      return fail(fieldPath, `unsupported identity scalar ${field.type}`);
    };
    if (field.repeated) {
      if (!present || !Array.isArray(value)) fail(fieldPath, "repeated field must be an array");
      const source = value as unknown[];
      const items = source.map(convert);
      if (
        [
          "visibleNodeIds",
          "visibleSurfaceIds",
          "visibleVariableIds",
          "requiredRuntimeCapabilities",
        ].includes(field.name) ||
        field.name.endsWith("Features")
      ) {
        if (
          (field.name === "requiredRuntimeCapabilities" || field.name.endsWith("Features")) &&
          items.includes(0)
        )
          fail(fieldPath, "UNSPECIFIED enum cannot enter a canonical set");
        for (let index = 1; index < items.length; index += 1)
          if (!ascending(items[index - 1] as string | number, items[index] as string | number))
            fail(fieldPath, "set values must be unique and canonical order");
      }
      if (
        [
          "renderSurfaces",
          "semanticSurfaces",
          "localOverlays",
          "states",
          "nodes",
          "surfaces",
          "variables",
          "timelines",
          "modelClips",
          "artifacts",
        ].includes(field.name)
      ) {
        for (let index = 1; index < items.length; index += 1) {
          const previous = keyedEntry(type.fullName, field.name, source[index - 1]);
          const current = keyedEntry(type.fullName, field.name, source[index]);
          if (previous === undefined || current === undefined || !ascending(previous, current))
            fail(fieldPath, "entries must be unique and canonical order");
        }
      }
      output[snakeCase(field.name)] = items;
    } else if (childType) {
      output[snakeCase(field.name)] = convert(value);
    } else {
      const defaultValue = ["uint64", "fixed64"].includes(field.type)
        ? "0"
        : field.type === "string"
          ? ""
          : field.type === "bool"
            ? false
            : 0;
      output[snakeCase(field.name)] = convert(present ? value : defaultValue);
    }
  }
  return output;
};

export const calculateProjectionProfileId = (descriptor: unknown): string => {
  const snapshot = snapshotPlainJson(descriptor);
  if (!snapshot.valid || !isRecord(snapshot.value))
    throw new TypeError("Profile descriptor must be plain JSON data.");
  const { projectionProfileId: _ignored, ...withoutId } = snapshot.value;
  const mapping = identityObject(
    getPresentationWireType(profileTypeName),
    withoutId,
    profileTypeName,
  );
  delete mapping["projection_profile_id"];
  return `pp_${hashCanonicalJsonPayload(mapping).slice("sha256:".length)}`;
};

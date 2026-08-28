import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  SerializedPresentationDefinitionV1,
  SerializedRenderBundleV1,
} from "@unframe/contracts/presentation";

import { canonicalJson, normalizedJson } from "./canonicalization/canonical-json.js";
import {
  parseIdInput,
  parsePresentationDefinitionInput,
  parseRenderBundleInput,
  parseSemanticSurfaceInput,
} from "./validation/contract-input.js";

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type PresentationDefinition = SerializedPresentationDefinitionV1;
export type RenderBundle = SerializedRenderBundleV1;
export type SemanticSurface = DeepReadonly<
  SerializedPresentationDefinitionV1["scene"]["surfaces"][string]
>;
export type SurfaceRenderIntent = SemanticSurface["renderIntent"];
export type SurfaceContentNode = SemanticSurface["contentNodes"][string];
export type CompletedSemanticTree = DeepReadonly<
  SerializedRenderBundleV1["surfaces"][string]["semanticsByState"][string]
>;
export type HitRegion = DeepReadonly<
  SerializedRenderBundleV1["surfaces"][string]["interactionsByState"][string][number]
>;
export type TextureArtifact = DeepReadonly<
  SerializedRenderBundleV1["surfaces"][string]["renderSurfaces"][string]["artifacts"][string]["states"][string]["textures"][number]
>;

export type Diagnostic = {
  code: string;
  path: readonly (string | number)[];
  message: string;
  relatedPath?: readonly (string | number)[];
};

export type ValidationResult<T> =
  | { valid: true; value: T; diagnostics: [] }
  | { valid: false; diagnostics: Diagnostic[] };

export type PresentationArtifacts = {
  definition: PresentationDefinition;
  renderBundle: RenderBundle;
};

type JsonRecord = Record<string, unknown>;
type DiagnosticPath = string | readonly (string | number)[];

const pathSegment = (value: unknown) => String(value).replaceAll("~", "~0").replaceAll("/", "~1");

const toPath = (path: DiagnosticPath): readonly (string | number)[] =>
  typeof path === "string"
    ? path
        .split("/")
        .filter(Boolean)
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    : path;

const diagnostic = (
  code: string,
  path: DiagnosticPath,
  message: string,
  relatedPath?: DiagnosticPath,
): Diagnostic =>
  relatedPath === undefined
    ? { code, path: toPath(path), message }
    : { code, path: toPath(path), message, relatedPath: toPath(relatedPath) };

const sorted = (diagnostics: Diagnostic[]) =>
  [...diagnostics].sort((left, right) => {
    const leftKey = `${left.path.join("/")}\u0000${left.code}`;
    const rightKey = `${right.path.join("/")}\u0000${right.code}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

const schemaPath = (path: readonly PropertyKey[]): readonly (string | number)[] =>
  path.map((segment) => (typeof segment === "number" ? segment : String(segment)));

const containerPath = (
  path: readonly (string | number)[],
  fields: readonly string[],
): readonly (string | number)[] | undefined => {
  for (let index = path.length - 1; index >= 0; index--)
    if (fields.includes(String(path[index]))) return path.slice(0, index + 1);
  return undefined;
};

const structuralDiagnostic = (
  contract: "definition" | "render-bundle",
  issue: { readonly path: readonly PropertyKey[]; readonly message: string },
): Diagnostic => {
  const path = schemaPath(issue.path);
  const joined = path.join("/");
  if (contract === "definition") {
    if (joined.startsWith("assets/"))
      return diagnostic("invalid-asset", path.slice(0, 2), "Asset descriptor is invalid.");
    if (joined.startsWith("scene/nodes/") && issue.message.includes("Unrecognized key"))
      return diagnostic(
        "unknown-surface-node-property",
        path.slice(0, 3),
        "SurfaceNode contains an unknown property.",
      );
    const vectorPath = containerPath(path, [
      "physicalSizeMeters",
      "logicalSize",
      "position",
      "scale",
      "center",
      "size",
    ]);
    if (vectorPath)
      return diagnostic("invalid-vector", vectorPath, "Vector does not match the contract schema.");
    const rotationPath = containerPath(path, ["rotation"]);
    if (rotationPath)
      return diagnostic(
        "invalid-quaternion",
        rotationPath,
        "Quaternion does not match the contract schema.",
      );
    const placementPath = containerPath(path, ["placement"]);
    if (joined.includes("/contentNodes/") && placementPath)
      return diagnostic(
        "invalid-text-placement",
        placementPath,
        "Text placement does not match the contract schema.",
      );
    return diagnostic("invalid-definition", path, issue.message);
  }
  const vectorPath = containerPath(path, ["logicalSize", "physicalSizeMeters", "pixelSize"]);
  if (vectorPath)
    return diagnostic("invalid-vector", vectorPath, "Vector does not match the contract schema.");
  return diagnostic("invalid-render-bundle", path, issue.message);
};

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordEntries = (value: unknown): [string, JsonRecord][] =>
  isRecord(value)
    ? Object.entries(value)
        .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
        .sort(([left], [right]) => compareStrings(left, right))
    : [];

const recordKeys = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);

const id = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const positive = (value: unknown): value is number => finite(value) && value > 0;

const validateRecordIds = (
  diagnostics: Diagnostic[],
  value: unknown,
  path: string,
  idField = "id",
) => {
  for (const [key, item] of recordEntries(value)) {
    if (item[idField] !== key)
      diagnostics.push(
        diagnostic(
          "record-key-id-mismatch",
          `${path}/${pathSegment(key)}`,
          `Record key must match value.${idField}.`,
        ),
      );
  }
};

const validateReferences = (
  diagnostics: Diagnostic[],
  references: readonly string[],
  target: Set<string>,
  path: string,
  code: string,
) => {
  for (const reference of references) {
    if (!target.has(reference))
      diagnostics.push(
        diagnostic(code, `${path}/${pathSegment(reference)}`, "Reference does not exist."),
      );
  }
};

const validateGroupOwner = (
  diagnostics: Diagnostic[],
  resource: JsonRecord,
  groupIds: Set<string>,
  path: string,
) => {
  const owner = isRecord(resource.owner) ? resource.owner : undefined;
  if (owner?.kind === "group" && (!id(owner.groupId) || !groupIds.has(owner.groupId)))
    diagnostics.push(
      diagnostic(
        "missing-owner-group",
        `${path}/owner/groupId`,
        "Group owner must reference an existing group.",
      ),
    );
};

const validateQuaternion = (diagnostics: Diagnostic[], value: unknown, path: string) => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) {
    diagnostics.push(
      diagnostic("invalid-quaternion", path, "Rotation must be a finite [x, y, z, w] quaternion."),
    );
    return;
  }
  const magnitude = Math.hypot(...value);
  if (magnitude === 0 || Math.abs(magnitude - 1) > 1e-9) {
    diagnostics.push(
      diagnostic(
        "unnormalized-quaternion",
        path,
        "Rotation quaternion must be nonzero and normalized.",
      ),
    );
  }
};

const validateVector = (
  diagnostics: Diagnostic[],
  value: unknown,
  dimensions: number,
  path: string,
  strictlyPositive = false,
) => {
  if (
    !Array.isArray(value) ||
    value.length !== dimensions ||
    !value.every(strictlyPositive ? positive : finite)
  ) {
    diagnostics.push(
      diagnostic(
        "invalid-vector",
        path,
        `Expected a ${strictlyPositive ? "positive " : "finite "}${dimensions}-vector.`,
      ),
    );
  }
};

const validateTree = (
  diagnostics: Diagnostic[],
  nodes: unknown,
  roots: unknown,
  path: string,
  childField?: string,
) => {
  const entries = recordEntries(nodes);
  const nodeIds = new Set(entries.map(([key]) => key));
  validateRecordIds(diagnostics, nodes, `${path}/nodes`);
  const rootIds = Array.isArray(roots) ? roots.filter(id) : [];
  const rootSet = new Set(rootIds);
  const parentById = new Map<string, string | null>();

  for (const [nodeId, node] of entries) {
    const parentId = node.parentId;
    if (parentId !== null && !id(parentId)) {
      diagnostics.push(
        diagnostic(
          "invalid-parent",
          `${path}/nodes/${pathSegment(nodeId)}/parentId`,
          "parentId must be an ID or null.",
        ),
      );
    } else {
      parentById.set(nodeId, parentId);
      if (parentId !== null && !nodeIds.has(parentId))
        diagnostics.push(
          diagnostic(
            "missing-parent",
            `${path}/nodes/${pathSegment(nodeId)}/parentId`,
            "Parent does not exist.",
          ),
        );
      if (parentId === null && !rootSet.has(nodeId))
        diagnostics.push(
          diagnostic(
            "orphan-root",
            `${path}/nodes/${pathSegment(nodeId)}`,
            "Root node must appear in rootNodeIds.",
          ),
        );
      if (parentId !== null && rootSet.has(nodeId))
        diagnostics.push(
          diagnostic(
            "non-root-in-root-list",
            `${path}/rootNodeIds`,
            "Only parentless nodes may be roots.",
          ),
        );
    }
    if (!Number.isInteger(node.order) || (node.order as number) < 0)
      diagnostics.push(
        diagnostic(
          "invalid-order",
          `${path}/nodes/${pathSegment(nodeId)}/order`,
          "order must be a non-negative integer.",
        ),
      );
    if (childField !== undefined) {
      const children = node[childField];
      if (!Array.isArray(children) || !children.every(id))
        diagnostics.push(
          diagnostic(
            "invalid-children",
            `${path}/nodes/${pathSegment(nodeId)}/${childField}`,
            "children must be an ID array.",
          ),
        );
      else
        validateReferences(
          diagnostics,
          children,
          nodeIds,
          `${path}/nodes/${pathSegment(nodeId)}/${childField}`,
          "missing-child",
        );
    }
  }

  for (const rootId of rootIds)
    if (!nodeIds.has(rootId))
      diagnostics.push(diagnostic("missing-root", `${path}/rootNodeIds`, "Root does not exist."));
  const siblingOrders = new Map<string, Set<number>>();
  for (const [nodeId, node] of entries) {
    const parentId = parentById.get(nodeId);
    if (parentId === undefined || !Number.isInteger(node.order)) continue;
    const key = parentId ?? "<root>";
    const orders = siblingOrders.get(key) ?? new Set<number>();
    if (orders.has(node.order as number))
      diagnostics.push(
        diagnostic(
          "duplicate-sibling-order",
          `${path}/nodes/${pathSegment(nodeId)}/order`,
          "Sibling order must be unique.",
        ),
      );
    orders.add(node.order as number);
    siblingOrders.set(key, orders);
  }
  for (const nodeId of nodeIds) {
    const visited = new Set<string>();
    let current: string | null | undefined = nodeId;
    while (current !== null && current !== undefined) {
      if (visited.has(current)) {
        diagnostics.push(
          diagnostic(
            "tree-cycle",
            `${path}/nodes/${pathSegment(nodeId)}`,
            "Tree must not contain a cycle.",
          ),
        );
        break;
      }
      visited.add(current);
      current = parentById.get(current);
    }
  }
};

const semanticOverrideFields = ["included", "text", "language", "alt"] as const;

const semanticRoles = new Set([
  "heading",
  "paragraph",
  "image",
  "button",
  "table",
  "list",
  "listItem",
]);

const isDenseArray = (value: unknown): value is unknown[] =>
  Array.isArray(value) &&
  Object.keys(value).length === value.length &&
  Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);

const hasOnlyFields = (value: JsonRecord, fields: readonly string[]) =>
  Object.keys(value).every((field) => fields.includes(field));

const hasOwnFields = (value: JsonRecord, fields: readonly string[]) =>
  fields.every((field) => Object.hasOwn(value, field));

const validateMaterializableSemanticTree = (
  diagnostics: Diagnostic[],
  tree: unknown,
  path: string,
) => {
  if (
    !isRecord(tree) ||
    !hasOwnFields(tree, ["rootNodeIds", "nodes"]) ||
    !isDenseArray(tree.rootNodeIds) ||
    !isRecord(tree.nodes)
  ) {
    diagnostics.push(diagnostic("invalid-semantic-tree", path, "Semantic tree is invalid."));
    return;
  }
  if (!tree.rootNodeIds.every(id) || new Set(tree.rootNodeIds).size !== tree.rootNodeIds.length)
    diagnostics.push(
      diagnostic("invalid-semantic-roots", `${path}/rootNodeIds`, "Roots must be unique IDs."),
    );
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    const nodePath = `${path}/nodes/${pathSegment(nodeId)}`;
    if (!isRecord(node)) {
      diagnostics.push(diagnostic("invalid-semantic-node", nodePath, "Semantic node is invalid."));
      continue;
    }
    if (
      !hasOnlyFields(node, [
        "id",
        "parentId",
        "order",
        "role",
        "text",
        "language",
        "alt",
        "interactionId",
      ]) ||
      !hasOwnFields(node, ["id", "parentId", "order", "role"]) ||
      node.id !== nodeId ||
      (node.parentId !== null && !id(node.parentId)) ||
      !Number.isInteger(node.order) ||
      (node.order as number) < 0 ||
      !semanticRoles.has(node.role as string) ||
      (node.text !== undefined && typeof node.text !== "string") ||
      (node.language !== undefined && (!id(node.language) || typeof node.language !== "string")) ||
      (node.alt !== undefined && typeof node.alt !== "string") ||
      (node.interactionId !== undefined && !id(node.interactionId))
    )
      diagnostics.push(diagnostic("invalid-semantic-node", nodePath, "Semantic node is invalid."));
  }
  validateTree(diagnostics, tree.nodes, tree.rootNodeIds, path);
};

const validateMaterializableSemanticOverrides = (
  diagnostics: Diagnostic[],
  tree: unknown,
  state: unknown,
  path: string,
) => {
  if (
    !isRecord(state) ||
    !Object.hasOwn(state, "semanticOverrides") ||
    !isDenseArray(state.semanticOverrides)
  ) {
    diagnostics.push(
      diagnostic("invalid-semantic-overrides", path, "Semantic overrides are invalid."),
    );
    return;
  }
  const nodes = isRecord(tree) && isRecord(tree.nodes) ? tree.nodes : undefined;
  for (const [layerIndex, layer] of state.semanticOverrides.entries()) {
    const layerPath = `${path}/${layerIndex}`;
    if (
      !isRecord(layer) ||
      !Object.hasOwn(layer, "nodes") ||
      !hasOnlyFields(layer, ["nodes"]) ||
      !isRecord(layer.nodes)
    ) {
      diagnostics.push(
        diagnostic("invalid-semantic-override", layerPath, "Semantic override is invalid."),
      );
      continue;
    }
    for (const [nodeId, override] of Object.entries(layer.nodes)) {
      const overridePath = `${layerPath}/nodes/${pathSegment(nodeId)}`;
      if (!isRecord(override)) {
        diagnostics.push(
          diagnostic("invalid-semantic-override", overridePath, "Node override is invalid."),
        );
        continue;
      }
      if (nodes === undefined || !Object.hasOwn(nodes, nodeId) || !isRecord(nodes[nodeId]))
        diagnostics.push(
          diagnostic(
            "missing-semantic-node",
            overridePath,
            "Semantic override references a missing node.",
          ),
        );
      if (
        !hasOnlyFields(override, semanticOverrideFields) ||
        (Object.hasOwn(override, "included") && typeof override.included !== "boolean") ||
        (Object.hasOwn(override, "text") &&
          override.text !== null &&
          typeof override.text !== "string") ||
        (Object.hasOwn(override, "language") &&
          override.language !== null &&
          (!id(override.language) || typeof override.language !== "string")) ||
        (Object.hasOwn(override, "alt") &&
          override.alt !== null &&
          typeof override.alt !== "string")
      )
        diagnostics.push(
          diagnostic("invalid-semantic-override", overridePath, "Node override is invalid."),
        );
    }
  }
};

const materializeSemanticTree = (
  surface: JsonRecord,
  state: JsonRecord,
  diagnostics: Diagnostic[] = [],
  path = "",
) => {
  const base = isRecord(surface.baseSemanticTree) ? structuredClone(surface.baseSemanticTree) : {};
  const nodes = isRecord(base.nodes) ? (base.nodes as Record<string, JsonRecord>) : {};
  const excluded = new Set<string>();
  const touched = new Set<string>();
  const isExcluded = (nodeId: string) => {
    const visited = new Set<string>();
    let current: string | null = nodeId;
    while (current !== null && !visited.has(current)) {
      if (excluded.has(current)) return true;
      visited.add(current);
      const node: unknown = nodes[current];
      current = isRecord(node) && id(node.parentId) ? node.parentId : null;
    }
    return false;
  };

  const layers = state.semanticOverrides as unknown[];
  for (const [layerIndex, layer] of layers.entries()) {
    for (const [nodeId, override] of recordEntries((layer as JsonRecord).nodes)) {
      const overridePath = `${path}/${layerIndex}/nodes/${pathSegment(nodeId)}`;
      const fields = semanticOverrideFields.filter((field) => Object.hasOwn(override, field));
      for (const field of fields) {
        const claim = `${pathSegment(nodeId)}\u0000${field}`;
        if (touched.has(claim))
          diagnostics.push(
            diagnostic(
              "duplicate-semantic-override-property",
              `${overridePath}/${field}`,
              "A semantic node property may be overridden only once per state.",
            ),
          );
        touched.add(claim);
      }
      if (override.included === true && isExcluded(nodeId))
        diagnostics.push(
          diagnostic(
            "semantic-node-reincluded",
            `${overridePath}/included`,
            "A node excluded by an earlier override or ancestor cannot be re-included.",
          ),
        );
      if (
        (override.included === false || isExcluded(nodeId)) &&
        fields.some((field) => field !== "included")
      )
        diagnostics.push(
          diagnostic(
            "excluded-semantic-node-property",
            overridePath,
            "Excluded semantic nodes cannot override text, language, or alt.",
          ),
        );
      if (override.included === false) excluded.add(nodeId);
      const node = Object.hasOwn(nodes, nodeId) ? nodes[nodeId] : undefined;
      if (node === undefined) continue;
      for (const field of ["text", "language", "alt"] as const)
        if (Object.hasOwn(override, field)) {
          if (override[field] === null) delete node[field];
          else node[field] = override[field];
        }
    }
  }
  for (const nodeId of Object.keys(nodes)) if (isExcluded(nodeId)) delete nodes[nodeId];
  base.rootNodeIds = Array.isArray(base.rootNodeIds)
    ? base.rootNodeIds.filter((nodeId) => Object.hasOwn(nodes, nodeId))
    : [];
  return base;
};

export const materializeCompletedSemanticTree = (
  surface: SemanticSurface,
  stateId: string,
): ValidationResult<CompletedSemanticTree> => {
  try {
    const parsedSurface = parseSemanticSurfaceInput(surface);
    if (!parsedSurface.success || !parseIdInput(stateId).success)
      return {
        valid: false,
        diagnostics: [diagnostic("invalid-semantic-surface", "", "Surface input is invalid.")],
      };
    const validatedSurface = parsedSurface.data;
    if (!Object.hasOwn(validatedSurface.states, stateId))
      return {
        valid: false,
        diagnostics: [
          diagnostic("unknown-surface-state", "/states", "Surface state does not exist."),
        ],
      };
    const state = validatedSurface.states[stateId]!;
    const diagnostics: Diagnostic[] = [];
    validateMaterializableSemanticTree(
      diagnostics,
      validatedSurface.baseSemanticTree,
      "/baseSemanticTree",
    );
    validateMaterializableSemanticOverrides(
      diagnostics,
      validatedSurface.baseSemanticTree,
      state,
      `/states/${pathSegment(stateId)}/semanticOverrides`,
    );
    if (diagnostics.length > 0) return { valid: false, diagnostics: sorted(diagnostics) };
    const tree = materializeSemanticTree(
      validatedSurface,
      state,
      diagnostics,
      `/states/${pathSegment(stateId)}/semanticOverrides`,
    );
    return diagnostics.length === 0
      ? { valid: true, value: tree as CompletedSemanticTree, diagnostics: [] }
      : { valid: false, diagnostics: sorted(diagnostics) };
  } catch {
    return {
      valid: false,
      diagnostics: [diagnostic("invalid-semantic-surface", "", "Surface input is invalid.")],
    };
  }
};

export const validatePresentationDefinition = (
  input: unknown,
): ValidationResult<SerializedPresentationDefinitionV1> => {
  const parsed = parsePresentationDefinitionInput(input);
  if (!parsed.success && parsed.snapshot === undefined)
    return {
      valid: false,
      diagnostics: sorted(parsed.issues.map((issue) => structuralDiagnostic("definition", issue))),
    };
  input = parsed.success ? parsed.data : parsed.snapshot;
  const diagnostics: Diagnostic[] = parsed.success
    ? []
    : parsed.issues.map((issue) => structuralDiagnostic("definition", issue));
  if (!isRecord(input))
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-definition", "", "PresentationDefinition must be an object."),
      ],
    };
  const scene = input.scene;
  const flow = input.flow;
  if (!isRecord(scene) || !isRecord(flow))
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-definition", "", "PresentationDefinition is missing scene or flow."),
      ],
    };
  const nodes = scene.nodes;
  const surfaces = scene.surfaces;
  validateRecordIds(diagnostics, nodes, "/scene/nodes");
  validateRecordIds(diagnostics, surfaces, "/scene/surfaces");
  const nodeEntries = recordEntries(nodes);
  const surfaceEntries = recordEntries(surfaces);
  const nodeIds = new Set(nodeEntries.map(([key]) => key));
  const surfaceIds = new Set(surfaceEntries.map(([key]) => key));
  const groupIds = new Set(recordEntries(flow.groups).map(([key]) => key));
  const resourceIds = new Map<string, string>();
  const registerResourceIds = (record: unknown, path: string) => {
    for (const resourceId of recordKeys(record).sort(compareStrings)) {
      const previousPath = resourceIds.get(resourceId);
      const currentPath = `${path}/${pathSegment(resourceId)}`;
      if (previousPath !== undefined)
        diagnostics.push(
          diagnostic(
            "duplicate-resource-id",
            currentPath,
            "Presentation resource IDs must be globally unique.",
            previousPath,
          ),
        );
      else resourceIds.set(resourceId, currentPath);
    }
  };
  registerResourceIds(input.assets, "/assets");
  registerResourceIds(isRecord(input.stage) ? input.stage.zones : undefined, "/stage/zones");
  registerResourceIds(nodes, "/scene/nodes");
  registerResourceIds(surfaces, "/scene/surfaces");
  registerResourceIds(flow.groups, "/flow/groups");
  registerResourceIds(flow.variables, "/flow/variables");
  const surfaceHosts = new Map<string, string>();
  const spatialParents = new Map<string, string | null>();
  const spatialOrders = new Map<string, Set<number>>();

  const stage = isRecord(input.stage) ? input.stage : undefined;
  validateVector(diagnostics, stage?.size, 3, "/stage/size", true);
  validateRecordIds(diagnostics, stage?.zones, "/stage/zones");
  for (const [zoneId, zone] of recordEntries(stage?.zones)) {
    validateGroupOwner(diagnostics, zone, groupIds, `/stage/zones/${pathSegment(zoneId)}`);
    validateVector(diagnostics, zone.center, 3, `/stage/zones/${pathSegment(zoneId)}/center`);
    validateVector(diagnostics, zone.size, 3, `/stage/zones/${pathSegment(zoneId)}/size`, true);
  }
  validateRecordIds(diagnostics, input.assets, "/assets");
  for (const [assetId, value] of Object.entries(isRecord(input.assets) ? input.assets : {})) {
    const asset = isRecord(value) ? value : undefined;
    if (
      asset === undefined ||
      !hasOnlyFields(asset, ["id", "mediaType", "checksum"]) ||
      asset.id !== assetId ||
      !id(asset.mediaType) ||
      !id(asset.checksum)
    )
      diagnostics.push(
        diagnostic(
          "invalid-asset",
          `/assets/${pathSegment(assetId)}`,
          "Asset descriptor must match the portable contract shape.",
        ),
      );
  }

  for (const [nodeId, node] of nodeEntries) {
    if (
      !hasOnlyFields(node, [
        "id",
        "name",
        "kind",
        "owner",
        "audience",
        "parent",
        "order",
        "transform",
        "active",
        "visible",
        "opacity",
        "surfaceId",
      ])
    )
      diagnostics.push(
        diagnostic(
          "unknown-surface-node-property",
          `/scene/nodes/${pathSegment(nodeId)}`,
          "SurfaceNode contains an unknown property.",
        ),
      );
    validateGroupOwner(diagnostics, node, groupIds, `/scene/nodes/${pathSegment(nodeId)}`);
    const surfaceId = node.surfaceId;
    if (!id(surfaceId) || !surfaceIds.has(surfaceId))
      diagnostics.push(
        diagnostic(
          "missing-surface",
          `/scene/nodes/${pathSegment(nodeId)}/surfaceId`,
          "SurfaceNode must reference a SemanticSurface.",
        ),
      );
    else if (surfaceHosts.has(surfaceId))
      diagnostics.push(
        diagnostic(
          "surface-node-cardinality",
          `/scene/nodes/${pathSegment(nodeId)}/surfaceId`,
          "A SemanticSurface may have one host node.",
          `/scene/nodes/${pathSegment(surfaceHosts.get(surfaceId))}`,
        ),
      );
    else surfaceHosts.set(surfaceId, nodeId);
    const parent = node.parent;
    const parentId =
      isRecord(parent) && parent.kind === "node" && id(parent.nodeId) ? parent.nodeId : null;
    spatialParents.set(nodeId, parentId);
    if (
      isRecord(parent) &&
      parent.kind === "node" &&
      (!id(parent.nodeId) || !nodeIds.has(parent.nodeId))
    )
      diagnostics.push(
        diagnostic(
          "missing-spatial-parent",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "Spatial parent does not exist.",
        ),
      );
    if (!Number.isInteger(node.order) || (node.order as number) < 0)
      diagnostics.push(
        diagnostic(
          "invalid-order",
          `/scene/nodes/${pathSegment(nodeId)}/order`,
          "order must be a non-negative integer.",
        ),
      );
    else {
      const siblingKey = parentId ?? "<root>";
      const orders = spatialOrders.get(siblingKey) ?? new Set<number>();
      if (orders.has(node.order as number))
        diagnostics.push(
          diagnostic(
            "duplicate-sibling-order",
            `/scene/nodes/${pathSegment(nodeId)}/order`,
            "Sibling order must be unique.",
          ),
        );
      orders.add(node.order as number);
      spatialOrders.set(siblingKey, orders);
    }
    validateVector(
      diagnostics,
      isRecord(node.transform) ? node.transform.position : undefined,
      3,
      `/scene/nodes/${pathSegment(nodeId)}/transform/position`,
    );
    validateQuaternion(
      diagnostics,
      isRecord(node.transform) ? node.transform.rotation : undefined,
      `/scene/nodes/${pathSegment(nodeId)}/transform/rotation`,
    );
    validateVector(
      diagnostics,
      isRecord(node.transform) ? node.transform.scale : undefined,
      3,
      `/scene/nodes/${pathSegment(nodeId)}/transform/scale`,
      true,
    );
  }
  for (const [nodeId, node] of nodeEntries) {
    const parent = isRecord(node.parent) ? node.parent : undefined;
    if (parent?.kind !== "node" || !id(parent.nodeId)) continue;
    const target = recordEntries(nodes).find(([key]) => key === parent.nodeId)?.[1];
    const sourceOwner = isRecord(node.owner) ? node.owner : undefined;
    const targetOwner = isRecord(target?.owner) ? target.owner : undefined;
    if (sourceOwner?.kind === "presentation" && targetOwner?.kind === "group")
      diagnostics.push(
        diagnostic(
          "invalid-owner-parent-lifetime",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "Presentation-owned nodes cannot parent under group-owned nodes.",
        ),
      );
    if (
      sourceOwner?.kind === "group" &&
      targetOwner?.kind === "group" &&
      sourceOwner.groupId !== targetOwner.groupId
    )
      diagnostics.push(
        diagnostic(
          "invalid-owner-parent-lifetime",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "Nodes from different groups cannot form a parent relation.",
        ),
      );
  }
  for (const nodeId of nodeIds) {
    const visited = new Set<string>();
    let current: string | null | undefined = nodeId;
    while (current !== null && current !== undefined) {
      if (visited.has(current)) {
        diagnostics.push(
          diagnostic(
            "spatial-cycle",
            `/scene/nodes/${pathSegment(nodeId)}`,
            "Spatial tree must not contain a cycle.",
          ),
        );
        break;
      }
      visited.add(current);
      current = spatialParents.get(current);
    }
  }
  for (const [surfaceId, surface] of surfaceEntries) {
    if (!id(surface.hostNodeId) || surfaceHosts.get(surfaceId) !== surface.hostNodeId)
      diagnostics.push(
        diagnostic(
          "surface-node-cardinality",
          `/scene/surfaces/${pathSegment(surfaceId)}/hostNodeId`,
          "SemanticSurface and SurfaceNode must form a 1:1 relation.",
        ),
      );
    validateVector(
      diagnostics,
      surface.physicalSizeMeters,
      2,
      `/scene/surfaces/${pathSegment(surfaceId)}/physicalSizeMeters`,
      true,
    );
    validateVector(
      diagnostics,
      surface.logicalSize,
      2,
      `/scene/surfaces/${pathSegment(surfaceId)}/logicalSize`,
      true,
    );
    validateRecordIds(
      diagnostics,
      surface.contentNodes,
      `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes`,
    );
    const contentNodes = recordEntries(surface.contentNodes);
    const contentIds = new Set(contentNodes.map(([key]) => key));
    const rootFrameId = surface.rootFrameId;
    if (!id(rootFrameId) || !contentIds.has(rootFrameId))
      diagnostics.push(
        diagnostic(
          "missing-root-frame",
          `/scene/surfaces/${pathSegment(surfaceId)}/rootFrameId`,
          "rootFrameId must exist.",
        ),
      );
    const rootFrame = id(rootFrameId)
      ? recordEntries(surface.contentNodes).find(([key]) => key === rootFrameId)?.[1]
      : undefined;
    if (rootFrame?.kind !== "frame" || rootFrame.parentId !== null)
      diagnostics.push(
        diagnostic(
          "invalid-root-frame",
          `/scene/surfaces/${pathSegment(surfaceId)}/rootFrameId`,
          "rootFrameId must reference a parentless Frame.",
        ),
      );
    const pseudoNodes: Record<string, JsonRecord> = {};
    for (const [contentId, content] of contentNodes)
      pseudoNodes[contentId] = { ...content, children: content.children ?? [] };
    validateTree(
      diagnostics,
      pseudoNodes,
      rootFrameId && id(rootFrameId) ? [rootFrameId] : [],
      `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes`,
      "children",
    );
    for (const [contentId, content] of contentNodes) {
      const children = Array.isArray(content.children) ? content.children.filter(id) : [];
      for (const childId of children)
        if (
          recordEntries(surface.contentNodes).find(([key]) => key === childId)?.[1].parentId !==
          contentId
        )
          diagnostics.push(
            diagnostic(
              "content-parent-child-mismatch",
              `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}/children`,
              "Child must reference this Frame as parent.",
            ),
          );
      const parentChildren = id(content.parentId)
        ? recordEntries(surface.contentNodes).find(([key]) => key === content.parentId)?.[1]
            .children
        : undefined;
      if (
        id(content.parentId) &&
        (!Array.isArray(parentChildren) || !parentChildren.includes(contentId))
      )
        diagnostics.push(
          diagnostic(
            "orphan-content-node",
            `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}`,
            "Non-root content node must appear in its parent children.",
          ),
        );
      if (content.kind === "text") {
        const parent = id(content.parentId)
          ? recordEntries(surface.contentNodes).find(([key]) => key === content.parentId)?.[1]
          : undefined;
        if (parent?.kind !== "frame")
          diagnostics.push(
            diagnostic(
              "invalid-text-parent",
              `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}/parentId`,
              "Text nodes must have a Frame parent.",
            ),
          );
        const placement = isRecord(content.placement) ? content.placement : undefined;
        if (
          !finite(placement?.x) ||
          !finite(placement?.y) ||
          !positive(placement?.width) ||
          !positive(placement?.height)
        )
          diagnostics.push(
            diagnostic(
              "invalid-text-placement",
              `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}/placement`,
              "Text placement must use finite coordinates and positive dimensions.",
            ),
          );
      }
    }
    const semanticTree = isRecord(surface.baseSemanticTree) ? surface.baseSemanticTree : undefined;
    const semanticTreeDiagnosticsStart = diagnostics.length;
    validateMaterializableSemanticTree(
      diagnostics,
      semanticTree,
      `/scene/surfaces/${pathSegment(surfaceId)}/baseSemanticTree`,
    );
    const hasInvalidSemanticTree = diagnostics.length > semanticTreeDiagnosticsStart;
    validateRecordIds(
      diagnostics,
      surface.interactions,
      `/scene/surfaces/${pathSegment(surfaceId)}/interactions`,
    );
    validateRecordIds(
      diagnostics,
      surface.states,
      `/scene/surfaces/${pathSegment(surfaceId)}/states`,
    );
    const interactionIds = new Set(recordEntries(surface.interactions).map(([key]) => key));
    for (const [semanticNodeId, semanticNode] of recordEntries(semanticTree?.nodes))
      if (
        semanticNode.interactionId !== undefined &&
        (!id(semanticNode.interactionId) || !interactionIds.has(semanticNode.interactionId))
      )
        diagnostics.push(
          diagnostic(
            "missing-interaction",
            `/scene/surfaces/${pathSegment(surfaceId)}/baseSemanticTree/nodes/${pathSegment(semanticNodeId)}/interactionId`,
            "Semantic node interaction must exist.",
          ),
        );
    const stateIds = new Set(recordEntries(surface.states).map(([key]) => key));
    const finiteStateIds =
      isRecord(surface.renderIntent) &&
      isRecord(surface.renderIntent.updateModel) &&
      surface.renderIntent.updateModel.kind === "finite-state" &&
      Array.isArray(surface.renderIntent.updateModel.stateIds)
        ? new Set(surface.renderIntent.updateModel.stateIds.filter(id))
        : undefined;
    if (
      finiteStateIds !== undefined &&
      (finiteStateIds.size !== stateIds.size ||
        [...stateIds].some((stateId) => !finiteStateIds.has(stateId)))
    )
      diagnostics.push(
        diagnostic(
          "render-intent-state-set-mismatch",
          `/scene/surfaces/${pathSegment(surfaceId)}/renderIntent/updateModel/stateIds`,
          "finite-state stateIds must exactly match surface states.",
        ),
      );
    if (!id(surface.initialStateId) || !stateIds.has(surface.initialStateId))
      diagnostics.push(
        diagnostic(
          "missing-initial-state",
          `/scene/surfaces/${pathSegment(surfaceId)}/initialStateId`,
          "initialStateId must exist.",
        ),
      );
    for (const [stateId, state] of recordEntries(surface.states)) {
      const enabled = Array.isArray(state.enabledInteractionIds)
        ? state.enabledInteractionIds.filter(id)
        : [];
      validateReferences(
        diagnostics,
        enabled,
        interactionIds,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/enabledInteractionIds`,
        "missing-interaction",
      );
      const semanticOverrideDiagnosticsStart = diagnostics.length;
      validateMaterializableSemanticOverrides(
        diagnostics,
        semanticTree,
        state,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/semanticOverrides`,
      );
      if (hasInvalidSemanticTree || diagnostics.length > semanticOverrideDiagnosticsStart) continue;
      const materializedTree = materializeSemanticTree(
        surface,
        state,
        diagnostics,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/semanticOverrides`,
      );
      validateTree(
        diagnostics,
        materializedTree.nodes,
        materializedTree.rootNodeIds,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/materializedSemanticTree`,
      );
    }
  }
  validateRecordIds(diagnostics, flow.groups, "/flow/groups");
  validateRecordIds(diagnostics, flow.variables, "/flow/variables");
  const groups = recordEntries(flow.groups);
  const flowGroupIds = new Set(groups.map(([key]) => key));
  if (!id(flow.initialGroupId) || !flowGroupIds.has(flow.initialGroupId))
    diagnostics.push(
      diagnostic("missing-initial-group", "/flow/initialGroupId", "initialGroupId must exist."),
    );
  for (const [groupId, group] of groups) {
    validateRecordIds(diagnostics, group.steps, `/flow/groups/${pathSegment(groupId)}/steps`);
    const stepIds = new Set(recordEntries(group.steps).map(([key]) => key));
    registerResourceIds(group.steps, `/flow/groups/${pathSegment(groupId)}/steps`);
    if (!id(group.initialStepId) || !stepIds.has(group.initialStepId))
      diagnostics.push(
        diagnostic(
          "missing-initial-step",
          `/flow/groups/${pathSegment(groupId)}/initialStepId`,
          "initialStepId must exist.",
        ),
      );
  }
  for (const [variableId, variable] of recordEntries(flow.variables)) {
    validateGroupOwner(
      diagnostics,
      variable,
      groupIds,
      `/flow/variables/${pathSegment(variableId)}`,
    );
    const type = variable.type;
    const value = variable.initialValue;
    if (
      (type === "string" && typeof value !== "string") ||
      (type === "boolean" && typeof value !== "boolean") ||
      (type === "number" && !finite(value)) ||
      (type === "null" && value !== null)
    )
      diagnostics.push(
        diagnostic(
          "variable-type-mismatch",
          `/flow/variables/${pathSegment(variableId)}/initialValue`,
          "initialValue must match the declared scalar type.",
        ),
      );
  }
  return diagnostics.length === 0
    ? {
        valid: true,
        value: input as unknown as SerializedPresentationDefinitionV1,
        diagnostics: [],
      }
    : { valid: false, diagnostics: sorted(diagnostics) };
};

export const validateRenderBundle = (
  input: unknown,
): ValidationResult<SerializedRenderBundleV1> => {
  const parsed = parseRenderBundleInput(input);
  if (!parsed.success && parsed.snapshot === undefined)
    return {
      valid: false,
      diagnostics: sorted(
        parsed.issues.map((issue) => structuralDiagnostic("render-bundle", issue)),
      ),
    };
  input = parsed.success ? parsed.data : parsed.snapshot;
  const diagnostics: Diagnostic[] = parsed.success
    ? []
    : parsed.issues.map((issue) => structuralDiagnostic("render-bundle", issue));
  if (!isRecord(input) || !isRecord(input.surfaces))
    return {
      valid: false,
      diagnostics: [diagnostic("invalid-render-bundle", "", "RenderBundle must contain surfaces.")],
    };
  const renderSurfacePaths = new Map<string, string>();
  const artifactPaths = new Map<string, string>();
  validateRecordIds(diagnostics, input.surfaces, "/surfaces", "semanticSurfaceId");
  for (const [surfaceId, surface] of recordEntries(input.surfaces)) {
    validateVector(
      diagnostics,
      surface.logicalSize,
      2,
      `/surfaces/${pathSegment(surfaceId)}/logicalSize`,
      true,
    );
    validateVector(
      diagnostics,
      surface.physicalSizeMeters,
      2,
      `/surfaces/${pathSegment(surfaceId)}/physicalSizeMeters`,
      true,
    );
    for (const [stateId, semanticTree] of recordEntries(surface.semanticsByState))
      validateTree(
        diagnostics,
        semanticTree.nodes,
        semanticTree.rootNodeIds,
        `/surfaces/${pathSegment(surfaceId)}/semanticsByState/${pathSegment(stateId)}`,
      );
    validateRecordIds(
      diagnostics,
      surface.renderSurfaces,
      `/surfaces/${pathSegment(surfaceId)}/renderSurfaces`,
    );
    const renderSurfaceIds = new Set(recordEntries(surface.renderSurfaces).map(([key]) => key));
    const declaredRenderSurfaceIds = Array.isArray(surface.renderSurfaceIds)
      ? surface.renderSurfaceIds.filter(id)
      : [];
    validateReferences(
      diagnostics,
      declaredRenderSurfaceIds,
      renderSurfaceIds,
      `/surfaces/${pathSegment(surfaceId)}/renderSurfaceIds`,
      "missing-render-surface",
    );
    if (
      declaredRenderSurfaceIds.length !== renderSurfaceIds.size ||
      new Set(declaredRenderSurfaceIds).size !== renderSurfaceIds.size
    )
      diagnostics.push(
        diagnostic(
          "render-surface-set-mismatch",
          `/surfaces/${pathSegment(surfaceId)}/renderSurfaceIds`,
          "renderSurfaceIds must contain each render surface exactly once.",
        ),
      );
    for (const [renderSurfaceId, renderSurface] of recordEntries(surface.renderSurfaces)) {
      const renderSurfacePath = `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}`;
      const previousRenderSurfacePath = renderSurfacePaths.get(renderSurfaceId);
      if (previousRenderSurfacePath !== undefined)
        diagnostics.push(
          diagnostic(
            "duplicate-render-surface-id",
            renderSurfacePath,
            "RenderSurface IDs must be globally unique within a RenderBundle.",
            previousRenderSurfacePath,
          ),
        );
      else renderSurfacePaths.set(renderSurfaceId, renderSurfacePath);
      if (renderSurface.semanticSurfaceId !== surfaceId)
        diagnostics.push(
          diagnostic(
            "render-surface-semantic-surface-mismatch",
            `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/semanticSurfaceId`,
            "RenderSurface must belong to its enclosing SemanticSurface.",
          ),
        );
      validateRecordIds(
        diagnostics,
        renderSurface.artifacts,
        `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/artifacts`,
      );
      const artifactIds = new Set(recordEntries(renderSurface.artifacts).map(([key]) => key));
      for (const [stateId, binding] of recordEntries(renderSurface.stateBindings)) {
        if (binding.kind === "artifacts")
          validateReferences(
            diagnostics,
            Array.isArray(binding.artifactIds) ? binding.artifactIds.filter(id) : [],
            artifactIds,
            `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/stateBindings/${pathSegment(stateId)}/artifactIds`,
            "missing-artifact",
          );
      }
      for (const [artifactId, artifact] of recordEntries(renderSurface.artifacts)) {
        const artifactPath = `${renderSurfacePath}/artifacts/${pathSegment(artifactId)}`;
        const previousArtifactPath = artifactPaths.get(artifactId);
        if (previousArtifactPath !== undefined)
          diagnostics.push(
            diagnostic(
              "duplicate-renderer-artifact-id",
              artifactPath,
              "Renderer artifact IDs must be globally unique within a RenderBundle.",
              previousArtifactPath,
            ),
          );
        else artifactPaths.set(artifactId, artifactPath);
        validateRecordIds(
          diagnostics,
          artifact.states,
          `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/artifacts/${pathSegment(artifactId)}/states`,
          "stateId",
        );
        for (const [stateId, state] of recordEntries(artifact.states))
          for (const [textureIndex, texture] of (Array.isArray(state.textures)
            ? state.textures
            : []
          ).entries())
            validateVector(
              diagnostics,
              isRecord(texture) ? texture.pixelSize : undefined,
              2,
              `${artifactPath}/states/${pathSegment(stateId)}/textures/${textureIndex}/pixelSize`,
              true,
            );
      }
    }
  }
  return diagnostics.length === 0
    ? {
        valid: true,
        value: input as unknown as SerializedRenderBundleV1,
        diagnostics: [],
      }
    : { valid: false, diagnostics: sorted(diagnostics) };
};

export const validatePresentationArtifacts = (
  definition: unknown,
  renderBundle: unknown,
): ValidationResult<PresentationArtifacts> => {
  const definitionResult = validatePresentationDefinition(definition);
  const bundleResult = validateRenderBundle(renderBundle);
  const diagnostics = [...definitionResult.diagnostics, ...bundleResult.diagnostics];
  if (definitionResult.valid && bundleResult.valid) {
    const expectedHash = hashPresentationDefinition(definitionResult.value);
    if (!expectedHash.valid || bundleResult.value.definitionHash !== expectedHash.value)
      diagnostics.push(
        diagnostic(
          "definition-hash-mismatch",
          "/definitionHash",
          "RenderBundle definitionHash must match the canonical PresentationDefinition hash.",
        ),
      );
    const definitionSurfaces = recordEntries(definitionResult.value.scene.surfaces);
    const definitionSurfaceMap = new Map(definitionSurfaces);
    const bundleSurfaceIds = new Set(
      recordEntries(bundleResult.value.surfaces).map(([key]) => key),
    );
    for (const [surfaceId] of definitionSurfaces)
      if (!bundleSurfaceIds.has(surfaceId))
        diagnostics.push(
          diagnostic(
            "missing-bundle-surface",
            `/scene/surfaces/${pathSegment(surfaceId)}`,
            "Definition surface must have a RenderBundle surface.",
          ),
        );
    for (const [surfaceId, bundleSurface] of recordEntries(bundleResult.value.surfaces)) {
      const definitionSurface = definitionSurfaceMap.get(surfaceId);
      if (definitionSurface === undefined) {
        diagnostics.push(
          diagnostic(
            "missing-definition-surface",
            `/surfaces/${pathSegment(surfaceId)}`,
            "RenderBundle surface does not exist in PresentationDefinition.",
          ),
        );
        continue;
      }
      if (
        JSON.stringify(bundleSurface.logicalSize) !==
          JSON.stringify(definitionSurface.logicalSize) ||
        JSON.stringify(bundleSurface.physicalSizeMeters) !==
          JSON.stringify(definitionSurface.physicalSizeMeters)
      )
        diagnostics.push(
          diagnostic(
            "compiled-surface-size-mismatch",
            `/surfaces/${pathSegment(surfaceId)}`,
            "Compiled surface sizes must match the Definition.",
          ),
        );
      const definitionStates = new Set(recordEntries(definitionSurface.states).map(([key]) => key));
      const requireExactStateSet = (record: unknown, path: string) => {
        const actual = new Set(recordKeys(record));
        if (
          actual.size !== definitionStates.size ||
          [...definitionStates].some((stateId) => !actual.has(stateId))
        )
          diagnostics.push(
            diagnostic(
              "surface-state-set-mismatch",
              path,
              "State records must exactly match the Definition states.",
            ),
          );
      };
      requireExactStateSet(
        bundleSurface.semanticsByState,
        `/surfaces/${pathSegment(surfaceId)}/semanticsByState`,
      );
      requireExactStateSet(
        bundleSurface.interactionsByState,
        `/surfaces/${pathSegment(surfaceId)}/interactionsByState`,
      );
      const interactionIds = new Set(
        recordEntries(definitionSurface.interactions).map(([key]) => key),
      );
      const interactionMap = new Map(recordEntries(definitionSurface.interactions));
      for (const stateId of definitionStates) {
        const state = isRecord(definitionSurface.states)
          ? definitionSurface.states[stateId]
          : undefined;
        const enabledInteractionIds =
          isRecord(state) && Array.isArray(state.enabledInteractionIds)
            ? new Set(state.enabledInteractionIds.filter(id))
            : new Set<string>();
        const semanticTree = isRecord(bundleSurface.semanticsByState)
          ? bundleSurface.semanticsByState[stateId]
          : undefined;
        if (
          isRecord(state) &&
          isRecord(semanticTree) &&
          normalizedJson(materializeSemanticTree(definitionSurface, state)) !==
            normalizedJson(semanticTree)
        )
          diagnostics.push(
            diagnostic(
              "materialized-semantic-tree-mismatch",
              `/surfaces/${pathSegment(surfaceId)}/semanticsByState/${pathSegment(stateId)}`,
              "Bundle semantic tree must equal the Definition state materialization.",
            ),
          );
        const semanticNodes = new Map(
          recordEntries(isRecord(semanticTree) ? semanticTree.nodes : undefined),
        );
        const regions = isRecord(bundleSurface.interactionsByState)
          ? bundleSurface.interactionsByState[stateId]
          : undefined;
        if (!Array.isArray(regions)) continue;
        const coveredInteractionIds = new Set<string>();
        for (const [regionIndex, region] of regions.entries()) {
          if (!isRecord(region)) continue;
          if (
            !id(region.interactionId) ||
            !interactionIds.has(region.interactionId) ||
            !enabledInteractionIds.has(region.interactionId)
          )
            diagnostics.push(
              diagnostic(
                "invalid-hit-region-interaction",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/interactionId`,
                "Hit region must reference an enabled Definition interaction.",
              ),
            );
          if (id(region.interactionId)) coveredInteractionIds.add(region.interactionId);
          const interaction = id(region.interactionId)
            ? interactionMap.get(region.interactionId)
            : undefined;
          if (interaction !== undefined && region.event !== interaction.event)
            diagnostics.push(
              diagnostic(
                "hit-region-event-mismatch",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/event`,
                "Hit region event must match the Definition interaction event.",
              ),
            );
          const semanticNode = id(region.semanticNodeId)
            ? semanticNodes.get(region.semanticNodeId)
            : undefined;
          if (semanticNode === undefined || semanticNode.interactionId !== region.interactionId)
            diagnostics.push(
              diagnostic(
                "invalid-hit-region-semantic-node",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/semanticNodeId`,
                "Hit region must reference its interactive semantic node.",
              ),
            );
          const bounds = region.bounds;
          if (
            !isRecord(bounds) ||
            !finite(bounds.x) ||
            !finite(bounds.y) ||
            !positive(bounds.width) ||
            !positive(bounds.height) ||
            (bounds.x as number) < 0 ||
            (bounds.y as number) < 0 ||
            (bounds.x as number) + (bounds.width as number) > 1 ||
            (bounds.y as number) + (bounds.height as number) > 1
          )
            diagnostics.push(
              diagnostic(
                "invalid-hit-region-bounds",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/bounds`,
                "Normalized hit region bounds must be finite and within [0, 1].",
              ),
            );
        }
        for (const interactionId of [...enabledInteractionIds].sort())
          if (!coveredInteractionIds.has(interactionId))
            diagnostics.push(
              diagnostic(
                "missing-enabled-interaction-region",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}`,
                "Every enabled interaction must have at least one hit region.",
              ),
            );
      }
      for (const [renderSurfaceId, renderSurface] of recordEntries(bundleSurface.renderSurfaces)) {
        const bounds = isRecord(renderSurface.logicalBounds)
          ? renderSurface.logicalBounds
          : undefined;
        const logicalSize = Array.isArray(bundleSurface.logicalSize)
          ? bundleSurface.logicalSize
          : [];
        if (
          !finite(bounds?.x) ||
          !finite(bounds?.y) ||
          !positive(bounds?.width) ||
          !positive(bounds?.height) ||
          (bounds.x as number) < 0 ||
          (bounds.y as number) < 0 ||
          !positive(logicalSize[0]) ||
          !positive(logicalSize[1]) ||
          (bounds.x as number) + (bounds.width as number) > logicalSize[0] ||
          (bounds.y as number) + (bounds.height as number) > logicalSize[1]
        )
          diagnostics.push(
            diagnostic(
              "invalid-render-surface-bounds",
              `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/logicalBounds`,
              "RenderSurface bounds must be finite, positive, and inside the SemanticSurface.",
            ),
          );
        requireExactStateSet(
          renderSurface.stateBindings,
          `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/stateBindings`,
        );
        for (const [artifactId, artifact] of recordEntries(renderSurface.artifacts))
          requireExactStateSet(
            artifact.states,
            `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/artifacts/${pathSegment(artifactId)}/states`,
          );
      }
    }
  }
  return diagnostics.length === 0 && definitionResult.valid && bundleResult.valid
    ? {
        valid: true,
        value: {
          definition: definitionResult.value,
          renderBundle: bundleResult.value,
        },
        diagnostics: [],
      }
    : { valid: false, diagnostics: sorted(diagnostics) };
};

const validatedCanonicalJson = <T>(
  input: unknown,
  validate: (value: unknown) => ValidationResult<T>,
): ValidationResult<string> => {
  const result = validate(input);
  if (!result.valid) return result;
  try {
    return { valid: true, value: canonicalJson(result.value), diagnostics: [] };
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "invalid-canonical-json",
          [],
          "Artifact cannot be represented as canonical JSON.",
        ),
      ],
    };
  }
};

export const canonicalizePresentationDefinition = (input: unknown) =>
  validatedCanonicalJson(input, validatePresentationDefinition);
export const canonicalizeRenderBundle = (input: unknown) =>
  validatedCanonicalJson(input, validateRenderBundle);

const hash = (canonical: string) =>
  `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonical)))}`;

const validatedHash = (canonical: ValidationResult<string>): ValidationResult<string> =>
  canonical.valid ? { valid: true, value: hash(canonical.value), diagnostics: [] } : canonical;

export const hashPresentationDefinition = (input: unknown) =>
  validatedHash(canonicalizePresentationDefinition(input));
export const hashRenderBundle = (input: unknown) => validatedHash(canonicalizeRenderBundle(input));

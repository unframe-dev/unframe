import type { Diagnostic } from "../domain/model.js";

export type JsonRecord = Record<string, unknown>;
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

export {
  compareStrings,
  containerPath,
  diagnostic,
  finite,
  hasOnlyFields,
  hasOwnFields,
  id,
  isDenseArray,
  isRecord,
  pathSegment,
  positive,
  recordEntries,
  recordKeys,
  schemaPath,
  semanticOverrideFields,
  semanticRoles,
  sorted,
  structuralDiagnostic,
  validateGroupOwner,
  validateQuaternion,
  validateRecordIds,
  validateReferences,
  validateTree,
  validateVector,
};

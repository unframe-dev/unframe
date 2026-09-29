import {
  hashCanonicalJsonPayload,
  materializeCompletedSemanticTree,
  type RenderBundle,
  type SemanticSurface,
  type ValidationResult,
} from "@unframe/unframe-core";
import type { RendererIdentity, RenderSurfacePlan } from "@unframe/unframe-renderer-api";
import { compareStrings, diagnostic } from "../diagnostics/diagnostics.js";

type Bounds = RenderSurfacePlan["logicalBounds"];
type Node = SemanticSurface["contentNodes"][string];
type Atom = { id: string; boundsByState: Record<string, Bounds | null> };
type Operator =
  | {
      ownerNodeId: string;
      stateId: string;
      operator: "frame-clip";
      clipBounds: Bounds;
      borderWidth: number;
      borderRadius: number;
      operandNodeIds: string[];
    }
  | {
      ownerNodeId: string;
      stateId: string;
      operator: "group-opacity";
      opacity: number;
      operandNodeIds: string[];
    };
type Closure = { start: number; end: number; operators: Operator[] };
type PlannedSurface = {
  readonly partitions: readonly PlannedPartition[];
  readonly semanticsByState: RenderBundle["surfaces"][string]["semanticsByState"];
  readonly interactionsByState: RenderBundle["surfaces"][string]["interactionsByState"];
};
export type PlannedPartition = {
  readonly plan: RenderSurfacePlan;
  readonly pixelTarget: readonly [number, number];
  readonly partitionRendererKey: string;
  readonly identityDescriptor: Readonly<Record<string, unknown>>;
};

const intersect = (a: Bounds, b: Bounds): Bounds | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
};
const union = (a: Bounds | null, b: Bounds): Bounds => {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};
const paintFrame = (node: Node) =>
  node.kind === "frame" &&
  (node.backgroundColor.alpha > 0 || (node.border.width > 0 && node.border.color.alpha > 0));
const painted = (node: Node) => node.kind === "text" || paintFrame(node);
const visibleWindow = (surface: SemanticSurface): Bounds => {
  const [width, height] = surface.logicalSize;
  const [physicalWidth, physicalHeight] = surface.physicalSizeMeters;
  const sx =
    surface.fit === "stretch"
      ? physicalWidth / width
      : surface.fit === "contain"
        ? Math.min(physicalWidth / width, physicalHeight / height)
        : Math.max(physicalWidth / width, physicalHeight / height);
  const sy = surface.fit === "stretch" ? physicalHeight / height : sx;
  return intersect(
    { x: 0, y: 0, width, height },
    {
      x: width / 2 - physicalWidth / (2 * sx),
      y: height / 2 - physicalHeight / (2 * sy),
      width: physicalWidth / sx,
      height: physicalHeight / sy,
    },
  )!;
};
const pixelTargetFor = (bounds: Bounds): readonly [number, number] => {
  const scale = 2048 / Math.max(bounds.width, bounds.height);
  return [
    Math.max(1, Math.floor(bounds.width * scale + 0.5)),
    Math.max(1, Math.floor(bounds.height * scale + 0.5)),
  ];
};

export const planSurfacePartitions = (
  surface: SemanticSurface,
  renderer: RendererIdentity,
): ValidationResult<PlannedSurface> => {
  const stateIds = Object.keys(surface.states).sort(compareStrings);
  const atoms: Atom[] = [];
  const frameIds: string[] = [];
  const descendants = new Map<string, string[]>();
  let unsupportedNodeId: string | undefined;
  const visit = (id: string): string[] => {
    const node = surface.contentNodes[id]!;
    if (node.kind !== "frame" && node.kind !== "text") unsupportedNodeId = id;
    const subtree: string[] = [];
    if (node.kind === "frame") frameIds.push(id);
    const canPaint =
      painted(node) ||
      (node.kind === "frame" &&
        stateIds.some((stateId) => {
          const override = surface.states[stateId]?.contentOverrides[id];
          return (
            override?.kind === "frame" &&
            paintFrame({
              ...node,
              backgroundColor: override.backgroundColor ?? node.backgroundColor,
              border: override.border ?? node.border,
            })
          );
        }));
    if (canPaint) {
      atoms.push({ id, boundsByState: {} });
      subtree.push(id);
    }
    if (node.kind === "frame") for (const childId of node.children) subtree.push(...visit(childId));
    descendants.set(id, subtree);
    return subtree;
  };
  visit(surface.rootFrameId);
  if (unsupportedNodeId)
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-partition-content-unsupported",
          ["surface", surface.id, "contentNodes", unsupportedNodeId],
          "The current structured renderer supports Frame and Text content only.",
        ),
      ],
    };
  const fullWindow = visibleWindow(surface);
  const closures: Closure[] = [];
  const semanticsByState: PlannedSurface["semanticsByState"] = {};
  const interactionsByState: PlannedSurface["interactionsByState"] = {};
  for (const stateId of stateIds) {
    const state = surface.states[stateId]!;
    const materialized = materializeCompletedSemanticTree(surface, stateId);
    if (!materialized.valid) return materialized;
    semanticsByState[stateId] = {
      rootNodeIds: [...materialized.value.rootNodeIds],
      nodes: Object.fromEntries(
        Object.entries(materialized.value.nodes).map(([id, node]) => [id, { ...node }]),
      ),
    };
    const regions: NonNullable<PlannedSurface["interactionsByState"][string]> = [];
    interactionsByState[stateId] = regions;
    const walk = (
      id: string,
      origin: readonly [number, number],
      clip: Bounds | null,
      active: boolean,
    ) => {
      const base = surface.contentNodes[id]!;
      const override = state.contentOverrides[id];
      const node = override ? ({ ...base, ...override } as Node) : base;
      if (node.placement.kind !== "absolute")
        throw new Error("Validated Surface has non-absolute placement.");
      const raw: Bounds = {
        x: origin[0] + node.placement.x,
        y: origin[1] + node.placement.y,
        width: node.placement.width,
        height: node.placement.height,
      };
      const visible = active && node.visible && node.opacity > 0;
      const clipped = visible && clip ? intersect(raw, clip) : null;
      const semantic = node.semanticNodeId
        ? materialized.value.nodes[node.semanticNodeId]
        : undefined;
      if (
        clipped &&
        semantic?.role === "button" &&
        semantic.stateEnabled &&
        semantic.interactionId &&
        state.enabledInteractionIds.includes(semantic.interactionId)
      ) {
        const interaction = surface.interactions[semantic.interactionId];
        if (interaction)
          regions.push({
            interactionId: semantic.interactionId,
            semanticNodeId: node.semanticNodeId!,
            bounds: {
              x: clipped.x / surface.logicalSize[0],
              y: clipped.y / surface.logicalSize[1],
              width: clipped.width / surface.logicalSize[0],
              height: clipped.height / surface.logicalSize[1],
            },
            priority: interaction.hitPriority,
            coordinateSpace: "normalized",
          });
      }
      const atom = atoms.find((item) => item.id === id);
      if (atom) atom.boundsByState[stateId] = painted(node) ? clipped : null;
      if (node.kind !== "frame") return;
      const operandIds = descendants.get(id)!;
      if ((node.clip || node.opacity < 1) && operandIds.length > 0) {
        const indices = operandIds.map((operand) => atoms.findIndex((item) => item.id === operand));
        const start = Math.min(...indices);
        const end = Math.max(...indices);
        if (node.clip)
          closures.push({
            start,
            end,
            operators: [
              {
                ownerNodeId: id,
                stateId,
                operator: "frame-clip",
                clipBounds: raw,
                borderWidth: node.border.width,
                borderRadius: node.border.radius,
                operandNodeIds: operandIds,
              },
            ],
          });
        if (node.opacity < 1)
          closures.push({
            start,
            end,
            operators: [
              {
                ownerNodeId: id,
                stateId,
                operator: "group-opacity",
                opacity: node.opacity,
                operandNodeIds: operandIds,
              },
            ],
          });
      }
      const childClip = node.clip ? clipped : clip;
      for (const childId of node.children) walk(childId, [raw.x, raw.y], childClip, visible);
    };
    walk(surface.rootFrameId, [0, 0], fullWindow, true);
    regions.sort(
      (left, right) =>
        right.priority - left.priority ||
        compareStrings(left.interactionId, right.interactionId) ||
        compareStrings(left.semanticNodeId, right.semanticNodeId) ||
        left.bounds.x - right.bounds.x ||
        left.bounds.y - right.bounds.y ||
        left.bounds.width - right.bounds.width ||
        left.bounds.height - right.bounds.height,
    );
  }
  const merged: Closure[] = [];
  for (const closure of closures.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && closure.start <= previous.end) {
      previous.end = Math.max(previous.end, closure.end);
      previous.operators.push(...closure.operators);
    } else merged.push({ ...closure, operators: [...closure.operators] });
  }
  const noClosureKey = hashCanonicalJsonPayload({ kind: "no-closure", version: 1 });
  const keys = atoms.map(() => noClosureKey);
  for (const group of merged) {
    const operators = group.operators.sort(
      (left, right) =>
        compareStrings(left.ownerNodeId, right.ownerNodeId) ||
        compareStrings(left.operator, right.operator) ||
        compareStrings(left.stateId, right.stateId) ||
        compareStrings(left.operandNodeIds.join("\0"), right.operandNodeIds.join("\0")) ||
        compareStrings(hashCanonicalJsonPayload(left), hashCanonicalJsonPayload(right)),
    );
    const key = hashCanonicalJsonPayload(operators);
    for (let index = group.start; index <= group.end; index++) keys[index] = key;
  }
  const plans: PlannedPartition[] = [];
  const partitionRendererKey = hashCanonicalJsonPayload({
    renderer: { ...renderer, entry: { kind: "structured" } },
    executionClass: "baked-web",
  });
  for (let start = 0; start < atoms.length;) {
    let end = start + 1;
    while (end < atoms.length && keys[end] === keys[start]) end++;
    const owned = atoms.slice(start, end);
    let bounds: Bounds | null = null;
    const states: Record<string, { kind: "capture" | "empty" }> = {};
    for (const stateId of stateIds) {
      let stateVisible = false;
      for (const atom of owned) {
        const current = atom.boundsByState[stateId];
        if (current) {
          bounds = union(bounds, current);
          stateVisible = true;
        }
      }
      states[stateId] = { kind: stateVisible ? "capture" : "empty" };
    }
    if (bounds) {
      const layer = plans.length;
      const ownedContentNodeIds = owned.map((atom) => atom.id);
      const descriptor = {
        partitionStrategyVersion: 1,
        semanticSurfaceId: surface.id,
        renderer: { ...renderer, entry: { kind: "structured" } },
        executionClass: "baked-web",
        compositingGroupKey: keys[start],
        ownedContentNodeIds,
        logicalBounds: bounds,
        layer,
      };
      const id = `rs_${hashCanonicalJsonPayload(descriptor).slice(7)}`;
      const context = new Set<string>();
      for (const atom of owned) {
        let parentId = surface.contentNodes[atom.id]!.parentId;
        while (parentId !== null) {
          if (!ownedContentNodeIds.includes(parentId)) context.add(parentId);
          parentId = surface.contentNodes[parentId]!.parentId;
        }
      }
      const contextNodeIds = frameIds.filter((id) => context.has(id));
      plans.push({
        plan: {
          id,
          semanticSurfaceId: surface.id,
          logicalBounds: bounds,
          layer,
          ownedContentNodeIds,
          contextNodeIds,
          clipWindow: bounds,
          states,
        },
        pixelTarget: pixelTargetFor(bounds),
        partitionRendererKey,
        identityDescriptor: descriptor,
      });
    }
    start = end;
  }
  const ownedIds = plans.flatMap(({ plan }) => plan.ownedContentNodeIds);
  if (
    new Set(ownedIds).size !== ownedIds.length ||
    atoms.some(
      (atom) =>
        !ownedIds.includes(atom.id) && stateIds.some((stateId) => atom.boundsByState[stateId]),
    )
  )
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-partition-ownership-invalid",
          ["surface", surface.id],
          "Renderable nodes must be owned exactly once.",
        ),
      ],
    };
  return {
    valid: true,
    value: { partitions: plans, semanticsByState, interactionsByState },
    diagnostics: [],
  };
};

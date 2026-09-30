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

type Node = Extract<SemanticSurface["content"], { kind: "structured" }>["nodes"][string];
type Atom = { boundsByState: Record<string, Bounds | null>; id: string };
type Operator =
  | {
      borderRadius: number;
      borderWidth: number;
      clipBounds: Bounds;
      operandNodeIds: Array<string>;
      operator: "frame-clip";
      ownerNodeId: string;
      stateId: string;
    }
  | {
      opacity: number;
      operandNodeIds: Array<string>;
      operator: "group-opacity";
      ownerNodeId: string;
      stateId: string;
    };
type Closure = { end: number; operators: Array<Operator>; start: number };
type PlannedSurface = {
  readonly interactionsByState: RenderBundle["surfaces"][string]["interactionsByState"];
  readonly partitions: ReadonlyArray<PlannedPartition>;
  readonly semanticsByState: RenderBundle["surfaces"][string]["semanticsByState"];
};
export type PlannedPartition = {
  readonly identityDescriptor: Readonly<Record<string, unknown>>;
  readonly partitionRendererKey: string;
  readonly pixelTarget: readonly [number, number];
  readonly plan: RenderSurfacePlan;
};

const intersect = (a: Bounds, b: Bounds): Bounds | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { height: bottom - y, width: right - x, x, y } : null;
};
const union = (a: Bounds | null, b: Bounds): Bounds => {
  if (!a) {
    return b;
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    x,
    y,
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
    { height, width, x: 0, y: 0 },
    {
      height: physicalHeight / sy,
      width: physicalWidth / sx,
      x: width / 2 - physicalWidth / (2 * sx),
      y: height / 2 - physicalHeight / (2 * sy),
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
  if (surface.content.kind !== "structured") {
    return {
      diagnostics: [
        diagnostic(
          "compiler-partition-content-unsupported",
          ["surface", surface.id],
          "Opaque content cannot be partitioned.",
        ),
      ],
      valid: false,
    };
  }
  const content = surface.content;
  const stateIds = Object.keys(surface.states).sort(compareStrings);
  const atoms: Array<Atom> = [];
  const frameIds: Array<string> = [];
  const descendants = new Map<string, Array<string>>();
  let unsupportedNodeId: string | undefined;
  const visit = (id: string): Array<string> => {
    const node = content.nodes[id]!;
    if (node.kind !== "frame" && node.kind !== "text") {
      unsupportedNodeId = id;
    }
    const subtree: Array<string> = [];
    if (node.kind === "frame") {
      frameIds.push(id);
    }
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
      atoms.push({ boundsByState: {}, id });
      subtree.push(id);
    }
    if (node.kind === "frame") {
      for (const childId of node.children) {
        subtree.push(...visit(childId));
      }
    }
    descendants.set(id, subtree);
    return subtree;
  };
  visit(content.rootFrameId);
  if (unsupportedNodeId) {
    return {
      diagnostics: [
        diagnostic(
          "compiler-partition-content-unsupported",
          ["surface", surface.id, "contentNodes", unsupportedNodeId],
          "The current structured renderer supports Frame and Text content only.",
        ),
      ],
      valid: false,
    };
  }
  const fullWindow = visibleWindow(surface);
  const closures: Array<Closure> = [];
  const semanticsByState: PlannedSurface["semanticsByState"] = {};
  const interactionsByState: PlannedSurface["interactionsByState"] = {};
  for (const stateId of stateIds) {
    const state = surface.states[stateId]!;
    const materialized = materializeCompletedSemanticTree(surface, stateId);
    if (!materialized.valid) {
      return materialized;
    }
    semanticsByState[stateId] = {
      nodes: Object.fromEntries(
        Object.entries(materialized.value.nodes).map(([id, node]) => [id, { ...node }]),
      ),
      rootNodeIds: [...materialized.value.rootNodeIds],
    };
    const regions: NonNullable<PlannedSurface["interactionsByState"][string]> = [];
    interactionsByState[stateId] = regions;
    const walk = (
      id: string,
      origin: readonly [number, number],
      clip: Bounds | null,
      active: boolean,
    ) => {
      const base = content.nodes[id]!;
      const override = state.contentOverrides[id];
      const node = override ? ({ ...base, ...override } as Node) : base;
      if (node.placement.kind !== "absolute") {
        throw new Error("Validated Surface has non-absolute placement.");
      }
      const raw: Bounds = {
        height: node.placement.height,
        width: node.placement.width,
        x: origin[0] + node.placement.x,
        y: origin[1] + node.placement.y,
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
        if (interaction) {
          regions.push({
            bounds: {
              height: clipped.height / surface.logicalSize[1],
              width: clipped.width / surface.logicalSize[0],
              x: clipped.x / surface.logicalSize[0],
              y: clipped.y / surface.logicalSize[1],
            },
            coordinateSpace: "normalized",
            interactionId: semantic.interactionId,
            priority: interaction.hitPriority,
            semanticNodeId: node.semanticNodeId!,
          });
        }
      }
      const atom = atoms.find((item) => item.id === id);
      if (atom) {
        atom.boundsByState[stateId] = painted(node) ? clipped : null;
      }
      if (node.kind !== "frame") {
        return;
      }
      const operandIds = descendants.get(id)!;
      if ((node.clip || node.opacity < 1) && operandIds.length > 0) {
        const indices = operandIds.map((operand) => atoms.findIndex((item) => item.id === operand));
        const start = Math.min(...indices);
        const end = Math.max(...indices);
        if (node.clip) {
          closures.push({
            end,
            operators: [
              {
                borderRadius: node.border.radius,
                borderWidth: node.border.width,
                clipBounds: raw,
                operandNodeIds: operandIds,
                operator: "frame-clip",
                ownerNodeId: id,
                stateId,
              },
            ],
            start,
          });
        }
        if (node.opacity < 1) {
          closures.push({
            end,
            operators: [
              {
                opacity: node.opacity,
                operandNodeIds: operandIds,
                operator: "group-opacity",
                ownerNodeId: id,
                stateId,
              },
            ],
            start,
          });
        }
      }
      const childClip = node.clip ? clipped : clip;
      for (const childId of node.children) {
        walk(childId, [raw.x, raw.y], childClip, visible);
      }
    };
    walk(content.rootFrameId, [0, 0], fullWindow, true);
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
  const merged: Array<Closure> = [];
  for (const closure of closures.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && closure.start <= previous.end) {
      previous.end = Math.max(previous.end, closure.end);
      previous.operators.push(...closure.operators);
    } else {
      merged.push({ ...closure, operators: [...closure.operators] });
    }
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
    for (let index = group.start; index <= group.end; index++) {
      keys[index] = key;
    }
  }
  const plans: Array<PlannedPartition> = [];
  const partitionRendererKey = hashCanonicalJsonPayload({
    executionClass: "baked-web",
    renderer: { ...renderer, entry: { kind: "structured" } },
  });
  for (let start = 0; start < atoms.length;) {
    let end = start + 1;
    while (end < atoms.length && keys[end] === keys[start]) {
      end++;
    }
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
        compositingGroupKey: keys[start],
        executionClass: "baked-web",
        layer,
        logicalBounds: bounds,
        ownedContentNodeIds,
        partitionStrategyVersion: 1,
        renderer: { ...renderer, entry: { kind: "structured" } },
        semanticSurfaceId: surface.id,
      };
      const id = `rs_${hashCanonicalJsonPayload(descriptor).slice(7)}`;
      const context = new Set<string>();
      for (const atom of owned) {
        let parentId = content.nodes[atom.id]!.parentId;
        while (parentId !== null) {
          if (!ownedContentNodeIds.includes(parentId)) {
            context.add(parentId);
          }
          parentId = content.nodes[parentId]!.parentId;
        }
      }
      const contextNodeIds = frameIds.filter((id) => context.has(id));
      plans.push({
        identityDescriptor: descriptor,
        partitionRendererKey,
        pixelTarget: pixelTargetFor(bounds),
        plan: {
          clipWindow: bounds,
          id,
          layer,
          logicalBounds: bounds,
          ownership: { contextNodeIds, kind: "structured", ownedContentNodeIds },
          semanticSurfaceId: surface.id,
          states,
        },
      });
    }
    start = end;
  }
  const ownedIds = plans.flatMap(({ plan }) =>
    plan.ownership.kind === "structured" ? plan.ownership.ownedContentNodeIds : [],
  );
  if (
    new Set(ownedIds).size !== ownedIds.length ||
    atoms.some(
      (atom) =>
        !ownedIds.includes(atom.id) && stateIds.some((stateId) => atom.boundsByState[stateId]),
    )
  ) {
    return {
      diagnostics: [
        diagnostic(
          "compiler-partition-ownership-invalid",
          ["surface", surface.id],
          "Renderable nodes must be owned exactly once.",
        ),
      ],
      valid: false,
    };
  }
  return {
    diagnostics: [],
    valid: true,
    value: { interactionsByState, partitions: plans, semanticsByState },
  };
};

import type { SemanticSurface, SurfaceContentNode } from "../domain/model.js";

export type LogicalRect = Readonly<{ x: number; y: number; width: number; height: number }>;

type Frame = Extract<SurfaceContentNode, { kind: "frame" }>;
type Insets = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};
type Child = { readonly id: string; readonly node: SurfaceContentNode };

function fail(message: string): never {
  throw new TypeError(message);
}
const validRect = (rect: LogicalRect) =>
  Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0;
const axisOffset = (align: "start" | "center" | "end" | "stretch", free: number) =>
  align === "center" ? free / 2 : align === "end" ? free : 0;
const margins = (value: Insets, horizontal: boolean) =>
  horizontal ? value.left + value.right : value.top + value.bottom;

export const resolveStructuredLayout = (
  surface: SemanticSurface,
  stateId: string,
): Readonly<Record<string, LogicalRect>> => {
  if (surface.content.kind !== "structured") fail("Structured content is required.");
  const state = surface.states[stateId];
  if (!state) fail(`Unknown Surface State: ${stateId}`);
  const { nodes, rootFrameId } = surface.content;
  const effective = (id: string): SurfaceContentNode => {
    const node = nodes[id];
    if (!node) fail(`Unknown content node: ${id}`);
    const override = state.contentOverrides[id];
    if (override && override.kind !== node.kind) fail(`Content override kind mismatch: ${id}`);
    return override ? ({ ...node, ...override } as SurfaceContentNode) : node;
  };
  const root = effective(rootFrameId);
  if (root.kind !== "frame" || root.parentId !== null || root.placement.kind !== "absolute")
    fail("Root must be a parentless, absolutely placed Frame.");
  const rootRect: LogicalRect = {
    x: root.placement.x,
    y: root.placement.y,
    width: root.placement.width,
    height: root.placement.height,
  };
  if (!validRect(rootRect)) fail("Invalid root geometry.");
  const result: Record<string, LogicalRect> = {};
  const visit = (frame: Frame, rect: LogicalRect) => {
    if (Object.hasOwn(result, frame.id)) fail(`Content cycle or duplicate: ${frame.id}`);
    result[frame.id] = rect;
    const children: Child[] = frame.children.map((id) => {
      const node = effective(id);
      if (node.parentId !== frame.id) fail(`Invalid content parent: ${id}`);
      return { id, node };
    });
    const place = (child: Child, childRect: LogicalRect) => {
      if (!validRect(childRect) || Object.hasOwn(result, child.id))
        fail(`Invalid content geometry or duplicate: ${child.id}`);
      if (child.node.kind === "frame") visit(child.node, childRect);
      else result[child.id] = childRect;
    };
    if (frame.layout.kind === "absolute") {
      for (const child of children) {
        const placement = child.node.placement;
        if (placement.kind !== "absolute") fail(`Expected absolute placement: ${child.id}`);
        place(child, {
          x: rect.x + placement.x,
          y: rect.y + placement.y,
          width: placement.width,
          height: placement.height,
        });
      }
    } else if (frame.layout.kind === "stack") {
      const layout = frame.layout;
      const horizontal = layout.direction === "horizontal";
      const main = horizontal ? rect.width : rect.height;
      const cross = horizontal ? rect.height : rect.width;
      const paddingMain = margins(layout.padding, horizontal);
      const paddingCross = margins(layout.padding, !horizontal);
      const placements = children.map(({ id, node }) => {
        if (node.placement.kind !== "stack") fail(`Expected Stack placement: ${id}`);
        return node.placement;
      });
      const basis = placements.reduce(
        (sum, p) => sum + (horizontal ? p.width : p.height) + margins(p.margin, horizontal),
        0,
      );
      const free = Math.max(
        0,
        main - paddingMain - basis - layout.gap * Math.max(0, children.length - 1),
      );
      const totalGrow = placements.reduce((sum, p) => sum + p.grow, 0);
      const used =
        basis + layout.gap * Math.max(0, children.length - 1) + (totalGrow > 0 ? free : 0);
      const remaining = Math.max(0, main - paddingMain - used);
      const gap =
        layout.gap +
        (layout.justifyContent === "spaceBetween" && children.length > 1
          ? remaining / (children.length - 1)
          : 0);
      let cursor =
        (horizontal ? rect.x + layout.padding.left : rect.y + layout.padding.top) +
        (layout.justifyContent === "center"
          ? remaining / 2
          : layout.justifyContent === "end"
            ? remaining
            : 0);
      children.forEach((child, index) => {
        const placement = placements[index]!;
        const margin = placement.margin;
        const baseMain = horizontal ? placement.width : placement.height;
        const childMain = baseMain + (totalGrow > 0 ? (free * placement.grow) / totalGrow : 0);
        const align = placement.alignSelf === "auto" ? layout.alignItems : placement.alignSelf;
        const ownCross = horizontal ? placement.height : placement.width;
        const crossFree = cross - paddingCross - margins(margin, !horizontal) - ownCross;
        const childCross = align === "stretch" ? ownCross + Math.max(0, crossFree) : ownCross;
        const crossStart =
          (horizontal
            ? rect.y + layout.padding.top + margin.top
            : rect.x + layout.padding.left + margin.left) +
          axisOffset(align, Math.max(0, crossFree));
        cursor += horizontal ? margin.left : margin.top;
        place(
          child,
          horizontal
            ? { x: cursor, y: crossStart, width: childMain, height: childCross }
            : { x: crossStart, y: cursor, width: childCross, height: childMain },
        );
        cursor += childMain + (horizontal ? margin.right : margin.bottom) + gap;
      });
    } else {
      const layout = frame.layout;
      const tracks = (items: typeof layout.columns, available: number, gap: number) => {
        const fixed = items.reduce((sum, item) => sum + (item.kind === "fixed" ? item.size : 0), 0);
        const fraction = items.reduce(
          (sum, item) => sum + (item.kind === "fraction" ? item.fraction : 0),
          0,
        );
        const rest = Math.max(0, available - fixed - gap * Math.max(0, items.length - 1));
        return items.map((item) =>
          item.kind === "fixed" ? item.size : (rest * item.fraction) / fraction,
        );
      };
      const widths = tracks(
        layout.columns,
        rect.width - margins(layout.padding, true),
        layout.columnGap,
      );
      const heights = tracks(
        layout.rows,
        rect.height - margins(layout.padding, false),
        layout.rowGap,
      );
      for (const child of children) {
        const p = child.node.placement;
        if (p.kind !== "grid") fail(`Expected Grid placement: ${child.id}`);
        if (p.column + p.columnSpan - 1 > widths.length || p.row + p.rowSpan - 1 > heights.length)
          fail(`Grid placement exceeds tracks: ${child.id}`);
        const cellX =
          rect.x +
          layout.padding.left +
          widths.slice(0, p.column - 1).reduce((a, b) => a + b, 0) +
          layout.columnGap * (p.column - 1);
        const cellY =
          rect.y +
          layout.padding.top +
          heights.slice(0, p.row - 1).reduce((a, b) => a + b, 0) +
          layout.rowGap * (p.row - 1);
        const cellWidth =
          widths.slice(p.column - 1, p.column + p.columnSpan - 1).reduce((a, b) => a + b, 0) +
          layout.columnGap * (p.columnSpan - 1);
        const cellHeight =
          heights.slice(p.row - 1, p.row + p.rowSpan - 1).reduce((a, b) => a + b, 0) +
          layout.rowGap * (p.rowSpan - 1);
        const freeX = Math.max(0, cellWidth - p.margin.left - p.margin.right - p.width);
        const freeY = Math.max(0, cellHeight - p.margin.top - p.margin.bottom - p.height);
        place(child, {
          x: cellX + p.margin.left + axisOffset(p.justifySelf, freeX),
          y: cellY + p.margin.top + axisOffset(p.alignSelf, freeY),
          width: p.width + (p.justifySelf === "stretch" ? freeX : 0),
          height: p.height + (p.alignSelf === "stretch" ? freeY : 0),
        });
      }
    }
  };
  visit(root, rootRect);
  if (Object.keys(result).length !== Object.keys(nodes).length)
    fail("Structured content contains disconnected nodes.");
  return result;
};

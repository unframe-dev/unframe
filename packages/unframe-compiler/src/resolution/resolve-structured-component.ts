import type {
  ComponentInstanceDeclaration,
  ComponentManifest,
  ComponentStructure,
  ContentOverrideDeclaration,
  ContentNodeDeclaration,
  FrameStyleDeclaration,
  FrameFlowDeclaration,
  NamedFrameStyleDeclaration,
  NamedTextStyleDeclaration,
  PartOverrideDeclaration,
  PropDeclaration,
  TextStyleDeclaration,
  ThemeDeclaration,
  TokenCategory,
  TokenReference,
  VariantStyleOverride,
} from "@unframe/unframe-authoring";
import type { Diagnostic, PresentationDefinition } from "@unframe/unframe-core";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { resourceId } from "../lowering/support.js";

type Path = readonly (string | number)[];
type CoreContentNodes = Extract<
  PresentationDefinition["scene"]["surfaces"][string]["content"],
  { kind: "structured" }
>["nodes"];
type CoreTextStyle = Extract<CoreContentNodes[string], { kind: "text" }>["style"];
type CoreFrame = Extract<CoreContentNodes[string], { kind: "frame" }>;
type CoreContentOverride =
  PresentationDefinition["scene"]["surfaces"][string]["states"][string]["contentOverrides"][string];
type Scalar = string | number | boolean;

export type ResolvedStructuredComponent = {
  readonly contentNodes: CoreContentNodes;
  readonly rootFrameId: string;
  readonly referencedFontIds: ReadonlySet<string>;
  readonly diagnostics: readonly Diagnostic[];
  readonly physicalSizeMeters?: readonly [number, number];
  readonly logicalSize?: readonly [number, number];
  readonly slotPlaceholders: readonly {
    readonly parentFrameId: string;
    readonly placeholderId: string;
    readonly slotId: string;
    readonly semanticParentId?: string;
    readonly order: number;
  }[];
  readonly resolvedProps: ReadonlyMap<string, Scalar>;
  readonly resolveStateContentOverride: (
    localId: string,
    override: ContentOverrideDeclaration,
    at: Path,
  ) => CoreContentOverride | undefined;
};

const transparent = { red: 0, green: 0, blue: 0, alpha: 0 } as const;
const black = { red: 0, green: 0, blue: 0, alpha: 1 } as const;
const noBorder = { color: transparent, width: 0, radius: 0 } as const;

const isPropReference = (
  value: unknown,
): value is { kind: "prop-ref"; propId: string; expectedType: "string" | "number" | "boolean" } =>
  typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "prop-ref";
const isTokenReference = (value: unknown): value is TokenReference =>
  typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "token-ref";

const mergeStyle = <T extends object>(...styles: readonly (T | undefined)[]): T =>
  Object.assign({}, ...styles.filter((style): style is T => style !== undefined));

export const resolveStructuredComponent = ({
  instance,
  manifest,
  structure,
  theme,
  path,
}: {
  readonly instance: ComponentInstanceDeclaration;
  readonly manifest: ComponentManifest;
  readonly structure: ComponentStructure;
  readonly theme: ThemeDeclaration;
  readonly path: Path;
}): ResolvedStructuredComponent => {
  const diagnostics: Diagnostic[] = [];
  const contentNodes: CoreContentNodes = {};
  const referencedFontIds = new Set<string>();
  const slotPlaceholders: {
    parentFrameId: string;
    placeholderId: string;
    slotId: string;
    semanticParentId?: string;
    order: number;
  }[] = [];
  const props = new Map<string, Scalar>();

  for (const [propId, declaration] of Object.entries(manifest.props)) {
    if (Object.hasOwn(instance.props, propId)) props.set(propId, instance.props[propId]!);
    else if ("default" in declaration) props.set(propId, declaration.default);
  }

  const failure = (code: string, at: Path, message: string) => {
    diagnostics.push(diagnostic(code, at, message));
  };
  const resolveProp = <T extends Scalar>(
    value: T | { kind: "prop-ref"; propId: string; expectedType: string },
    at: Path,
  ): T | undefined => {
    if (!isPropReference(value)) return value as T;
    const declaration = manifest.props[value.propId] as PropDeclaration | undefined;
    const resolved = props.get(value.propId);
    if (!declaration) {
      failure(
        "compiler-prop-reference-not-found",
        at,
        "Prop references must name a declared Component prop.",
      );
      return undefined;
    }
    if (declaration.kind !== value.expectedType || resolved === undefined) {
      failure(
        "compiler-prop-reference-invalid",
        at,
        "Prop references must have a matching type and resolved value.",
      );
      return undefined;
    }
    return resolved as T;
  };
  const resolveToken = (
    reference: TokenReference,
    expected: TokenCategory,
    at: Path,
    stack: readonly string[] = [],
  ): unknown => {
    if (reference.category !== expected) {
      failure(
        "compiler-token-category-mismatch",
        at,
        "Token references must use the property's token category.",
      );
      return undefined;
    }
    if (stack.includes(reference.tokenId)) {
      failure("compiler-token-cycle", at, "Theme token aliases must not form a cycle.");
      return undefined;
    }
    const token = theme.tokens[reference.tokenId];
    if (!token) {
      failure(
        "compiler-token-not-found",
        at,
        "Token references must resolve in the selected Theme.",
      );
      return undefined;
    }
    if (token.category !== expected) {
      failure("compiler-token-category-mismatch", at, "Token aliases must remain in one category.");
      return undefined;
    }
    return isTokenReference(token.value)
      ? resolveToken(token.value, expected, at, [...stack, reference.tokenId])
      : token.value;
  };
  for (const [tokenId, token] of Object.entries(theme.tokens))
    if (isTokenReference(token.value))
      resolveToken(token.value, token.category, [...path, "theme", "tokens", tokenId], [tokenId]);
  const validateNamedStyleTokens = (value: unknown, at: Path): void => {
    if (isTokenReference(value)) {
      resolveToken(value, value.category, at);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => validateNamedStyleTokens(item, [...at, index]));
      return;
    }
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value))
        validateNamedStyleTokens(child, [...at, key]);
  };
  for (const [styleId, style] of Object.entries(theme.namedStyles))
    validateNamedStyleTokens(style.style, [...path, "theme", "namedStyles", styleId]);
  const resolveNumber = (
    value: unknown,
    category: "logicalLength",
    at: Path,
  ): number | undefined => {
    const candidate = isTokenReference(value)
      ? resolveToken(value, category, at)
      : resolveProp<number>(value as number, at);
    return typeof candidate === "number" ? candidate : undefined;
  };
  const resolveBoolean = (value: unknown, at: Path): boolean | undefined => {
    const candidate = resolveProp<boolean>(value as boolean, at);
    return typeof candidate === "boolean" ? candidate : undefined;
  };
  const resolveString = (value: unknown, at: Path): string | undefined => {
    const candidate = resolveProp<string>(value as string, at);
    return typeof candidate === "string" ? candidate : undefined;
  };
  const resolveColor = (value: unknown, at: Path) => {
    const candidate = isTokenReference(value) ? resolveToken(value, "color", at) : value;
    if (!candidate || typeof candidate !== "object") return undefined;
    const color = candidate as Record<string, unknown>;
    const resolved = {
      red: resolveProp<number>(color.red as number, [...at, "red"]),
      green: resolveProp<number>(color.green as number, [...at, "green"]),
      blue: resolveProp<number>(color.blue as number, [...at, "blue"]),
      alpha: resolveProp<number>(color.alpha as number, [...at, "alpha"]),
    };
    return Object.values(resolved).every((item) => typeof item === "number")
      ? (resolved as { red: number; green: number; blue: number; alpha: number })
      : undefined;
  };
  const resolveFont = (value: unknown, at: Path): string | undefined => {
    const candidate = isTokenReference(value) ? resolveToken(value, "fontFace", at) : value;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      (candidate as { kind?: unknown }).kind !== "asset-ref"
    ) {
      failure(
        "compiler-font-reference-invalid",
        at,
        "Font references must resolve to an Asset reference.",
      );
      return undefined;
    }
    const id = (candidate as { assetId: string }).assetId;
    referencedFontIds.add(id);
    return id;
  };

  const variantByTarget = new Map<string, VariantStyleOverride[]>();
  const selectedProperties = new Set<string>();
  for (const [variantId, declaration] of Object.entries(manifest.variants)) {
    const selection = Object.hasOwn(instance.variants, variantId)
      ? instance.variants[variantId]
      : declaration.default;
    if (selection === undefined) continue;
    const overrides = structure.variantStyles[variantId]?.[selection];
    if (!overrides) {
      failure(
        "compiler-variant-style-not-found",
        [...path, "variants", variantId],
        "Selected variants must have a declared style mapping.",
      );
      continue;
    }
    for (const override of overrides) {
      for (const property of Object.keys(override.style)) {
        const key = `${override.targetId}\0${property}`;
        if (selectedProperties.has(key))
          failure(
            "compiler-variant-style-conflict",
            [...path, "variants", variantId],
            "Selected variants must not override the same node property.",
          );
        selectedProperties.add(key);
      }
      const current = variantByTarget.get(override.targetId) ?? [];
      current.push(override);
      variantByTarget.set(override.targetId, current);
    }
  }

  const partByTarget = new Map<string, PartOverrideDeclaration>();
  for (const override of instance.partOverrides) {
    const targetId = structure.partBindings[override.partId];
    if (!Object.hasOwn(manifest.parts, override.partId) || !targetId) {
      failure(
        "compiler-part-binding-not-found",
        [...path, "partOverrides", override.partId],
        "Part overrides must resolve through a declared Part binding.",
      );
      continue;
    }
    if (partByTarget.has(targetId))
      failure(
        "compiler-part-override-duplicate",
        [...path, "partOverrides", override.partId],
        "A bound node may receive only one Part override.",
      );
    partByTarget.set(targetId, override);
  }

  const namedStyle = <T extends "frame" | "text">(node: ContentNodeDeclaration, kind: T) => {
    if (node.kind !== "frame" && node.kind !== "text") return undefined;
    if (!node.namedStyle) return undefined;
    const named = theme.namedStyles[node.namedStyle.styleId];
    if (!named) {
      failure(
        "compiler-named-style-not-found",
        [...path, "structure", node.id, "namedStyle"],
        "Named styles must resolve in the selected Theme.",
      );
      return undefined;
    }
    if (named.kind !== kind) {
      failure(
        "compiler-named-style-kind-mismatch",
        [...path, "structure", node.id, "namedStyle"],
        "Named style kind must match the target primitive.",
      );
      return undefined;
    }
    return named.style;
  };

  const resolveInsets = (
    source: { top: unknown; right: unknown; bottom: unknown; left: unknown },
    at: Path,
  ) => ({
    top: resolveNumber(source.top, "logicalLength", [...at, "top"]) ?? 0,
    right: resolveNumber(source.right, "logicalLength", [...at, "right"]) ?? 0,
    bottom: resolveNumber(source.bottom, "logicalLength", [...at, "bottom"]) ?? 0,
    left: resolveNumber(source.left, "logicalLength", [...at, "left"]) ?? 0,
  });
  const resolveFlow = (
    flow: FrameFlowDeclaration | { kind: "absolute" } | undefined,
    at: Path,
  ): CoreFrame["layout"] => {
    if (!flow || flow.kind === "absolute") return { kind: "absolute" };
    if (flow.kind === "stack")
      return {
        kind: "stack",
        direction: flow.direction,
        gap: resolveNumber(flow.gap, "logicalLength", [...at, "gap"]) ?? 0,
        padding: resolveInsets(flow.padding, [...at, "padding"]),
        alignItems: flow.alignItems,
        justifyContent: flow.justifyContent,
      };
    const grid = flow;
    return {
      kind: "grid",
      columns: grid.columns.map((track, index) =>
        track.kind === "fixed"
          ? {
              kind: "fixed" as const,
              size:
                resolveNumber(track.size, "logicalLength", [...at, "columns", index, "size"]) ?? 1,
            }
          : {
              kind: "fraction" as const,
              fraction:
                resolveNumber(track.fraction, "logicalLength", [
                  ...at,
                  "columns",
                  index,
                  "fraction",
                ]) ?? 1,
            },
      ),
      rows: grid.rows.map((track, index) =>
        track.kind === "fixed"
          ? {
              kind: "fixed" as const,
              size: resolveNumber(track.size, "logicalLength", [...at, "rows", index, "size"]) ?? 1,
            }
          : {
              kind: "fraction" as const,
              fraction:
                resolveNumber(track.fraction, "logicalLength", [
                  ...at,
                  "rows",
                  index,
                  "fraction",
                ]) ?? 1,
            },
      ),
      columnGap: resolveNumber(grid.columnGap, "logicalLength", [...at, "columnGap"]) ?? 0,
      rowGap: resolveNumber(grid.rowGap, "logicalLength", [...at, "rowGap"]) ?? 0,
      padding: resolveInsets(grid.padding, [...at, "padding"]),
    };
  };
  const resolvePlacementSource = (
    source: Exclude<ContentNodeDeclaration, { kind: "slot-placeholder" }>["layout"],
    at: Path,
  ) => {
    if (source.kind === "absolute")
      return {
        kind: "absolute" as const,
        x: resolveNumber(source.x, "logicalLength", [...at, "x"]) ?? 0,
        y: resolveNumber(source.y, "logicalLength", [...at, "y"]) ?? 0,
        width: resolveNumber(source.width, "logicalLength", [...at, "width"]) ?? 1,
        height: resolveNumber(source.height, "logicalLength", [...at, "height"]) ?? 1,
      };
    if (source.kind === "stack")
      return {
        kind: "stack" as const,
        grow: resolveNumber(source.grow, "logicalLength", [...at, "grow"]) ?? 0,
        width: resolveNumber(source.width, "logicalLength", [...at, "width"]) ?? 1,
        height: resolveNumber(source.height, "logicalLength", [...at, "height"]) ?? 1,
        alignSelf: source.alignSelf,
        margin: resolveInsets(source.margin, [...at, "margin"]),
      };
    return {
      kind: "grid" as const,
      column: source.column,
      row: source.row,
      columnSpan: source.columnSpan,
      rowSpan: source.rowSpan,
      width: resolveNumber(source.width, "logicalLength", [...at, "width"]) ?? 1,
      height: resolveNumber(source.height, "logicalLength", [...at, "height"]) ?? 1,
      alignSelf: source.alignSelf,
      justifySelf: source.justifySelf,
      margin: resolveInsets(source.margin, [...at, "margin"]),
    };
  };
  const resolvePlacement = (node: ContentNodeDeclaration) => {
    if (node.kind === "slot-placeholder")
      return { kind: "absolute" as const, x: 0, y: 0, width: 1, height: 1 };
    const part = partByTarget.get(node.id);
    return resolvePlacementSource(part?.placement ?? node.layout, [
      ...path,
      "structure",
      node.id,
      "layout",
    ]);
  };
  const resolveTextStyle = (
    node: Extract<ContentNodeDeclaration, { kind: "text" }>,
  ): CoreTextStyle => {
    const part = partByTarget.get(node.id);
    const variants =
      variantByTarget.get(node.id)?.map((item) => item.style as TextStyleDeclaration) ?? [];
    const style = mergeStyle<TextStyleDeclaration>(
      namedStyle(node, "text") as NamedTextStyleDeclaration | undefined,
      node.style,
      ...variants,
      part?.targetKind === "text" ? part.style : undefined,
    );
    const at = [...path, "structure", node.id, "style"];
    const fontAssetId =
      style.font === undefined ? undefined : resolveFont(style.font, [...at, "font"]);
    const fallbackFontAssetIds = (style.fallbackFonts ?? []).flatMap((font, index) => {
      const id = resolveFont(font, [...at, "fallbackFonts", index]);
      return id === undefined ? [] : [id];
    });
    const fontSize =
      style.fontSize === undefined
        ? undefined
        : resolveNumber(style.fontSize, "logicalLength", [...at, "fontSize"]);
    const lineHeight =
      style.lineHeight === undefined
        ? undefined
        : resolveNumber(style.lineHeight, "logicalLength", [...at, "lineHeight"]);
    if (fontAssetId === undefined || fontSize === undefined || lineHeight === undefined)
      failure(
        "compiler-text-style-incomplete",
        at,
        "Resolved Text style requires a font, font size, and line height.",
      );
    return {
      fontAssetId: fontAssetId ?? "invalid-missing-font",
      fallbackFontAssetIds,
      fontSize: fontSize ?? 1,
      lineHeight: lineHeight ?? 1,
      color:
        style.color === undefined ? black : (resolveColor(style.color, [...at, "color"]) ?? black),
      weight: (style.weight === undefined
        ? "regular"
        : resolveString(style.weight, [...at, "weight"])) as "regular" | "bold",
      align: (style.align === undefined
        ? "start"
        : resolveString(style.align, [...at, "align"])) as "start" | "center" | "end",
      overflow: (style.overflow === undefined
        ? "clip"
        : resolveString(style.overflow, [...at, "overflow"])) as "clip" | "ellipsis",
    };
  };

  const seen = new Set<string>();
  const nodeKinds = new Map<string, ContentNodeDeclaration["kind"]>();
  const lower = (node: ContentNodeDeclaration, parentId: string | null, order: number) => {
    if (seen.has(node.id)) {
      failure(
        "compiler-duplicate-content-id",
        [...path, "structure", node.id],
        "Content node IDs must be unique within a Component structure.",
      );
      return;
    }
    seen.add(node.id);
    nodeKinds.set(node.id, node.kind);
    if (node.kind === "slot-placeholder") {
      if (parentId === null)
        failure(
          "compiler-slot-placeholder-root-invalid",
          [...path, "structure", node.id],
          "A Slot placeholder must be a Frame child.",
        );
      else
        slotPlaceholders.push({
          parentFrameId: parentId,
          placeholderId: node.id,
          slotId: node.slotId,
          order,
          ...(node.semanticParentId === undefined
            ? {}
            : { semanticParentId: node.semanticParentId }),
        });
      const semanticTree =
        structure.root.kind === "surface"
          ? structure.root.baseSemanticTree
          : structure.baseSemanticTree!;
      if (
        node.semanticParentId !== undefined &&
        !Object.hasOwn(semanticTree.nodes, node.semanticParentId)
      )
        failure(
          "compiler-slot-semantic-parent-not-found",
          [...path, "structure", node.id, "semanticParentId"],
          "Slot semanticParentId must name a Semantic Node in the owning Component.",
        );
      return;
    }
    const id = resourceId(instance.id, node.id);
    const part = partByTarget.get(node.id);
    if (part && part.targetKind !== node.kind)
      failure(
        "compiler-part-kind-mismatch",
        [...path, "partOverrides", part.partId],
        "Part override kind must match its bound primitive.",
      );
    const common = {
      id,
      parentId,
      order,
      ...(node.semanticNodeId === undefined
        ? {}
        : { semanticNodeId: resourceId(instance.id, node.semanticNodeId) }),
      visible:
        node.visible === undefined
          ? true
          : (resolveBoolean(node.visible, [...path, "structure", node.id, "visible"]) ?? true),
      opacity:
        node.opacity === undefined
          ? 1
          : (resolveNumber(node.opacity, "logicalLength", [
              ...path,
              "structure",
              node.id,
              "opacity",
            ]) ?? 1),
      placement: resolvePlacement(node),
    };
    if (node.kind === "text") {
      const value =
        part?.targetKind === "text" && part.content !== undefined
          ? part.content
          : resolveString(node.value, [...path, "structure", node.id, "value"]);
      const maxCodePoints = resolveProp<number>(node.maxCodePoints as number, [
        ...path,
        "structure",
        node.id,
        "maxCodePoints",
      ]);
      if (maxCodePoints === undefined || !Number.isSafeInteger(maxCodePoints) || maxCodePoints <= 0)
        failure(
          "compiler-max-code-points-invalid",
          [...path, "structure", node.id, "maxCodePoints"],
          "Text maxCodePoints must resolve to a positive safe integer.",
        );
      contentNodes[id] = {
        ...common,
        kind: "text",
        value: { kind: "literal", value: value ?? "" },
        maxCodePoints: maxCodePoints ?? 1,
        style: resolveTextStyle(node),
      };
      return;
    }
    if (node.kind === "image") {
      const at = [...path, "structure", node.id];
      contentNodes[id] = {
        ...common,
        kind: "image",
        assetId: node.asset.assetId,
        style: {
          fit: node.style.fit,
          tint: resolveColor(node.style.tint, [...at, "style", "tint"]) ?? transparent,
          border: {
            color:
              resolveColor(node.style.border.color, [...at, "style", "border", "color"]) ??
              transparent,
            width:
              resolveNumber(node.style.border.width, "logicalLength", [
                ...at,
                "style",
                "border",
                "width",
              ]) ?? 0,
            radius:
              resolveNumber(node.style.border.radius, "logicalLength", [
                ...at,
                "style",
                "border",
                "radius",
              ]) ?? 0,
          },
        },
      };
      return;
    }
    if (node.kind === "shape") {
      const at = [...path, "structure", node.id];
      const geometry =
        node.geometry.kind === "rectangle"
          ? {
              kind: "rectangle" as const,
              width:
                resolveNumber(node.geometry.width, "logicalLength", [...at, "geometry", "width"]) ??
                1,
              height:
                resolveNumber(node.geometry.height, "logicalLength", [
                  ...at,
                  "geometry",
                  "height",
                ]) ?? 1,
              radius:
                resolveNumber(node.geometry.radius, "logicalLength", [
                  ...at,
                  "geometry",
                  "radius",
                ]) ?? 0,
            }
          : node.geometry.kind === "ellipse"
            ? {
                kind: "ellipse" as const,
                width:
                  resolveNumber(node.geometry.width, "logicalLength", [
                    ...at,
                    "geometry",
                    "width",
                  ]) ?? 1,
                height:
                  resolveNumber(node.geometry.height, "logicalLength", [
                    ...at,
                    "geometry",
                    "height",
                  ]) ?? 1,
              }
            : {
                kind: "line" as const,
                endX:
                  resolveNumber(node.geometry.endX, "logicalLength", [...at, "geometry", "endX"]) ??
                  0,
                endY:
                  resolveNumber(node.geometry.endY, "logicalLength", [...at, "geometry", "endY"]) ??
                  0,
              };
      contentNodes[id] = {
        ...common,
        kind: "shape",
        geometry,
        style: {
          fill: resolveColor(node.style.fill, [...at, "style", "fill"]) ?? transparent,
          stroke: resolveColor(node.style.stroke, [...at, "style", "stroke"]) ?? transparent,
          strokeWidth:
            resolveNumber(node.style.strokeWidth, "logicalLength", [
              ...at,
              "style",
              "strokeWidth",
            ]) ?? 0,
        },
      };
      return;
    }
    const childIds = node.children
      .filter((child) => child.kind !== "slot-placeholder")
      .map((child) => resourceId(instance.id, child.id));
    const variants =
      variantByTarget.get(node.id)?.map((item) => item.style as FrameStyleDeclaration) ?? [];
    const style = mergeStyle<FrameStyleDeclaration>(
      namedStyle(node, "frame") as NamedFrameStyleDeclaration | undefined,
      node.style,
      ...variants,
      part?.targetKind === "frame" ? part.style : undefined,
    );
    const at = [...path, "structure", node.id, "style"];
    const frame: CoreFrame = {
      ...common,
      kind: "frame",
      layout: resolveFlow(node.flow, [...path, "structure", node.id, "flow"]),
      children: childIds,
      backgroundColor:
        style.backgroundColor === undefined
          ? transparent
          : (resolveColor(style.backgroundColor, [...at, "backgroundColor"]) ?? transparent),
      border:
        style.border === undefined
          ? noBorder
          : {
              color: resolveColor(style.border.color, [...at, "border", "color"]) ?? transparent,
              width:
                resolveNumber(style.border.width, "logicalLength", [...at, "border", "width"]) ?? 0,
              radius:
                resolveNumber(style.border.radius, "logicalLength", [...at, "border", "radius"]) ??
                0,
            },
      clip:
        style.clip === undefined ? false : (resolveBoolean(style.clip, [...at, "clip"]) ?? false),
    };
    contentNodes[id] = frame;
    node.children.forEach((child, childOrder) => lower(child, id, childOrder));
  };

  const root = structure.root.kind === "surface" ? structure.root.root : structure.root;
  lower(root, null, 0);
  const boundPartTargets = new Set<string>();
  for (const [partId, targetId] of Object.entries(structure.partBindings)) {
    const targetKind = nodeKinds.get(targetId);
    if (!Object.hasOwn(manifest.parts, partId) || (targetKind !== "frame" && targetKind !== "text"))
      failure(
        "compiler-part-binding-invalid",
        [...path, "structure", "partBindings", partId],
        "Part bindings must map declared Parts to existing primitives.",
      );
    if (boundPartTargets.has(targetId))
      failure(
        "compiler-part-binding-duplicate",
        [...path, "structure", "partBindings", partId],
        "A primitive may be bound to only one Part.",
      );
    boundPartTargets.add(targetId);
  }
  for (const [variantId, options] of Object.entries(structure.variantStyles))
    for (const [optionId, overrides] of Object.entries(options))
      for (const override of overrides) {
        const targetKind = nodeKinds.get(override.targetId);
        if (targetKind === undefined || targetKind === "slot-placeholder")
          failure(
            "compiler-variant-target-not-found",
            [...path, "structure", "variantStyles", variantId, optionId, override.targetId],
            "Variant style targets must name an existing primitive.",
          );
        else if (targetKind !== override.targetKind)
          failure(
            "compiler-variant-kind-mismatch",
            [...path, "structure", "variantStyles", variantId, optionId, override.targetId],
            "Variant target kind must match its primitive.",
          );
      }

  const resolvePositiveTuple = (value: readonly [unknown, unknown], at: Path): [number, number] => {
    const resolved = value.map((item, index) =>
      resolveProp<number>(item as number, [...at, index]),
    ) as [number | undefined, number | undefined];
    if (resolved.some((item) => item === undefined || !Number.isFinite(item) || item <= 0))
      failure(
        "compiler-surface-size-invalid",
        at,
        "Surface dimensions must resolve to positive finite numbers.",
      );
    return [resolved[0] ?? 1, resolved[1] ?? 1];
  };
  const resolveStateContentOverride = (
    localId: string,
    override: ContentOverrideDeclaration,
    at: Path,
  ): CoreContentOverride | undefined => {
    const target = contentNodes[resourceId(instance.id, localId)];
    if (!target || target.kind !== override.kind) {
      failure(
        "compiler-content-override-target-invalid",
        at,
        "Content override target must resolve to a matching content node.",
      );
      return undefined;
    }
    const common = {
      ...(override.visible === undefined
        ? {}
        : { visible: resolveBoolean(override.visible, [...at, "visible"]) ?? target.visible }),
      ...(override.opacity === undefined
        ? {}
        : {
            opacity:
              resolveNumber(override.opacity, "logicalLength", [...at, "opacity"]) ??
              target.opacity,
          }),
      ...(override.placement === undefined
        ? {}
        : { placement: resolvePlacementSource(override.placement, [...at, "placement"]) }),
    };
    if (override.kind === "frame" && target.kind === "frame")
      return {
        kind: "frame",
        ...common,
        ...(override.flow === undefined
          ? {}
          : { layout: resolveFlow(override.flow, [...at, "flow"]) }),
        ...(override.backgroundColor === undefined
          ? {}
          : {
              backgroundColor:
                resolveColor(override.backgroundColor, [...at, "backgroundColor"]) ??
                target.backgroundColor,
            }),
        ...(override.border === undefined
          ? {}
          : {
              border: {
                color:
                  resolveColor(override.border.color, [...at, "border", "color"]) ??
                  target.border.color,
                width:
                  resolveNumber(override.border.width, "logicalLength", [
                    ...at,
                    "border",
                    "width",
                  ]) ?? target.border.width,
                radius:
                  resolveNumber(override.border.radius, "logicalLength", [
                    ...at,
                    "border",
                    "radius",
                  ]) ?? target.border.radius,
              },
            }),
        ...(override.clip === undefined
          ? {}
          : { clip: resolveBoolean(override.clip, [...at, "clip"]) ?? target.clip }),
      };
    if (override.kind === "image" && target.kind === "image")
      return {
        kind: "image",
        ...common,
        ...(override.asset === undefined ? {} : { assetId: override.asset.assetId }),
        ...(override.style === undefined
          ? {}
          : {
              style: {
                fit: override.style.fit,
                tint:
                  resolveColor(override.style.tint, [...at, "style", "tint"]) ?? target.style.tint,
                border: {
                  color:
                    resolveColor(override.style.border.color, [
                      ...at,
                      "style",
                      "border",
                      "color",
                    ]) ?? target.style.border.color,
                  width:
                    resolveNumber(override.style.border.width, "logicalLength", [
                      ...at,
                      "style",
                      "border",
                      "width",
                    ]) ?? target.style.border.width,
                  radius:
                    resolveNumber(override.style.border.radius, "logicalLength", [
                      ...at,
                      "style",
                      "border",
                      "radius",
                    ]) ?? target.style.border.radius,
                },
              },
            }),
      };
    if (override.kind === "shape" && target.kind === "shape") {
      const source = override.geometry;
      const geometry =
        source === undefined
          ? undefined
          : source.kind === "rectangle"
            ? {
                kind: "rectangle" as const,
                width:
                  resolveNumber(source.width, "logicalLength", [...at, "geometry", "width"]) ?? 1,
                height:
                  resolveNumber(source.height, "logicalLength", [...at, "geometry", "height"]) ?? 1,
                radius:
                  resolveNumber(source.radius, "logicalLength", [...at, "geometry", "radius"]) ?? 0,
              }
            : source.kind === "ellipse"
              ? {
                  kind: "ellipse" as const,
                  width:
                    resolveNumber(source.width, "logicalLength", [...at, "geometry", "width"]) ?? 1,
                  height:
                    resolveNumber(source.height, "logicalLength", [...at, "geometry", "height"]) ??
                    1,
                }
              : {
                  kind: "line" as const,
                  endX:
                    resolveNumber(source.endX, "logicalLength", [...at, "geometry", "endX"]) ?? 0,
                  endY:
                    resolveNumber(source.endY, "logicalLength", [...at, "geometry", "endY"]) ?? 0,
                };
      return {
        kind: "shape",
        ...common,
        ...(geometry === undefined ? {} : { geometry }),
        ...(override.style === undefined
          ? {}
          : {
              style: {
                fill:
                  resolveColor(override.style.fill, [...at, "style", "fill"]) ?? target.style.fill,
                stroke:
                  resolveColor(override.style.stroke, [...at, "style", "stroke"]) ??
                  target.style.stroke,
                strokeWidth:
                  resolveNumber(override.style.strokeWidth, "logicalLength", [
                    ...at,
                    "style",
                    "strokeWidth",
                  ]) ?? target.style.strokeWidth,
              },
            }),
      };
    }
    if (override.kind !== "text" || target.kind !== "text") return undefined;
    const style = override.style;
    const baseStyle = target.style;
    const resolvedStyle: CoreTextStyle | undefined =
      style === undefined
        ? undefined
        : {
            ...baseStyle,
            ...(style.font === undefined
              ? {}
              : {
                  fontAssetId:
                    resolveFont(style.font, [...at, "style", "font"]) ?? baseStyle.fontAssetId,
                }),
            ...(style.fallbackFonts === undefined
              ? {}
              : {
                  fallbackFontAssetIds: style.fallbackFonts.map(
                    (font, index) =>
                      resolveFont(font, [...at, "style", "fallbackFonts", index]) ??
                      "invalid-missing-font",
                  ),
                }),
            ...(style.fontSize === undefined
              ? {}
              : {
                  fontSize:
                    resolveNumber(style.fontSize, "logicalLength", [...at, "style", "fontSize"]) ??
                    baseStyle.fontSize,
                }),
            ...(style.lineHeight === undefined
              ? {}
              : {
                  lineHeight:
                    resolveNumber(style.lineHeight, "logicalLength", [
                      ...at,
                      "style",
                      "lineHeight",
                    ]) ?? baseStyle.lineHeight,
                }),
            ...(style.color === undefined
              ? {}
              : { color: resolveColor(style.color, [...at, "style", "color"]) ?? baseStyle.color }),
            ...(style.weight === undefined
              ? {}
              : {
                  weight: (resolveString(style.weight, [...at, "style", "weight"]) ??
                    baseStyle.weight) as CoreTextStyle["weight"],
                }),
            ...(style.align === undefined
              ? {}
              : {
                  align: (resolveString(style.align, [...at, "style", "align"]) ??
                    baseStyle.align) as CoreTextStyle["align"],
                }),
            ...(style.overflow === undefined
              ? {}
              : {
                  overflow: (resolveString(style.overflow, [...at, "style", "overflow"]) ??
                    baseStyle.overflow) as CoreTextStyle["overflow"],
                }),
          };
    return {
      kind: "text",
      ...common,
      ...(override.value === undefined
        ? {}
        : {
            value: {
              kind: "literal" as const,
              value: resolveString(override.value, [...at, "value"]) ?? "",
            },
          }),
      ...(resolvedStyle === undefined ? {} : { style: resolvedStyle }),
    };
  };
  return {
    contentNodes,
    rootFrameId: resourceId(instance.id, root.id),
    referencedFontIds,
    diagnostics,
    slotPlaceholders,
    resolvedProps: props,
    resolveStateContentOverride,
    ...(structure.root.kind === "surface"
      ? {
          physicalSizeMeters: resolvePositiveTuple(structure.root.physicalSizeMeters, [
            ...path,
            "structure",
            "root",
            "physicalSizeMeters",
          ]),
          logicalSize: resolvePositiveTuple(structure.root.logicalSize, [
            ...path,
            "structure",
            "root",
            "logicalSize",
          ]),
        }
      : {}),
  };
};

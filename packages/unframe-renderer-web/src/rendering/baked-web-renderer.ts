import {
  evaluateFirstMilestoneSupport,
  prepareRendererBuildInput,
  type CompilerResolvedSurfaceInput,
  type Diagnostic,
  type RawSurfaceCapture,
  type RendererBuildFailure,
  type RendererBuildResult,
  type RendererCapabilities,
  type RendererPlugin,
  type RendererSupportRequest,
} from "@unframe/unframe-renderer-api";

import { snapshotDenseArray, snapshotStrictRecord } from "../validation/safe-data.js";
import { decodeFontAsset, fontFamilyForChecksum, type FontCoverage } from "./font-assets.js";
import {
  adapterCaptureSchema,
  browserCaptureSchemaFor,
  createBakedWebRendererOptionsSchema,
} from "../validation/schemas.js";
import type {
  BrowserCaptureRequest,
  BrowserRgbaCapture,
  CreateBakedWebRendererOptions,
  FixedBrowserAdapter,
} from "../public-types.js";
import {
  configHashFromSnapshot,
  hash,
  copyRgba,
  normalizedEnvironment,
  snapshotAdapterIdentity,
  snapshotConfig,
  snapshotEnvironment,
} from "../config/config-environment.js";

const RENDERER_VERSION = "2";
const CONTRACT_VERSION = "2";
const applyFunction = Reflect.apply;
const capabilities = Object.freeze({
  deterministic: true as const,
  fallbackPolicies: Object.freeze(["reject"] as const),
  inputKinds: Object.freeze(["structured"] as const),
  interactions: Object.freeze(["none", "regions"] as const),
  internalAnimations: Object.freeze(["none"] as const),
  rendererPreferences: Object.freeze(["baked-web"] as const),
  updateModels: Object.freeze(["static", "finite-state"] as const),
}) satisfies RendererCapabilities;

const diagnostic = (
  code: string,
  message: string,
  path: ReadonlyArray<string | number> = [],
): Diagnostic => ({
  code,
  message,
  path,
});

const failure = (
  code: string,
  message: string,
  path: ReadonlyArray<string | number> = [],
): RendererBuildFailure => ({
  diagnostics: [diagnostic(code, message, path)],
  ok: false,
});

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const escapeHtml = (value: string) => {
  let escaped = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    escaped +=
      character === "&"
        ? "&amp;"
        : character === "<"
          ? "&lt;"
          : character === ">"
            ? "&gt;"
            : character === '"'
              ? "&quot;"
              : character === "'"
                ? "&#39;"
                : character;
  }
  return escaped;
};

const finite = (value: number) => Number.isFinite(value);
const cssNumber = (value: number) => {
  const normalized = Object.is(value, -0) ? 0 : value;
  return String(normalized);
};

const rgbaCss = (color: {
  readonly alpha: number;
  readonly blue: number;
  readonly green: number;
  readonly red: number;
}) =>
  `rgba(${cssNumber(color.red * 255)},${cssNumber(color.green * 255)},${cssNumber(color.blue * 255)},${cssNumber(color.alpha)})`;

const documentFor = (
  input: CompilerResolvedSurfaceInput,
  stateId: string,
):
  | {
      readonly document: string;
      readonly fontFaceCount: number;
    }
  | RendererBuildFailure => {
  if (input.surface.content.kind !== "structured" || input.plan.ownership.kind !== "structured") {
    return failure(
      "unsupported-structured-tree",
      "Baked Web requires structured Surface content.",
      ["surface", "content"],
    );
  }
  const content = input.surface.content;
  const ownership = input.plan.ownership;
  const state = input.surface.states[stateId];
  if (!state) {
    return failure("missing-render-state", "Planned state is absent.", ["plan", "states", stateId]);
  }
  const effectiveNode = (id: string) => {
    const node = content.nodes[id];
    const override = state.contentOverrides[id];
    if (!node || !override) {
      return node;
    }
    if (override.kind !== node.kind) {
      return undefined;
    }
    return { ...node, ...override } as typeof node;
  };
  const root = effectiveNode(content.rootFrameId);
  if (
    !root ||
    root.kind !== "frame" ||
    root.parentId !== null ||
    root.layout.kind !== "absolute" ||
    root.placement.kind !== "absolute"
  ) {
    return failure(
      "unsupported-structured-tree",
      "Structured rendering requires an absolute root Frame.",
      ["surface", "content", "rootFrameId"],
    );
  }
  if (
    !ownership.contextNodeIds.includes(root.id) &&
    !ownership.ownedContentNodeIds.includes(root.id)
  ) {
    return failure("unsupported-structured-tree", "Render plan must include the root Frame.", [
      "plan",
      "ownership",
      "ownedContentNodeIds",
    ]);
  }
  const planned = new Set([...ownership.ownedContentNodeIds, ...ownership.contextNodeIds]);
  const owned = new Set(ownership.ownedContentNodeIds);
  if (planned.size !== ownership.ownedContentNodeIds.length + ownership.contextNodeIds.length) {
    return failure("unsupported-structured-tree", "Render plan node IDs must be unique.", [
      "plan",
      "ownership",
      "ownedContentNodeIds",
    ]);
  }
  if (new Set(root.children).size !== root.children.length) {
    return failure("unsupported-structured-tree", "Root Frame children must be unique.", [
      "surface",
      "content",
      "nodes",
      root.id,
      "children",
    ]);
  }

  const bounds = input.plan.logicalBounds;
  const xScale = input.context.pixelTarget[0] / bounds.width;
  const yScale = input.context.pixelTarget[1] / bounds.height;
  if (!finite(xScale) || !finite(yScale)) {
    return failure("invalid-render-scale", "Render scale must remain finite.", [
      "plan",
      "logicalBounds",
    ]);
  }
  const rootPlacement = root.placement;
  const referencedFontIds = new Set<string>();
  const textFontRequirements: Array<{
    readonly fontIds: readonly string[];
    readonly nodeId: string;
    readonly value: string;
  }> = [];
  const renderedNodeIds = new Set([root.id]);
  const renderNode = (
    id: string,
    parentId: string,
    parentOrigin: readonly [number, number],
  ): string | RendererBuildFailure => {
    const node = effectiveNode(id);
    if (!planned.has(id) || !node || node.parentId !== parentId || renderedNodeIds.has(id)) {
      return failure(
        "unsupported-structured-tree",
        "Render plan must contain one connected Frame/Text tree.",
        ["surface", "content", "nodes", id],
      );
    }
    renderedNodeIds.add(id);
    if (node.placement.kind !== "absolute") {
      return failure(
        "unsupported-structured-tree",
        "Structured rendering accepts absolute placement only.",
        ["surface", "content", "nodes", id, "placement"],
      );
    }
    const placement = node.placement;
    const global = {
      height: placement.height,
      width: placement.width,
      x: parentOrigin[0] + placement.x,
      y: parentOrigin[1] + placement.y,
    };
    const [left, top, width, height] = [
      placement.x * xScale,
      placement.y * yScale,
      placement.width * xScale,
      placement.height * yScale,
    ];
    if (![left, top, width, height].every(finite)) {
      return failure("invalid-render-geometry", "Scaled render geometry must remain finite.", [
        "surface",
        "content",
        "nodes",
        id,
        "placement",
      ]);
    }
    if (node.kind === "frame") {
      if (node.layout.kind !== "absolute" || new Set(node.children).size !== node.children.length) {
        return failure(
          "unsupported-structured-tree",
          "Structured rendering accepts absolute Frame children only.",
          ["surface", "content", "nodes", id],
        );
      }
      const children: Array<string> = [];
      for (const childId of node.children) {
        if (!planned.has(childId)) {
          continue;
        }
        const child = renderNode(childId, id, [global.x, global.y]);
        if (typeof child !== "string") {
          return child;
        }
        children.push(child);
      }
      const borderWidth = node.border.width * yScale;
      const paint = owned.has(id);
      return `<div class="frame" data-node-id="${escapeHtml(node.id)}" style="left:${cssNumber(left)}px;top:${cssNumber(top)}px;width:${cssNumber(width)}px;height:${cssNumber(height)}px;display:${node.visible ? "block" : "none"};opacity:${cssNumber(node.opacity)};background:${paint ? rgbaCss(node.backgroundColor) : "rgba(0,0,0,0)"};border:${cssNumber(borderWidth)}px solid ${paint ? rgbaCss(node.border.color) : "rgba(0,0,0,0)"};border-radius:${cssNumber(node.border.radius * yScale)}px;overflow:${node.clip ? "hidden" : "visible"}"><div class="frame-children" style="left:${cssNumber(-borderWidth)}px;top:${cssNumber(-borderWidth)}px;width:${cssNumber(width)}px;height:${cssNumber(height)}px">${children.join("")}</div></div>`;
    }
    if (node.kind !== "text" || node.value.kind !== "literal") {
      return failure(
        "unsupported-structured-tree",
        "Structured rendering accepts literal Text children only.",
        ["surface", "content", "nodes", id],
      );
    }
    if (Array.from(node.value.value).length > node.maxCodePoints) {
      return failure("text-max-code-points-exceeded", "Literal Text exceeds maxCodePoints.", [
        "surface",
        "content",
        "nodes",
        id,
        "value",
      ]);
    }
    const fontIds = [node.style.fontAssetId, ...node.style.fallbackFontAssetIds];
    for (const fontId of fontIds) {
      referencedFontIds.add(fontId);
    }
    textFontRequirements.push({ fontIds, nodeId: id, value: node.value.value });
    const families = fontIds
      .map((fontId) => {
        const checksum = input.fontAssets[fontId]?.checksum;
        return checksum ? fontFamilyForChecksum(checksum) : "missing-font-asset";
      })
      .join(",");
    const overflow =
      node.style.overflow === "ellipsis"
        ? "overflow:hidden;white-space:nowrap;text-overflow:ellipsis"
        : "overflow:hidden;white-space:pre-wrap";
    return `<div class="text" data-node-id="${escapeHtml(node.id)}" style="left:${cssNumber(left)}px;top:${cssNumber(top)}px;width:${cssNumber(width)}px;height:${cssNumber(height)}px;display:${node.visible ? "block" : "none"};opacity:${cssNumber(node.opacity)};font-family:${families};font-size:${cssNumber(node.style.fontSize * yScale)}px;line-height:${cssNumber(node.style.lineHeight * yScale)}px;color:${rgbaCss(node.style.color)};font-weight:${node.style.weight === "bold" ? "700" : "400"};text-align:${node.style.align};${overflow}">${escapeHtml(node.value.value)}</div>`;
  };
  const renderedChildren: Array<string> = [];
  const rootRect = {
    height: rootPlacement.height,
    width: rootPlacement.width,
    x: rootPlacement.x,
    y: rootPlacement.y,
  };
  for (const childId of root.children) {
    if (!planned.has(childId)) {
      continue;
    }
    const child = renderNode(childId, root.id, [rootRect.x, rootRect.y]);
    if (typeof child !== "string") {
      return child;
    }
    renderedChildren.push(child);
  }
  if (
    renderedNodeIds.size !== planned.size ||
    [...planned].some((id) => !renderedNodeIds.has(id))
  ) {
    return failure(
      "unsupported-structured-tree",
      "Render plan must contain one connected Frame/Text tree.",
      ["plan", "ownership", "ownedContentNodeIds"],
    );
  }
  const fontFaces: Array<string> = [];
  const coverageByAssetId = new Map<string, FontCoverage>();
  for (const assetId of referencedFontIds) {
    if (!input.fontAssets[assetId]) {
      return failure("missing-font-asset", "Text references a missing Font Asset.", [
        "fontAssets",
        assetId,
      ]);
    }
  }
  for (const assetId of Object.keys(input.fontAssets).sort(compare)) {
    const asset = input.fontAssets[assetId];
    if (!asset) {
      continue;
    }
    const decoded = decodeFontAsset(assetId, asset);
    if ("ok" in decoded) {
      return decoded;
    }
    fontFaces.push(decoded.face);
    coverageByAssetId.set(assetId, decoded.supports);
  }
  for (const requirement of textFontRequirements) {
    for (const character of requirement.value) {
      const codePoint = character.codePointAt(0);
      if (
        codePoint !== undefined &&
        codePoint !== 0x0a &&
        codePoint !== 0x0d &&
        codePoint !== 0x09 &&
        !requirement.fontIds.some((assetId) => coverageByAssetId.get(assetId)?.(codePoint))
      ) {
        return failure(
          "font-glyph-missing",
          "No declared Font Asset contains a glyph required by literal Text.",
          ["surface", "content", "nodes", requirement.nodeId, "value"],
        );
      }
    }
  }
  const rootLeft = (rootPlacement.x - bounds.x) * xScale;
  const rootTop = (rootPlacement.y - bounds.y) * yScale;
  const rootWidth = rootPlacement.width * xScale;
  const rootHeight = rootPlacement.height * yScale;
  const rootBorderWidth = root.border.width * yScale;
  const rootPaint = owned.has(root.id);
  const style = `${fontFaces.join("")}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:rgba(0,0,0,0);color-scheme:${input.context.colorScheme}}#viewport{position:relative;width:${input.context.pixelTarget[0]}px;height:${input.context.pixelTarget[1]}px}#surface{position:absolute;box-sizing:border-box;left:${cssNumber(rootLeft)}px;top:${cssNumber(rootTop)}px;width:${cssNumber(rootWidth)}px;height:${cssNumber(rootHeight)}px;display:${root.visible ? "block" : "none"};opacity:${cssNumber(root.opacity)};background:${rootPaint ? rgbaCss(root.backgroundColor) : "rgba(0,0,0,0)"};border:${cssNumber(rootBorderWidth)}px solid ${rootPaint ? rgbaCss(root.border.color) : "rgba(0,0,0,0)"};border-radius:${cssNumber(root.border.radius * yScale)}px;overflow:${root.clip ? "hidden" : "visible"}}.frame,.frame-children,.text{position:absolute;box-sizing:border-box}`;
  return Object.freeze({
    document: `<!doctype html><html lang="${escapeHtml(input.context.locale)}"><head><meta charset="utf-8"><style>${style}</style></head><body><main id="viewport"><div id="surface"><div class="frame-children" style="left:${cssNumber(-rootBorderWidth)}px;top:${cssNumber(-rootBorderWidth)}px;width:${cssNumber(rootWidth)}px;height:${cssNumber(rootHeight)}px">${renderedChildren.join("")}</div></div></main></body></html>`,
    fontFaceCount: fontFaces.length,
  });
};

const snapshotCapture = (
  value: unknown,
  pixelTarget: readonly [number, number],
): BrowserRgbaCapture | undefined => {
  const record = snapshotStrictRecord(value, ["alphaMode", "colorSpace", "pixelSize", "rgba"]);
  const pixelSize = record && snapshotDenseArray(record.pixelSize, 2);
  const rgba = record && copyRgba(record.rgba);
  if (!record || !pixelSize || !rgba) {
    return undefined;
  }
  const parsed = browserCaptureSchemaFor(pixelTarget).safeParse({ ...record, pixelSize, rgba });
  if (!parsed.success) {
    return undefined;
  }
  const [width, height] = parsed.data.pixelSize;
  return {
    alphaMode: parsed.data.alphaMode,
    colorSpace: "srgb",
    pixelSize: [width, height],
    rgba,
  };
};

export const createBakedWebRenderer = (options: CreateBakedWebRendererOptions): RendererPlugin => {
  const optionsRecord = snapshotStrictRecord(options, ["adapter", "config"]);
  const parsedOptions = createBakedWebRendererOptionsSchema.safeParse(optionsRecord);
  const adapter = parsedOptions.success ? parsedOptions.data.adapter : undefined;
  const config = parsedOptions.success ? parsedOptions.data.config : undefined;
  const initialAdapter = snapshotStrictRecord(adapter, ["capture", "environment", "identity"]);
  const parsedCapture = adapterCaptureSchema.safeParse(initialAdapter?.capture);
  const fixedCapture = parsedCapture.success
    ? (initialAdapter?.capture as FixedBrowserAdapter["capture"])
    : undefined;
  const environment = snapshotEnvironment(initialAdapter?.environment);
  const adapterIdentity = snapshotAdapterIdentity(initialAdapter?.identity);
  const resolvedConfig = snapshotConfig(config);
  const configHash = resolvedConfig ? configHashFromSnapshot(resolvedConfig) : undefined;
  const adapterReceiver =
    environment && adapterIdentity && fixedCapture
      ? Object.freeze({ capture: fixedCapture, environment, identity: adapterIdentity })
      : undefined;
  const implementationHash =
    environment && adapterIdentity
      ? hash({
          adapter: adapterIdentity,
          environment: normalizedEnvironment(environment),
          renderer: "unframe-baked-web",
          version: RENDERER_VERSION,
        })
      : "sha256:invalid-browser-environment";
  const identity = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    id: "baked-web",
    implementationHash,
    version: RENDERER_VERSION,
  });
  const validatorPlugin: RendererPlugin = {
    build: () => failure("renderer-not-invoked", "Validation must not invoke build."),
    capabilities,
    identity,
    support: (request: RendererSupportRequest) => evaluateFirstMilestoneSupport(request),
  };
  const build = async (rawInput: CompilerResolvedSurfaceInput): Promise<RendererBuildResult> => {
    try {
      const prepared = prepareRendererBuildInput(rawInput, validatorPlugin);
      if (!prepared.valid) {
        return { diagnostics: [...prepared.diagnostics], ok: false };
      }
      const input = prepared.value;
      const support = evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: input.resolvedIntent,
      });
      if (!support.supported) {
        return { diagnostics: support.diagnostics, ok: false };
      }
      if (!environment || !adapterIdentity || !fixedCapture || !adapterReceiver) {
        return failure(
          "invalid-browser-environment",
          "Browser adapter must provide the fixed environment contract.",
          ["adapter", "environment"],
        );
      }
      if (!configHash) {
        return failure("invalid-renderer-config", "Renderer config is invalid.", ["config"]);
      }
      if (input.context.rendererConfigHash !== configHash) {
        return failure(
          "renderer-config-hash-mismatch",
          "Compiler context must use this renderer config hash.",
          ["context", "rendererConfigHash"],
        );
      }
      if (
        input.context.locale !== environment.locale ||
        input.context.timezone !== environment.timezone
      ) {
        return failure(
          "browser-environment-context-mismatch",
          "Compiler locale/timezone must match the fixed Browser environment.",
          ["context"],
        );
      }
      if (resolvedConfig === undefined) {
        return failure("invalid-renderer-config", "Renderer config is invalid.", ["config"]);
      }
      const captures: Array<RawSurfaceCapture> = [];
      for (const stateId of Object.keys(input.plan.states).sort(compare)) {
        const state = input.plan.states[stateId];
        if (!state) {
          return failure("renderer-invalid-input", "Render state plan is invalid.", [
            "plan",
            "states",
            stateId,
          ]);
        }
        if (state.kind === "empty") {
          continue;
        }
        const rendered = documentFor(input, stateId);
        if ("ok" in rendered) {
          return rendered;
        }
        const request: BrowserCaptureRequest = Object.freeze({
          capabilities: Object.freeze({
            clock: "fixed",
            colorSpace: "srgb",
            deviceScaleFactor: 1,
            filesystem: "deny",
            network: "deny",
            random: "fixed",
          }),
          colorScheme: input.context.colorScheme,
          document: rendered.document,
          environment,
          fontFaceCount: rendered.fontFaceCount,
          pixelTarget: Object.freeze([...input.context.pixelTarget]) as readonly [number, number],
          stateId,
        });
        let rawCapture: unknown;
        try {
          rawCapture = await applyFunction(fixedCapture, adapterReceiver, [request]);
        } catch {
          return failure("browser-capture-failed", "Fixed Browser capture failed.", [
            "states",
            stateId,
          ]);
        }
        const capture = snapshotCapture(rawCapture, input.context.pixelTarget);
        if (!capture) {
          return failure(
            "invalid-browser-capture",
            "Browser capture must be RGBA sRGB at the requested pixel size.",
            ["states", stateId],
          );
        }
        captures.push({
          alphaMode: capture.alphaMode,
          colorSpace: capture.colorSpace,
          id: `web:${encodeURIComponent(input.plan.id)}:${encodeURIComponent(stateId)}`,
          pixelSize: capture.pixelSize,
          rgba: capture.rgba,
          stateId,
        });
      }
      const provenance = {
        ...identity,
        buildContextHash: input.context.buildContextHash,
        environmentHash: input.context.environmentHash,
        inputHash: input.context.inputHash,
        rendererConfigHash: input.context.rendererConfigHash,
        rendererFingerprint: input.context.rendererFingerprint,
      };
      return {
        captures,
        diagnostics: [],
        ok: true,
        provenance,
        renderSurface: {
          id: input.plan.id,
          layer: input.plan.layer,
          logicalBounds: input.plan.logicalBounds,
          semanticSurfaceId: input.plan.semanticSurfaceId,
        },
      };
    } catch {
      return failure("renderer-invalid-input", "Renderer input is invalid.", []);
    }
  };
  return Object.freeze({
    build,
    capabilities,
    identity,
    support: (request: RendererSupportRequest) => evaluateFirstMilestoneSupport(request),
  });
};

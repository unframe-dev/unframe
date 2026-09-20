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
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { snapshotDenseArray, snapshotStrictRecord } from "../validation/safe-data.js";
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
  WebRendererConfig,
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
  inputKinds: Object.freeze(["structured"] as const),
  updateModels: Object.freeze(["static"] as const),
  interactions: Object.freeze(["none"] as const),
  internalAnimations: Object.freeze(["none"] as const),
  rendererPreferences: Object.freeze(["baked-web"] as const),
  fallbackPolicies: Object.freeze(["reject"] as const),
  deterministic: true as const,
}) satisfies RendererCapabilities;

const diagnostic = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): Diagnostic => ({
  code,
  message,
  path,
});

const failure = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): RendererBuildFailure => ({
  ok: false,
  diagnostics: [diagnostic(code, message, path)],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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

const cssString = (value: string) => JSON.stringify(value);
const finite = (value: number) => Number.isFinite(value);
const cssNumber = (value: number) => {
  const normalized = Object.is(value, -0) ? 0 : value;
  return String(normalized);
};

const stableValue = (value: unknown, seen = new Set<object>()): unknown => {
  if (Array.isArray(value)) return value.map((item) => stableValue(item, seen));
  if (isRecord(value)) {
    if (seen.has(value)) throw new TypeError("Cyclic semantic tree.");
    seen.add(value);
    const result = Object.fromEntries(
      Object.keys(value)
        .sort(compare)
        .map((key) => [key, stableValue(value[key], seen)]),
    );
    seen.delete(value);
    return result;
  }
  return value;
};

const stableSnapshot = (value: unknown) => JSON.stringify(stableValue(value));

type FontCoverage = (codePoint: number) => boolean;

const fontCoverage = (bytes: Uint8Array): FontCoverage | undefined => {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readU16 = (offset: number) => {
      if (offset < 0 || offset + 2 > bytes.length) throw new RangeError();
      return view.getUint16(offset);
    };
    const readU32 = (offset: number) => {
      if (offset < 0 || offset + 4 > bytes.length) throw new RangeError();
      return view.getUint32(offset);
    };
    const tableCount = readU16(4);
    let cmapOffset = -1;
    let cmapLength = 0;
    for (let index = 0; index < tableCount; index++) {
      const record = 12 + index * 16;
      const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
      if (tag !== "cmap") continue;
      cmapOffset = readU32(record + 8);
      cmapLength = readU32(record + 12);
      if (cmapOffset + cmapLength > bytes.length) return undefined;
      break;
    }
    if (cmapOffset < 0 || readU16(cmapOffset) !== 0) return undefined;
    const subtableCount = readU16(cmapOffset + 2);
    const coverages: FontCoverage[] = [];
    for (let index = 0; index < subtableCount; index++) {
      const record = cmapOffset + 4 + index * 8;
      const platform = readU16(record);
      const encoding = readU16(record + 2);
      if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
      const offset = cmapOffset + readU32(record + 4);
      const format = readU16(offset);
      if (format === 12) {
        const length = readU32(offset + 4);
        const groupCount = readU32(offset + 12);
        if (offset + length > cmapOffset + cmapLength || 16 + groupCount * 12 > length)
          return undefined;
        coverages.push((codePoint) => {
          for (let group = 0; group < groupCount; group++) {
            const start = readU32(offset + 16 + group * 12);
            const end = readU32(offset + 20 + group * 12);
            if (codePoint < start) return false;
            if (codePoint <= end)
              return (readU32(offset + 24 + group * 12) + codePoint - start) % 0x1_0000 !== 0;
          }
          return false;
        });
      } else if (format === 4) {
        const length = readU16(offset + 2);
        const segmentCount = readU16(offset + 6) / 2;
        if (
          !Number.isSafeInteger(segmentCount) ||
          segmentCount <= 0 ||
          offset + length > cmapOffset + cmapLength
        )
          return undefined;
        const endCodes = offset + 14;
        const startCodes = endCodes + segmentCount * 2 + 2;
        const deltas = startCodes + segmentCount * 2;
        const rangeOffsets = deltas + segmentCount * 2;
        if (rangeOffsets + segmentCount * 2 > offset + length) return undefined;
        coverages.push((codePoint) => {
          if (codePoint > 0xffff) return false;
          for (let segment = 0; segment < segmentCount; segment++) {
            const end = readU16(endCodes + segment * 2);
            if (codePoint > end) continue;
            const start = readU16(startCodes + segment * 2);
            if (codePoint < start) return false;
            const delta = readU16(deltas + segment * 2);
            const rangeOffset = readU16(rangeOffsets + segment * 2);
            if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0;
            const glyphOffset = rangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2;
            if (glyphOffset + 2 > offset + length) return false;
            const glyph = readU16(glyphOffset);
            return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
          }
          return false;
        });
      }
    }
    return coverages.length > 0
      ? (codePoint) => coverages.some((supports) => supports(codePoint))
      : undefined;
  } catch {
    return undefined;
  }
};

const decodeFontAsset = (
  assetId: string,
  asset: CompilerResolvedSurfaceInput["fontAssets"][string],
):
  | { readonly family: string; readonly face: string; readonly supports: FontCoverage }
  | RendererBuildFailure => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.dataBase64))
    return failure("invalid-font-asset", "Font asset data must be canonical base64.", [
      "fontAssets",
      assetId,
      "dataBase64",
    ]);
  const bytes = Uint8Array.from(Buffer.from(asset.dataBase64, "base64"));
  if (bytes.length === 0 || Buffer.from(bytes).toString("base64") !== asset.dataBase64)
    return failure("invalid-font-asset", "Font asset data must be canonical base64.", [
      "fontAssets",
      assetId,
      "dataBase64",
    ]);
  const checksum = `sha256:${bytesToHex(sha256(bytes))}`;
  if (checksum !== asset.checksum)
    return failure(
      "font-asset-checksum-mismatch",
      "Font asset checksum does not match its bytes.",
      ["fontAssets", assetId, "checksum"],
    );
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  const validSignature =
    asset.mediaType === "font/otf"
      ? signature === "OTTO"
      : bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;
  if (!validSignature)
    return failure(
      "font-asset-signature-mismatch",
      "Font bytes do not match the declared media type.",
      ["fontAssets", assetId, "mediaType"],
    );
  const supports = fontCoverage(bytes);
  if (!supports)
    return failure("invalid-font-asset", "Font asset must contain a valid Unicode cmap.", [
      "fontAssets",
      assetId,
      "dataBase64",
    ]);
  const family = `unframe-font-${asset.checksum.slice(7, 23)}`;
  const format = asset.mediaType === "font/otf" ? "opentype" : "truetype";
  return {
    family,
    supports,
    face: `@font-face{font-family:${cssString(family)};src:url("data:${asset.mediaType};base64,${asset.dataBase64}") format("${format}");font-style:normal;font-weight:400 700;font-display:block}`,
  };
};

const rgbaCss = (color: {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}) =>
  `rgba(${cssNumber(color.red * 255)},${cssNumber(color.green * 255)},${cssNumber(color.blue * 255)},${cssNumber(color.alpha)})`;

const documentFor = (
  input: CompilerResolvedSurfaceInput,
  config: WebRendererConfig,
): { readonly document: string; readonly fontFaceCount: number } | RendererBuildFailure => {
  if (
    Object.keys(input.surface.interactions).length > 0 ||
    Object.values(input.surface.states).some(
      (state) =>
        Object.keys(state.contentOverrides).length > 0 ||
        state.semanticOverrides.some((override) => Object.keys(override.nodes).length > 0) ||
        state.enabledInteractionIds.length > 0,
    )
  )
    return failure(
      "unsupported-state-visual-variation",
      "Static Structured rendering does not accept content or interaction variation.",
      ["surface", "states"],
    );
  const root = input.surface.contentNodes[input.surface.rootFrameId];
  if (
    !root ||
    root.kind !== "frame" ||
    root.parentId !== null ||
    root.layout.kind !== "absolute" ||
    root.placement.kind !== "absolute"
  )
    return failure(
      "unsupported-structured-tree",
      "Structured rendering requires an absolute root Frame.",
      ["surface", "rootFrameId"],
    );
  if (!input.plan.contentNodeIds.includes(root.id))
    return failure("unsupported-structured-tree", "Render plan must include the root Frame.", [
      "plan",
      "contentNodeIds",
    ]);
  const planned = new Set(input.plan.contentNodeIds);
  const children = [...root.children];
  if (new Set(children).size !== children.length)
    return failure("unsupported-structured-tree", "Root Frame children must be unique.", [
      "surface",
      "contentNodes",
      root.id,
      "children",
    ]);
  if (
    children.some((id) => !planned.has(id)) ||
    [...planned].some((id) => id !== root.id && !children.includes(id))
  )
    return failure(
      "unsupported-structured-tree",
      "Initial renderer accepts only root Frame direct children.",
      ["plan", "contentNodeIds"],
    );

  const bounds = input.plan.logicalBounds;
  const xScale = input.context.pixelTarget[0] / bounds.width;
  const yScale = input.context.pixelTarget[1] / bounds.height;
  if (!finite(xScale) || !finite(yScale))
    return failure("invalid-render-scale", "Render scale must remain finite.", [
      "plan",
      "logicalBounds",
    ]);
  const rootPlacement = root.placement;
  if (
    rootPlacement.x < bounds.x ||
    rootPlacement.y < bounds.y ||
    rootPlacement.x + rootPlacement.width > bounds.x + bounds.width ||
    rootPlacement.y + rootPlacement.height > bounds.y + bounds.height
  )
    return failure(
      "root-frame-outside-render-surface",
      "Root Frame must fit inside the Render Surface bounds.",
      ["surface", "contentNodes", root.id, "placement"],
    );
  const referencedFontIds = new Set<string>();
  const textFontRequirements: {
    readonly nodeId: string;
    readonly value: string;
    readonly fontIds: readonly string[];
  }[] = [];
  const textNodes: string[] = [];
  for (const id of children) {
    const node = input.surface.contentNodes[id];
    if (
      !node ||
      node.kind !== "text" ||
      node.parentId !== root.id ||
      node.placement.kind !== "absolute" ||
      node.value.kind !== "literal"
    )
      return failure(
        "unsupported-structured-tree",
        "Initial renderer accepts direct absolute Text children only.",
        ["surface", "contentNodes", id],
      );
    const placement = node.placement;
    if (
      placement.x < 0 ||
      placement.y < 0 ||
      placement.x + placement.width > rootPlacement.width ||
      placement.y + placement.height > rootPlacement.height
    )
      return failure(
        "text-outside-render-surface",
        "Text placement must fit inside the Render Surface bounds.",
        ["surface", "contentNodes", id, "placement"],
      );
    const [left, top, width, height] = [
      placement.x * xScale,
      placement.y * yScale,
      placement.width * xScale,
      placement.height * yScale,
    ];
    if (![left, top, width, height].every(finite))
      return failure("invalid-render-geometry", "Scaled render geometry must remain finite.", [
        "surface",
        "contentNodes",
        id,
        "placement",
      ]);
    if (Array.from(node.value.value).length > node.maxCodePoints)
      return failure("text-max-code-points-exceeded", "Literal Text exceeds maxCodePoints.", [
        "surface",
        "contentNodes",
        id,
        "value",
      ]);
    const fontIds = [node.style.fontAssetId, ...node.style.fallbackFontAssetIds];
    for (const fontId of fontIds) referencedFontIds.add(fontId);
    textFontRequirements.push({ nodeId: id, value: node.value.value, fontIds });
    const families = fontIds
      .map((fontId) => {
        const checksum = input.fontAssets[fontId]?.checksum;
        return checksum ? `unframe-font-${checksum.slice(7, 23)}` : "missing-font-asset";
      })
      .join(",");
    const overflow =
      node.style.overflow === "ellipsis"
        ? "overflow:hidden;white-space:nowrap;text-overflow:ellipsis"
        : "overflow:hidden;white-space:pre-wrap";
    textNodes.push(
      `<div class="text" data-node-id="${escapeHtml(node.id)}" style="left:${cssNumber(left)}px;top:${cssNumber(top)}px;width:${cssNumber(width)}px;height:${cssNumber(height)}px;display:${node.visible ? "block" : "none"};opacity:${cssNumber(node.opacity)};font-family:${families};font-size:${cssNumber(node.style.fontSize * yScale)}px;line-height:${cssNumber(node.style.lineHeight * yScale)}px;color:${rgbaCss(node.style.color)};font-weight:${node.style.weight === "bold" ? "700" : "400"};text-align:${node.style.align};${overflow}">${escapeHtml(node.value.value)}</div>`,
    );
  }
  const fontFaces: string[] = [];
  const coverageByAssetId = new Map<string, FontCoverage>();
  for (const assetId of referencedFontIds) {
    if (!input.fontAssets[assetId])
      return failure("missing-font-asset", "Text references a missing Font Asset.", [
        "fontAssets",
        assetId,
      ]);
  }
  for (const assetId of Object.keys(input.fontAssets).sort(compare)) {
    const asset = input.fontAssets[assetId];
    if (!asset) continue;
    const decoded = decodeFontAsset(assetId, asset);
    if ("ok" in decoded) return decoded;
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
      )
        return failure(
          "font-glyph-missing",
          "No declared Font Asset contains a glyph required by literal Text.",
          ["surface", "contentNodes", requirement.nodeId, "value"],
        );
    }
  }
  const [red, green, blue, alpha] = config.documentBackground;
  const rootLeft = (rootPlacement.x - bounds.x) * xScale;
  const rootTop = (rootPlacement.y - bounds.y) * yScale;
  const rootWidth = rootPlacement.width * xScale;
  const rootHeight = rootPlacement.height * yScale;
  const style = `${fontFaces.join("")}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:rgba(${red},${green},${blue},${cssNumber(alpha / 255)});color-scheme:${input.context.colorScheme}}#viewport{position:relative;width:${input.context.pixelTarget[0]}px;height:${input.context.pixelTarget[1]}px}#surface{position:absolute;box-sizing:border-box;left:${cssNumber(rootLeft)}px;top:${cssNumber(rootTop)}px;width:${cssNumber(rootWidth)}px;height:${cssNumber(rootHeight)}px;display:${root.visible ? "block" : "none"};opacity:${cssNumber(root.opacity)};background:${rgbaCss(root.backgroundColor)};border:${cssNumber(root.border.width * yScale)}px solid ${rgbaCss(root.border.color)};border-radius:${cssNumber(root.border.radius * yScale)}px;overflow:${root.clip ? "hidden" : "visible"}}.text{position:absolute;box-sizing:border-box}`;
  return Object.freeze({
    document: `<!doctype html><html lang="${escapeHtml(input.context.locale)}"><head><meta charset="utf-8"><style>${style}</style></head><body><main id="viewport"><div id="surface">${textNodes.join("")}</div></main></body></html>`,
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
  if (!record || !pixelSize || !rgba) return undefined;
  const parsed = browserCaptureSchemaFor(pixelTarget).safeParse({ ...record, pixelSize, rgba });
  if (!parsed.success) return undefined;
  const [width, height] = parsed.data.pixelSize;
  return {
    rgba,
    pixelSize: [width, height],
    colorSpace: "srgb",
    alphaMode: parsed.data.alphaMode,
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
      ? Object.freeze({ identity: adapterIdentity, environment, capture: fixedCapture })
      : undefined;
  const implementationHash =
    environment && adapterIdentity
      ? hash({
          renderer: "unframe-baked-web",
          version: RENDERER_VERSION,
          environment: normalizedEnvironment(environment),
          adapter: adapterIdentity,
        })
      : "sha256:invalid-browser-environment";
  const identity = Object.freeze({
    id: "baked-web",
    version: RENDERER_VERSION,
    contractVersion: CONTRACT_VERSION,
    implementationHash,
  });
  const validatorPlugin: RendererPlugin = {
    identity,
    capabilities,
    support: (request: RendererSupportRequest) => evaluateFirstMilestoneSupport(request),
    build: () => failure("renderer-not-invoked", "Validation must not invoke build."),
  };
  const build = async (rawInput: CompilerResolvedSurfaceInput): Promise<RendererBuildResult> => {
    try {
      const prepared = prepareRendererBuildInput(rawInput, validatorPlugin);
      if (!prepared.valid) return { ok: false, diagnostics: [...prepared.diagnostics] };
      const input = prepared.value;
      const support = evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: input.resolvedIntent,
      });
      if (!support.supported) return { ok: false, diagnostics: support.diagnostics };
      if (!environment || !adapterIdentity || !fixedCapture || !adapterReceiver)
        return failure(
          "invalid-browser-environment",
          "Browser adapter must provide the fixed environment contract.",
          ["adapter", "environment"],
        );
      if (!configHash)
        return failure("invalid-renderer-config", "Renderer config is invalid.", ["config"]);
      if (input.context.rendererConfigHash !== configHash)
        return failure(
          "renderer-config-hash-mismatch",
          "Compiler context must use this renderer config hash.",
          ["context", "rendererConfigHash"],
        );
      if (
        input.context.locale !== environment.locale ||
        input.context.timezone !== environment.timezone
      )
        return failure(
          "browser-environment-context-mismatch",
          "Compiler locale/timezone must match the fixed Browser environment.",
          ["context"],
        );
      if (resolvedConfig === undefined)
        return failure("invalid-renderer-config", "Renderer config is invalid.", ["config"]);
      const rendered = documentFor(input, resolvedConfig);
      if ("ok" in rendered) return rendered;
      const captureStateIds = Object.keys(input.plan.states)
        .filter((stateId) => input.plan.states[stateId]?.kind === "capture")
        .sort(compare);
      const firstSemanticState = captureStateIds[0];
      if (
        firstSemanticState !== undefined &&
        captureStateIds.some(
          (stateId) =>
            stableSnapshot(input.semanticsByState[stateId]) !==
            stableSnapshot(input.semanticsByState[firstSemanticState]),
        )
      )
        return failure(
          "unsupported-state-visual-variation",
          "Initial Structured rendering cannot represent differing capture-state semantics.",
          ["semanticsByState"],
        );
      const captures: RawSurfaceCapture[] = [];
      const hitRegionsByState: Record<string, readonly []> = Object.create(null) as Record<
        string,
        readonly []
      >;
      for (const stateId of Object.keys(input.plan.states).sort(compare)) {
        const state = input.plan.states[stateId];
        if (!state)
          return failure("renderer-invalid-input", "Render state plan is invalid.", [
            "plan",
            "states",
            stateId,
          ]);
        hitRegionsByState[stateId] = [];
        if (state.kind === "empty") continue;
        const request: BrowserCaptureRequest = Object.freeze({
          stateId,
          document: rendered.document,
          fontFaceCount: rendered.fontFaceCount,
          pixelTarget: Object.freeze([...input.context.pixelTarget]) as readonly [number, number],
          colorScheme: input.context.colorScheme,
          environment,
          capabilities: Object.freeze({
            network: "deny",
            filesystem: "deny",
            clock: "fixed",
            random: "fixed",
            deviceScaleFactor: 1,
            colorSpace: "srgb",
          }),
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
        if (!capture)
          return failure(
            "invalid-browser-capture",
            "Browser capture must be RGBA sRGB at the requested pixel size.",
            ["states", stateId],
          );
        captures.push({
          id: `web:${encodeURIComponent(input.plan.id)}:${encodeURIComponent(stateId)}`,
          stateId,
          rgba: capture.rgba,
          pixelSize: capture.pixelSize,
          colorSpace: capture.colorSpace,
          alphaMode: capture.alphaMode,
        });
      }
      const provenance = {
        ...identity,
        inputHash: input.context.inputHash,
        buildContextHash: input.context.buildContextHash,
        environmentHash: input.context.environmentHash,
        rendererConfigHash: input.context.rendererConfigHash,
        rendererFingerprint: input.context.rendererFingerprint,
      };
      return {
        ok: true,
        renderSurface: {
          id: input.plan.id,
          semanticSurfaceId: input.plan.semanticSurfaceId,
          logicalBounds: input.plan.logicalBounds,
          layer: input.plan.layer,
        },
        captures,
        hitRegionsByState,
        provenance,
        diagnostics: [],
      };
    } catch {
      return failure("renderer-invalid-input", "Renderer input is invalid.", []);
    }
  };
  return Object.freeze({
    identity,
    capabilities,
    support: (request: RendererSupportRequest) => evaluateFirstMilestoneSupport(request),
    build,
  });
};

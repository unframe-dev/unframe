import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
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
} from "@unframe/presentation-renderer-api";

import { snapshotDenseArray, snapshotStrictRecord } from "./validation/safe-data.js";
import {
  adapterIdentitySchema,
  browserCaptureSchema,
  fixedBrowserEnvironmentSchema,
  webRendererConfigSchema,
} from "./validation/schemas.js";

export {
  bundleOpaqueRenderer,
  type OpaqueBundleDiagnostic,
  type OpaqueRendererBundleInput,
  type OpaqueRendererBundleResult,
  type OpaqueRendererModule,
  type OpaqueRendererModuleType,
} from "./opaque/bundle-opaque-renderer.js";

export type FixedBrowserEnvironment = {
  readonly browser: {
    readonly id: string;
    readonly version: string;
    readonly fontFingerprint: string;
  };
  readonly locale: string;
  readonly timezone: string;
  readonly colorSpace: "srgb";
  readonly deviceScaleFactor: 1;
  readonly network: "deny";
  readonly filesystem: "deny";
  readonly clock: "fixed";
  readonly random: "fixed";
};

export type BrowserCaptureRequest = {
  readonly stateId: string;
  readonly document: string;
  readonly pixelTarget: readonly [width: number, height: number];
  readonly colorScheme: "light" | "dark";
  readonly environment: FixedBrowserEnvironment;
  readonly capabilities: Pick<
    FixedBrowserEnvironment,
    "network" | "filesystem" | "clock" | "random" | "deviceScaleFactor" | "colorSpace"
  >;
};

export type BrowserRgbaCapture = {
  readonly rgba: Uint8Array;
  readonly pixelSize: readonly [width: number, height: number];
  readonly colorSpace: "srgb";
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
};

export type FixedBrowserAdapter = {
  readonly identity: {
    readonly id: string;
    readonly implementationHash: string;
  };
  readonly environment: FixedBrowserEnvironment;
  capture(request: BrowserCaptureRequest): Promise<BrowserRgbaCapture> | BrowserRgbaCapture;
};

export type WebRendererConfig = {
  readonly documentBackground: readonly [red: number, green: number, blue: number, alpha: number];
  readonly fontFamily: string;
};

export type CreateBakedWebRendererOptions = {
  readonly adapter: FixedBrowserAdapter;
  readonly config: WebRendererConfig;
};

const RENDERER_VERSION = "1";
const CONTRACT_VERSION = "1";
const encoder = new TextEncoder();
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
const hash = (value: unknown) =>
  `sha256:${bytesToHex(sha256(encoder.encode(JSON.stringify(value))))}`;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)?.get;
const copyRgba = (value: unknown): Uint8Array | undefined => {
  try {
    if (!ArrayBuffer.isView(value) || !typedArrayByteLength || !typedArrayTag) return undefined;
    if (typedArrayTag.call(value) !== "Uint8Array") return undefined;
    const byteLength = typedArrayByteLength.call(value);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return undefined;
    const copy = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(copy, value as Uint8Array);
    return copy;
  } catch {
    return undefined;
  }
};

const environmentKeys = [
  "browser",
  "clock",
  "colorSpace",
  "deviceScaleFactor",
  "filesystem",
  "locale",
  "network",
  "random",
  "timezone",
] as const;
const browserKeys = ["fontFingerprint", "id", "version"] as const;
const adapterIdentityKeys = ["id", "implementationHash"] as const;

const snapshotAdapterIdentity = (
  identity: unknown,
): Readonly<FixedBrowserAdapter["identity"]> | undefined => {
  const record = snapshotStrictRecord(identity, adapterIdentityKeys);
  if (!record) return undefined;
  const parsed = adapterIdentitySchema.safeParse(record);
  return parsed.success ? Object.freeze(parsed.data) : undefined;
};

const normalizedEnvironment = (environment: FixedBrowserEnvironment) => ({
  browser: {
    id: environment.browser.id,
    version: environment.browser.version,
    fontFingerprint: environment.browser.fontFingerprint,
  },
  locale: environment.locale,
  timezone: environment.timezone,
  colorSpace: environment.colorSpace,
  deviceScaleFactor: environment.deviceScaleFactor,
  network: environment.network,
  filesystem: environment.filesystem,
  clock: environment.clock,
  random: environment.random,
});

const snapshotEnvironment = (value: unknown): FixedBrowserEnvironment | undefined => {
  const record = snapshotStrictRecord(value, environmentKeys);
  const browser = record && snapshotStrictRecord(record.browser, browserKeys);
  if (!record || !browser) return undefined;
  const parsed = fixedBrowserEnvironmentSchema.safeParse({ ...record, browser });
  if (!parsed.success) return undefined;
  return Object.freeze({
    ...parsed.data,
    browser: Object.freeze(parsed.data.browser),
  });
};

const snapshotConfig = (config: unknown): WebRendererConfig | undefined => {
  const record = snapshotStrictRecord(config, ["documentBackground", "fontFamily"]);
  const values = record && snapshotDenseArray(record.documentBackground, 4);
  if (!record || !values) return undefined;
  const parsed = webRendererConfigSchema.safeParse({
    documentBackground: values,
    fontFamily: record.fontFamily,
  });
  return parsed.success ? frozenConfig(parsed.data) : undefined;
};

const configHashFromSnapshot = (config: WebRendererConfig): string =>
  hash({ documentBackground: config.documentBackground, fontFamily: config.fontFamily });

export const createWebRendererConfigHash = (config: WebRendererConfig): string => {
  const snapshot = snapshotConfig(config);
  if (!snapshot)
    throw new TypeError(
      "Web renderer config must use finite RGBA bytes and a non-empty font family.",
    );
  return configHashFromSnapshot(snapshot);
};

const frozenConfig = (config: WebRendererConfig): WebRendererConfig =>
  Object.freeze({
    documentBackground: Object.freeze([...config.documentBackground]) as readonly [
      number,
      number,
      number,
      number,
    ],
    fontFamily: config.fontFamily.trim(),
  });

const escapeHtml = (value: unknown) => {
  if (typeof value !== "string") throw new TypeError("HTML text must be a primitive string.");
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

const documentFor = (
  input: CompilerResolvedSurfaceInput,
  config: WebRendererConfig,
): { readonly document: string } | RendererBuildFailure => {
  if (input.context.colorScheme !== "light" && input.context.colorScheme !== "dark")
    return failure("invalid-renderer-context", "Color scheme must be light or dark.", [
      "context",
      "colorScheme",
    ]);
  const root = input.surface.contentNodes[input.surface.rootFrameId];
  if (!root || root.kind !== "frame" || root.parentId !== null || root.layout.kind !== "absolute")
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
  const textNodes: string[] = [];
  for (const id of children) {
    const node = input.surface.contentNodes[id];
    if (
      !node ||
      node.kind !== "text" ||
      node.parentId !== root.id ||
      node.placement.kind !== "absolute"
    )
      return failure(
        "unsupported-structured-tree",
        "Initial renderer accepts direct absolute Text children only.",
        ["surface", "contentNodes", id],
      );
    const placement = node.placement;
    if (
      ![placement.x, placement.y, placement.width, placement.height].every(finite) ||
      placement.width <= 0 ||
      placement.height <= 0 ||
      placement.x < bounds.x ||
      placement.y < bounds.y ||
      placement.x + placement.width > bounds.x + bounds.width ||
      placement.y + placement.height > bounds.y + bounds.height
    )
      return failure(
        "text-outside-render-surface",
        "Text placement must fit inside the Render Surface bounds.",
        ["surface", "contentNodes", id, "placement"],
      );
    const [left, top, width, height] = [
      (placement.x - bounds.x) * xScale,
      (placement.y - bounds.y) * yScale,
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
    textNodes.push(
      `<div class="text" data-node-id="${escapeHtml(node.id)}" style="left:${cssNumber(left)}px;top:${cssNumber(top)}px;width:${cssNumber(width)}px;height:${cssNumber(height)}px">${escapeHtml(node.text)}</div>`,
    );
  }
  const [red, green, blue, alpha] = config.documentBackground;
  const style = `html,body{margin:0;width:100%;height:100%;overflow:hidden}#surface{position:relative;width:${input.context.pixelTarget[0]}px;height:${input.context.pixelTarget[1]}px;background:rgba(${red},${green},${blue},${cssNumber(alpha / 255)});font-family:${cssString(config.fontFamily)};color-scheme:${input.context.colorScheme}}.text{position:absolute;overflow:hidden;white-space:pre-wrap;box-sizing:border-box}`;
  return Object.freeze({
    document: `<!doctype html><html lang="${escapeHtml(input.context.locale)}"><head><meta charset="utf-8"><style>${style}</style></head><body><main id="surface">${textNodes.join("")}</main></body></html>`,
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
  const parsed = browserCaptureSchema.safeParse({ ...record, pixelSize, rgba });
  if (!parsed.success) return undefined;
  const [width, height] = parsed.data.pixelSize;
  if (
    width !== pixelTarget[0] ||
    height !== pixelTarget[1] ||
    rgba.byteLength !== pixelTarget[0] * pixelTarget[1] * 4 ||
    parsed.data.colorSpace !== "srgb"
  )
    return undefined;
  if (
    parsed.data.alphaMode === "opaque" &&
    rgba.some((_, index) => index % 4 === 3 && rgba[index] !== 255)
  )
    return undefined;
  return {
    rgba,
    pixelSize: [width, height],
    colorSpace: "srgb",
    alphaMode: parsed.data.alphaMode,
  };
};

export const createBakedWebRenderer = ({
  adapter,
  config,
}: CreateBakedWebRendererOptions): RendererPlugin => {
  const initialAdapter = snapshotStrictRecord(adapter, ["capture", "environment", "identity"]);
  const fixedCapture =
    typeof initialAdapter?.capture === "function" ? initialAdapter.capture : undefined;
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

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  FixedBrowserAdapter,
  FixedBrowserEnvironment,
  WebRendererConfig,
} from "../public-types.js";
import { snapshotDenseArray, snapshotStrictRecord } from "../validation/safe-data.js";
import {
  adapterIdentitySchema,
  fixedBrowserEnvironmentSchema,
  webRendererConfigSchema,
} from "../validation/schemas.js";

const encoder = new TextEncoder();
export const hash = (value: unknown) =>
  `sha256:${bytesToHex(sha256(encoder.encode(JSON.stringify(value))))}`;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)?.get;
export const copyRgba = (value: unknown): Uint8Array | undefined => {
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

export const snapshotAdapterIdentity = (
  identity: unknown,
): Readonly<FixedBrowserAdapter["identity"]> | undefined => {
  const record = snapshotStrictRecord(identity, adapterIdentityKeys);
  if (!record) return undefined;
  const parsed = adapterIdentitySchema.safeParse(record);
  return parsed.success ? Object.freeze(parsed.data) : undefined;
};

export const normalizedEnvironment = (environment: FixedBrowserEnvironment) => ({
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

export const snapshotEnvironment = (value: unknown): FixedBrowserEnvironment | undefined => {
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

export const snapshotConfig = (config: unknown): WebRendererConfig | undefined => {
  const record = snapshotStrictRecord(config, ["documentBackground", "fontFamily"]);
  const values = record && snapshotDenseArray(record.documentBackground, 4);
  if (!record || !values) return undefined;
  const parsed = webRendererConfigSchema.safeParse({
    documentBackground: values,
    fontFamily: record.fontFamily,
  });
  return parsed.success ? frozenConfig(parsed.data) : undefined;
};

export const configHashFromSnapshot = (config: WebRendererConfig): string =>
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

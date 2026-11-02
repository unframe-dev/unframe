import { verifyBuildIntegrity, type BuildArtifacts } from "@unframe/artifacts";
import { z } from "zod";
import { parseStrictJson } from "@unframe/artifacts";

export type BrowserDistFile = Readonly<{
  webkitRelativePath: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type BrowserDistSnapshot = Readonly<{
  artifacts: BuildArtifacts;
  assetCount: number;
  totalAssetBytes: number;
  readAsset(assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
}>;

export type BrowserDistErrorCode =
  | "dist-empty"
  | "dist-path-invalid"
  | "dist-file-duplicate"
  | "dist-file-missing"
  | "dist-file-too-large"
  | "dist-file-count-exceeded"
  | "dist-file-read-failed"
  | "dist-json-invalid"
  | "dist-receipt-invalid"
  | "dist-build-invalid"
  | "dist-asset-invalid"
  | "dist-cancelled";

export class BrowserDistError extends Error {
  override readonly name = "BrowserDistError";

  constructor(readonly code: BrowserDistErrorCode) {
    super(code);
  }
}

const artifactLimit = 8 * 1024 * 1024;
const assetLimit = 256 * 1024 * 1024;
const maximumFileCount = 10000;
const receiptSchema = z.strictObject({
  generationId: z.string().regex(/^[0-9a-f]{32}$/u),
  buildManifestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});
const extensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "video/mp4": "mp4",
  "model/gltf-binary": "glb",
};
const fail = (code: BrowserDistErrorCode): never => {
  throw new BrowserDistError(code);
};
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail("dist-cancelled");
};
const digest = async (bytes: Uint8Array<ArrayBuffer>) => {
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(result), (value) => value.toString(16).padStart(2, "0")).join("")}`;
};
const parseJson = (bytes: Uint8Array): unknown => {
  const result = parseStrictJson(bytes);
  if (!result.ok) return fail("dist-json-invalid");
  return result.value;
};

export async function readBrowserDist(
  input: readonly BrowserDistFile[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<BrowserDistSnapshot> {
  checkAbort(signal);
  if (input.length === 0) return fail("dist-empty");
  if (input.length > maximumFileCount) return fail("dist-file-count-exceeded");
  const selected = Array.from(input);
  const files = new Map<string, BrowserDistFile>();
  let root: string | undefined;
  for (const file of selected) {
    const path = file.webkitRelativePath;
    const segments = path.split("/");
    if (
      path.length > 4096 ||
      !path.isWellFormed() ||
      path.includes("\\") ||
      path.includes(":") ||
      Array.from(path).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      segments.length < 2 ||
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    )
      return fail("dist-path-invalid");
    root ??= segments[0];
    if (segments[0] !== root) return fail("dist-path-invalid");
    const relative = segments.slice(1).join("/");
    if (files.has(relative)) return fail("dist-file-duplicate");
    files.set(relative, file);
  }
  const read = async (path: string, maximum: number) => {
    checkAbort(signal);
    const file = files.get(path);
    if (!file) return fail("dist-file-missing");
    if (file.size > maximum) return fail("dist-file-too-large");
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      checkAbort(signal);
      return fail("dist-file-read-failed");
    }
    checkAbort(signal);
    if (bytes.byteLength > maximum) return fail("dist-file-too-large");
    if (bytes.byteLength !== file.size) return fail("dist-file-read-failed");
    return Uint8Array.from(bytes);
  };
  const receipt = receiptSchema.safeParse(parseJson(await read("build-receipt.json", 1024)));
  if (!receipt.success) return fail("dist-receipt-invalid");
  const buildManifest = await read("build-manifest.json", artifactLimit);
  if ((await digest(buildManifest)) !== receipt.data.buildManifestHash)
    return fail("dist-receipt-invalid");
  checkAbort(signal);
  const integrity = verifyBuildIntegrity({
    definition: parseJson(await read("definition.json", artifactLimit)),
    renderBundle: parseJson(await read("render-bundle.json", artifactLimit)),
    assetSet: parseJson(await read("asset-set.json", artifactLimit)),
    buildManifest: parseJson(buildManifest),
  });
  if (!integrity.valid) return fail("dist-build-invalid");
  const artifacts = integrity.value;
  const descriptors = Object.entries(artifacts.assetSet.assets);
  const totalAssetBytes = descriptors.reduce(
    (total, [, descriptor]) => total + descriptor.encodedSizeBytes,
    0,
  );
  if (!Number.isSafeInteger(totalAssetBytes) || totalAssetBytes > assetLimit)
    return fail("dist-file-too-large");
  const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  for (const [assetId, descriptor] of descriptors) {
    const extension = extensions[descriptor.mediaType];
    if (!extension) return fail("dist-asset-invalid");
    const bytes = await read(
      `assets/${encodeURIComponent(assetId)}.${extension}`,
      descriptor.encodedSizeBytes,
    );
    if (
      bytes.byteLength !== descriptor.encodedSizeBytes ||
      (await digest(bytes)) !== descriptor.checksum
    )
      return fail("dist-asset-invalid");
    checkAbort(signal);
    assets.set(assetId, { bytes, mediaType: descriptor.mediaType });
  }
  checkAbort(signal);
  return {
    artifacts,
    assetCount: descriptors.length,
    totalAssetBytes,
    readAsset: async (assetId) => {
      const asset = assets.get(assetId);
      if (!asset) return fail("dist-asset-invalid");
      return { bytes: asset.bytes.slice(), mediaType: asset.mediaType };
    },
  };
}

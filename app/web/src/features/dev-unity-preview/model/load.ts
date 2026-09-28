import {
  validatePresentationDefinition,
  validateRenderBundle,
  verifyBuildIntegrityV2,
  type BuildArtifactsV2,
} from "@unframe/unframe-core";
import { createPreviewScene } from "./scene";
import type { PreviewDocument } from "./types";

const artifactPaths = [
  "definition.json",
  "render-bundle.json",
  "asset-set.json",
  "build-manifest.json",
];

const extensionForMediaType: Record<string, string> = {
  "image/png": "png",
  "font/ttf": "ttf",
  "font/otf": "otf",
};

function normalizeFilePath(file: File) {
  const source = file.webkitRelativePath || file.name;
  const parts = source.split("/");
  const path = file.webkitRelativePath ? parts.slice(1).join("/") : source;
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "." || part === ".." || !part)
  ) {
    throw new Error(`不正なファイルパス: ${source}`);
  }
  return path;
}

async function readArtifact(files: Map<string, File>, path: string): Promise<unknown> {
  const file = files.get(path);
  if (!file) throw new Error(`${path} がありません。dist フォルダを選択してください。`);
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${path} は有効な JSON ではありません。`);
  }
}

function diagnosticsMessage(result: {
  diagnostics: { path: readonly (string | number)[]; message: string }[];
}) {
  const first = result.diagnostics[0];
  return first ? `${first.path.join(".")}: ${first.message}` : "検証に失敗しました。";
}

function rejectUnsupported(artifacts: BuildArtifactsV2) {
  const { definition, renderBundle } = artifacts;
  for (const node of Object.values(definition.scene.nodes)) {
    if (node.parent.kind === "anchor") throw new Error(`Anchor はプレビュー未対応です: ${node.id}`);
    if (node.kind === "model") throw new Error(`Model はプレビュー未対応です: ${node.id}`);
    if (node.kind !== "surface" && node.kind !== "container") {
      throw new Error(`${node.kind} はプレビュー未対応です: ${node.id}`);
    }
  }
  if (Object.keys(renderBundle.models).length) throw new Error("Model はプレビュー未対応です。");
  for (const surface of Object.values(renderBundle.surfaces)) {
    for (const renderSurface of Object.values(surface.renderSurfaces)) {
      for (const artifact of Object.values(renderSurface.artifacts)) {
        if (artifact.kind !== "baked-web") {
          throw new Error(`${artifact.kind} はプレビュー未対応です: ${artifact.id}`);
        }
      }
    }
  }
}

export async function loadPreviewDist(inputFiles: readonly File[]): Promise<PreviewDocument> {
  const files = new Map<string, File>();
  for (const file of inputFiles) {
    let path = normalizeFilePath(file);
    if (!file.webkitRelativePath && !artifactPaths.includes(path)) path = `assets/${path}`;
    if (files.has(path)) throw new Error(`ファイルが重複しています: ${path}`);
    files.set(path, file);
  }

  const definition = await readArtifact(files, "definition.json");
  const renderBundle = await readArtifact(files, "render-bundle.json");
  const assetSet = await readArtifact(files, "asset-set.json");
  const buildManifest = await readArtifact(files, "build-manifest.json");
  const validDefinition = validatePresentationDefinition(definition);
  if (!validDefinition.valid)
    throw new Error(`definition.json: ${diagnosticsMessage(validDefinition)}`);
  const validBundle = validateRenderBundle(renderBundle);
  if (!validBundle.valid) throw new Error(`render-bundle.json: ${diagnosticsMessage(validBundle)}`);
  const verified = verifyBuildIntegrityV2({ definition, renderBundle, assetSet, buildManifest });
  if (!verified.valid) throw new Error(`ビルド整合性エラー: ${diagnosticsMessage(verified)}`);
  const artifacts = verified.value;
  rejectUnsupported(artifacts);

  const expectedPaths = new Set(artifactPaths);
  const assetBytes = new Map<string, Uint8Array>();
  for (const [id, descriptor] of Object.entries(artifacts.assetSet.assets)) {
    const extension = extensionForMediaType[descriptor.mediaType];
    if (!extension) throw new Error(`${descriptor.mediaType} はプレビュー未対応です: ${id}`);
    const path = `assets/${encodeURIComponent(id)}.${extension}`;
    expectedPaths.add(path);
    const file = files.get(path);
    if (!file) throw new Error(`アセットがありません: ${path}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== descriptor.encodedSizeBytes) {
      throw new Error(`アセットのサイズが一致しません: ${path}`);
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const checksum = `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (checksum !== descriptor.checksum)
      throw new Error(`アセットの checksum が一致しません: ${path}`);
    assetBytes.set(id, bytes);
  }
  for (const path of files.keys()) {
    if (!expectedPaths.has(path)) throw new Error(`予期しないファイルです: ${path}`);
  }

  const urls = new Map<string, string>();
  try {
    for (const [id, descriptor] of Object.entries(artifacts.assetSet.assets)) {
      if (descriptor.mediaType !== "image/png") continue;
      urls.set(
        id,
        URL.createObjectURL(
          new Blob([assetBytes.get(id)!.slice().buffer as ArrayBuffer], { type: "image/png" }),
        ),
      );
    }
    const scene = createPreviewScene(artifacts, urls);
    let disposed = false;
    return {
      artifacts,
      scene,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const url of urls.values()) URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    throw error;
  }
}

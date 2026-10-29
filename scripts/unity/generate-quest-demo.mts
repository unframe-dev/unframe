import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
} from "../../packages/unframe-core/src/index.js";
import { runPresentationCli } from "../../packages/unframe-cli/src/index.js";
import { readBuildGeneration } from "../../packages/unframe-cli/src/filesystem/read-build-generation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, "app/unity/Assets/Resources/QuestDemoPresentation");
const temporary = await realpath(await mkdtemp(join(tmpdir(), "unframe-quest-demo-")));
const hash = (bytes: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const compactPng = (source: Uint8Array) => {
  const bytes = Buffer.from(source);
  const chunks = [];
  const imageData = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const chunk = bytes.subarray(offset, offset + length + 12);
    if (chunk.subarray(4, 8).toString() === "IDAT") imageData.push(chunk.subarray(8, 8 + length));
    else chunks.push(chunk);
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(imageData));
  const compressed = deflateSync(pixels, { level: 9 });
  if (!inflateSync(compressed).equals(pixels)) throw new Error("PNG optimization changed pixels.");
  const imageChunk = Buffer.alloc(compressed.length + 12);
  imageChunk.writeUInt32BE(compressed.length);
  imageChunk.write("IDAT", 4);
  imageChunk.set(compressed, 8);
  imageChunk.writeUInt32BE(crc32(imageChunk.subarray(4, -4)), imageChunk.length - 4);
  return Buffer.concat([bytes.subarray(0, 8), ...chunks.slice(0, -1), imageChunk, chunks.at(-1)!]);
};
const meta = async (path: string, folder = false) => {
  try {
    await readFile(`${path}.meta`);
  } catch {
    const guid = createHash("sha256").update(path.slice(root.length)).digest("hex").slice(0, 32);
    await writeFile(
      `${path}.meta`,
      `fileFormatVersion: 2\nguid: ${guid}\n${folder ? "folderAsset: yes\n" : ""}`,
    );
  }
};

try {
  const project = join(temporary, "presentation");
  await cp(join(root, "examples/presentation"), project, {
    recursive: true,
    filter: (path) => !["dist", ".unframe"].includes(path.split("/").at(-1)!),
  });
  await cp(join(root, "scripts/unity/quest-demo-source"), project, { recursive: true });
  const locked = await runPresentationCli({ args: ["lock", "refresh", project] });
  if (locked.exitCode !== 0) throw new Error(locked.stderr || locked.stdout);
  const built = await runPresentationCli({ args: ["build", project] });
  if (built.exitCode !== 0) throw new Error(built.stderr || built.stdout);
  const fixed = await readBuildGeneration(project, { channel: "dist" });
  const generated = structuredClone(fixed.artifacts);
  const generatedAssets = [];
  for (const [assetId, descriptor] of Object.entries(fixed.artifacts.assetSet.assets)) {
    const original = await fixed.readAsset(assetId);
    const bytes = original.mediaType === "image/png" ? compactPng(original.bytes) : original.bytes;
    const checksum = hash(bytes);
    const nextId = assetId.startsWith("sha256:") ? checksum : assetId;
    const updateReferences = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (object.assetId === assetId) {
        object.assetId = nextId;
        object.checksum = checksum;
        object.encodedSizeBytes = bytes.length;
      }
      for (const child of Object.values(object)) updateReferences(child);
    };
    updateReferences(generated.renderBundle);
    delete generated.assetSet.assets[assetId];
    generated.assetSet.assets[nextId] = { ...descriptor, checksum, encodedSizeBytes: bytes.length };
    generatedAssets.push({ assetId: nextId, bytes, mediaType: original.mediaType, checksum });
  }
  generated.buildManifest.renderBundleHash = hashCanonicalJsonPayload(generated.renderBundle);
  generated.buildManifest.assetSetHash = hashCanonicalJsonPayload(generated.assetSet);
  generated.buildManifest.buildId = `quest-demo-build-${hashCanonicalJsonPayload({ renderBundleHash: generated.buildManifest.renderBundleHash, assetSetHash: generated.buildManifest.assetSetHash }).slice(7)}`;
  const verified = verifyBuildIntegrity(generated);
  if (!verified.valid) throw new Error(JSON.stringify(verified.diagnostics));
  await mkdir(output, { recursive: true });
  await meta(output, true);
  for (const file of await readdir(output))
    if (/^asset-[0-9]+\.bytes(?:\.meta)?$/.test(file)) await rm(join(output, file));
  const artifacts = {
    definition: canonicalizeJsonPayload(generated.definition),
    "render-bundle": canonicalizeJsonPayload(generated.renderBundle),
    "asset-set": canonicalizeJsonPayload(generated.assetSet),
    "build-manifest": canonicalizeJsonPayload(generated.buildManifest),
  };
  for (const [name, json] of Object.entries(artifacts)) {
    const path = join(output, `${name}.json`);
    await writeFile(path, json);
    await meta(path);
  }
  const assets = [];
  for (const [index, { assetId, bytes, mediaType, checksum }] of generatedAssets.entries()) {
    const name = `asset-${index.toString().padStart(3, "0")}`;
    const path = join(output, `${name}.bytes`);
    await writeFile(path, bytes);
    await meta(path);
    assets.push({
      assetId,
      mediaType,
      resourcePath: `QuestDemoPresentation/${name}`,
      checksum,
      encodedSizeBytes: bytes.byteLength,
    });
  }
  const manifest = {
    schemaVersion: 1,
    presentationId: generated.buildManifest.presentationId,
    buildId: generated.buildManifest.buildId,
    title: generated.definition.metadata.title,
    definitionHash: hash(artifacts.definition),
    renderBundleHash: hash(artifacts["render-bundle"]),
    assetSetHash: hash(artifacts["asset-set"]),
    buildManifestHash: hash(artifacts["build-manifest"]),
    assets,
  };
  await writeFile(join(output, "manifest.json"), canonicalizeJsonPayload(manifest));
  await meta(join(output, "manifest.json"));
  await cp(join(root, "examples/presentation/FONT-LICENSE.txt"), join(output, "FONT-LICENSE.txt"));
  await meta(join(output, "FONT-LICENSE.txt"));
  console.log(
    `Generated Quest demo (${assets.length} assets) from scripts/unity/quest-demo-source.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const names = ["workspace", "workspace-node", "author-service", "build", "preview", "publish"];

test("packed Workspace and use cases execute and resolve declarations without repository source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-packed-usecases-"));
  try {
    const copied = new Set();
    const copyExternal = async (name, resolver) => {
      if (copied.has(name)) return;
      let manifest;
      for (const directory of resolver.resolve.paths(name) ?? []) {
        manifest = await realpath(join(directory, name, "package.json")).catch(() => undefined);
        if (manifest) break;
      }
      assert.ok(manifest, `Missing declared external dependency: ${name}`);
      const pkg = JSON.parse(await readFile(manifest, "utf8"));
      const target = join(directory, "node_modules", name);
      await mkdir(dirname(target), { recursive: true });
      await cp(dirname(manifest), target, { recursive: true });
      copied.add(name);
      const next = createRequire(manifest);
      for (const dependency of Object.keys(pkg.dependencies ?? {}))
        await copyExternal(dependency, next);
    };
    for (const name of names) {
      const source = join(root, "packages/unframe", name);
      const manifest = join(source, "package.json");
      const pkg = JSON.parse(await readFile(manifest, "utf8"));
      assert.ok(pkg.publishConfig?.exports, `${name}: distribution exports are required`);
      const target = join(directory, "node_modules/@unframe", name);
      await mkdir(target, { recursive: true });
      await cp(join(source, "dist"), join(target, "dist"), { recursive: true });
      await writeFile(
        join(target, "package.json"),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          type: "module",
          exports: pkg.publishConfig.exports,
        }),
      );
      const resolver = createRequire(manifest);
      for (const dependency of Object.keys(pkg.dependencies ?? {}))
        if (!dependency.startsWith("@unframe/")) await copyExternal(dependency, resolver);
    }
    const resolver = createRequire(join(root, "packages/unframe/author-service/package.json"));
    await copyExternal("@types/node", resolver);
    for (const name of [
      "presentation-definition",
      "render-bundle",
      "asset-set-manifest",
      "build-manifest",
    ]) {
      await cp(
        join(root, "packages/contracts/presentation/fixtures", `${name}.json`),
        join(directory, `${name}.json`),
      );
    }
    await writeFile(
      join(directory, "consumer.mjs"),
      `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canonicalize from "canonicalize";
import { createWorkspaceSnapshot, createWorkspaceSave } from "@unframe/workspace";
import { NativeStats, acquireBuildLock } from "@unframe/workspace-node";
import { createBuildJob } from "@unframe/build";
import { createAuthorService } from "@unframe/author-service";
import { createLocalPreviewService, PreviewError } from "@unframe/preview";
import { readPublicationFence, queryPublication } from "@unframe/publish";
const bytes = new TextEncoder().encode("fixed source");
const snapshot = createWorkspaceSnapshot([{path: "entry.ts", bytes}]);
bytes[0] = 0;
assert.equal(new TextDecoder().decode(snapshot.files[0].bytes), "fixed source");
const copy = snapshot.files;
copy[0].bytes[0] = 0;
assert.equal(new TextDecoder().decode(snapshot.files[0].bytes), "fixed source");
assert.match(snapshot.revision, /^sha256:[a-f0-9]{64}$/);
assert.equal(createWorkspaceSnapshot(snapshot.files).revision, snapshot.revision);
const source = new Uint8Array([1]);
const save = createWorkspaceSave({root: "/virtual", sourcePath: "entry.ts", beforeSource: source, afterSource: source, beforeLock: source, afterLock: source, requestHash: "request", saved: {revision: "r2", sourceHash: "s", irHash: "ir", commandId: "id"}});
source[0] = 2;
assert.equal(save.afterSource[0], 1);
const stats = new NativeStats({uid: 1, mode: 420, dev: 1, ino: 1, size: 0, mtimeMs: 0, kind: "file"});
assert.equal(stats.isFile(), true);
const lease = await acquireBuildLock(process.cwd());
assert.equal(lease.ok, true);
assert.equal((await acquireBuildLock(process.cwd())).ok, false);
await lease.value.release();
const job = createBuildJob({revision: snapshot.revision, expectedGeneration: "old"}, {prepare: async () => "artifact", commit: async () => ({status: "committed", generation: "new"})});
assert.deepEqual(await job.result, {status: "succeeded", value: "artifact", generation: "new"});
assert.equal(job.state().status, "succeeded");
const stale = createBuildJob({revision: "r", expectedGeneration: "old"}, {prepare: async () => "artifact", commit: async () => ({status: "conflict"})});
assert.deepEqual(await stale.result, {status: "stale"});
const project = {revision: "r", sourceHash: "s", irHash: null, definition: null, instances: [], diagnostics: []};
const unused = async () => { throw new Error("Unused port"); };
const author = await createAuthorService({initialize: async () => {}, withSource: async fn => fn(), project: async () => project, patch: unused, prepareBuild: unused, run: unused, readPublishedArtifacts: unused});
assert.deepEqual(await author.project(), project);
await author.close();
await assert.rejects(async () => author.project(), error => error.code === "author-service-closed");
const read = name => JSON.parse(readFileSync(new URL(name + ".json", import.meta.url), "utf8"));
const artifacts = {definition: read("presentation-definition"), renderBundle: read("render-bundle"), assetSet: read("asset-set-manifest"), buildManifest: read("build-manifest")};
for (const id of ["model", "node-native", "node-video"]) delete artifacts.definition.scene.nodes[id];
for (const id of ["native", "video"]) { delete artifacts.definition.scene.surfaces[id]; delete artifacts.renderBundle.surfaces[id]; }
artifacts.renderBundle.models = {};
for (const id of ["model-asset", "video-asset"]) delete artifacts.assetSet.assets[id];
artifacts.definition.flow.groups.intro.steps.start.cues = [];
const assets = {texture: {bytes: new Uint8Array(64).fill(42), mediaType: "image/png"}, image: {bytes: new Uint8Array(64).fill(43), mediaType: "image/png"}, font: {bytes: new Uint8Array(64).fill(44), mediaType: "font/ttf"}};
const hashBytes = value => "sha256:" + createHash("sha256").update(value).digest("hex");
const hash = value => hashBytes(canonicalize(value));
for (const [id, value] of Object.entries(assets)) artifacts.assetSet.assets[id].checksum = hashBytes(value.bytes);
for (const render of Object.values(artifacts.renderBundle.surfaces.baked.renderSurfaces)) for (const artifact of Object.values(render.artifacts)) if (artifact.kind === "baked-web") for (const state of Object.values(artifact.states)) state.texture.checksum = hashBytes(assets.texture.bytes);
artifacts.renderBundle.definitionHash = hash(artifacts.definition);
Object.assign(artifacts.buildManifest, {buildId: "packed-preview", sourceDraftRevision: 0, definitionHash: hash(artifacts.definition), renderBundleHash: hash(artifacts.renderBundle), assetSetHash: hash(artifacts.assetSet)});
const display = createLocalPreviewService("/virtual", {readGeneration: async () => ({generationId: "1".repeat(32), artifacts, readAsset: async id => assets[id]})});
const requestId = "a".repeat(32);
const envelope = await display.load({requestId, channel: "dist"});
assert.equal(envelope.requestId, requestId);
display.committed({requestId, buildIdentity: "packed-preview"});
assert.equal(display.playback({requestId, command: "poll"}).state.requestId, requestId);
display.close();
let reads = 0;
const preview = createLocalPreviewService("/virtual", {readGeneration: async () => { reads++; throw new Error("read-generation-failed"); }});
await assert.rejects(preview.load({requestId: "a".repeat(32), channel: "dist"}), /read-generation-failed/);
assert.equal(reads, 1);
preview.close();
await assert.rejects(preview.load({requestId: "b".repeat(32), channel: "dist"}), PreviewError);
assert.equal(reads, 1);
const remote = {controlPlaneUrl: "https://api.example.invalid", bearerToken: "test", fetch: async () => new Response(null, {status: 404})};
assert.equal(await readPublicationFence({...remote, presentationId: "p"}), null);
const operation = {presentationId: "p", buildId: "b", publicationEpoch: 1, definitionHash: "d", renderBundleHash: "r", assetSetHash: "a"};
assert.deepEqual(await queryPublication({...remote, operation}), {ok: false, code: "cli-publish-outcome-unknown", outcome: "outcome-unknown", operation});
`,
    );
    await execute(process.execPath, [join(directory, "consumer.mjs")], {
      cwd: directory,
      maxBuffer: 1024 * 1024,
    });
    await writeFile(
      join(directory, "consumer.mts"),
      `
import { createWorkspaceSnapshot, type WorkspaceSnapshot } from "@unframe/workspace";
import { NativeStats, type BuildLock } from "@unframe/workspace-node";
import { createBuildJob, type BuildState } from "@unframe/build";
import { createAuthorService, type AuthorServicePorts } from "@unframe/author-service";
import { createLocalPreviewService, type PreviewGenerationReader } from "@unframe/preview";
import { queryPublication, type PublicationOperation } from "@unframe/publish";
const snapshot: WorkspaceSnapshot = createWorkspaceSnapshot([{path: "entry.ts", bytes: new Uint8Array()}]);
const build = createBuildJob({revision: snapshot.revision, expectedGeneration: null}, {prepare: async () => 1, commit: async () => ({status: "committed", generation: "new"})});
const state: BuildState = build.state();
declare const ports: AuthorServicePorts;
declare const readGeneration: PreviewGenerationReader;
declare const operation: PublicationOperation;
declare const lock: BuildLock;
void [createAuthorService(ports), createLocalPreviewService("/virtual", {readGeneration}), NativeStats, state, lock, queryPublication({controlPlaneUrl: "https://api.example.invalid", bearerToken: "test", operation})];
// @ts-expect-error Build identity requires an expected generation fence
createBuildJob({revision: "r"}, {prepare: async () => 1, commit: async () => ({status: "conflict"})});
`,
    );
    const checks = createRequire(import.meta.url);
    await execute(
      process.execPath,
      [
        checks.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--noUncheckedSideEffectImports",
        "--skipLibCheck",
        "false",
        "--module",
        "nodenext",
        "--target",
        "es2024",
        "--types",
        "node",
        "--lib",
        "es2024,esnext.disposable,dom",
        "consumer.mts",
      ],
      {
        cwd: directory,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" },
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

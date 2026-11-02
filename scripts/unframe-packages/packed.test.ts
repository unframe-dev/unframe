import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { buildDeliveryFixtureArtifacts } from "@unframe/contract-fixtures/delivery-project";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const names = ["presentation", "artifacts", "playback", "delivery"];

test("packed domain APIs and declarations work with only their declared external dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-packed-domain-"));
  try {
    for (const name of names) {
      const source = resolve(root, "packages/unframe", name);
      const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
      const target = join(directory, "node_modules/@unframe", name);
      await mkdir(target, { recursive: true });
      await cp(join(source, "dist"), join(target, "dist"), { recursive: true });
      assert.ok(pkg.publishConfig?.exports, `${name}: missing distribution exports`);
      await writeFile(
        join(target, "package.json"),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          type: "module",
          exports: pkg.publishConfig.exports,
          dependencies: { zod: pkg.dependencies.zod },
        }),
      );
    }
    const requirePresentation = createRequire(
      resolve(root, "packages/unframe/presentation/package.json"),
    );
    const zodRoot = dirname(await realpath(requirePresentation.resolve("zod/package.json")));
    await cp(zodRoot, join(directory, "node_modules/zod"), { recursive: true });
    const compiled = await buildDeliveryFixtureArtifacts();
    await writeFile(
      join(directory, "build-input.json"),
      JSON.stringify({
        definition: compiled.definition,
        renderBundle: compiled.renderBundle,
        assetSet: compiled.assetSet,
        buildManifest: compiled.buildManifest,
      }),
    );
    await cp(
      resolve(root, "packages/contracts/presentation/fixtures/capability-profile.json"),
      join(directory, "capability-profile.json"),
    );
    await writeFile(
      join(directory, "consumer.mjs"),
      `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePresentationDefinition } from "@unframe/presentation";
import { parseRenderBundleInput } from "@unframe/presentation/validation";
import { verifyBuildIntegrity, hashCanonicalJsonPayload, parseStrictJson } from "@unframe/artifacts";
import { snapshotPlainJson } from "@unframe/artifacts/plain-json";
import { createInitialRuntimeState } from "@unframe/playback";
import { buildDeliveryManifest, buildProjectionProfile, selectBuildArtifacts } from "@unframe/delivery";
const read = name => JSON.parse(readFileSync(new URL(name + ".json", import.meta.url), "utf8"));
const source = read("build-input");
const definition = validatePresentationDefinition(source.definition, {fullDelivery: true});
assert.equal(definition.valid, true, JSON.stringify(definition.diagnostics));
assert.equal(validatePresentationDefinition({...source.definition, schemaVersion: 2}).valid, false);
assert.equal(parseRenderBundleInput(source.renderBundle).success, true);
const integrity = verifyBuildIntegrity(source);
assert.equal(integrity.valid, true, JSON.stringify(integrity));
assert.match(hashCanonicalJsonPayload({value: 1}), /^sha256:[a-f0-9]{64}$/);
assert.deepEqual(parseStrictJson(new TextEncoder().encode('{"value":1}')), {
  ok: true,
  value: Object.assign(Object.create(null), {value: 1}),
});
assert.deepEqual(parseStrictJson(new TextEncoder().encode('{"value":1,"value":2}')), {
  ok: false,
  code: "cli-lock-json-duplicate-key",
});
assert.deepEqual(snapshotPlainJson({value: 1}), {
  valid: true,
  value: Object.assign(Object.create(null), {value: 1}),
});
const initial = createInitialRuntimeState(source.definition);
assert.ok(initial.nodeStates.length > 0);
assert.ok(initial.surfaceStates.length > 0);
const capability = read("capability-profile");
const selection = selectBuildArtifacts({...source, capability}, "presenter");
assert.ok(selection.renderSurfaces.length >= 2);
assert.ok(selection.assets.length > 0);
const publicationPayload = {...source.buildManifest, publicationEpoch: 1};
const publication = {
  ...source,
  capability,
  publishedPresentation: {
    ...publicationPayload,
    publicationManifestHash: hashCanonicalJsonPayload(publicationPayload),
  },
};
const {profile} = buildProjectionProfile(publication, "presenter");
assert.match(profile.projectionProfileId, /^pp_[a-f0-9]{64}$/);
const manifest = buildDeliveryManifest({
  ...publication,
  role: "presenter",
  sessionId: "packed-session",
  participantId: "packed-participant",
  assignmentEpoch: 1,
  issuedAtUnixMilliseconds: 1_000,
  assetAccess: Object.fromEntries(selection.assets.map(({assetId}) => [assetId, {
    url: "https://assets.example.invalid/" + encodeURIComponent(assetId),
    expiresAtUnixMilliseconds: 2_000,
  }])),
});
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.assetAccess.length, selection.assets.length);
assert.equal(manifest.projectionProfile.projectionProfileId, profile.projectionProfileId);
`,
    );
    await execute(process.execPath, [join(directory, "consumer.mjs")], { cwd: directory });
    await writeFile(
      join(directory, "consumer.mts"),
      `
import { validatePresentationDefinition, type PresentationDefinition } from "@unframe/presentation";
import { parseRenderBundleInput } from "@unframe/presentation/validation";
import { verifyBuildIntegrity, parseStrictJson, type BuildArtifacts } from "@unframe/artifacts";
import { snapshotPlainJson } from "@unframe/artifacts/plain-json";
import { createInitialRuntimeState, type InitialRuntimeState } from "@unframe/playback";
import {
  buildDeliveryManifest, buildProjectionProfile, buildRuntimeProjection,
  selectBuildArtifacts, type BuildSourceInput, type DeliverySourceInput,
  type DeliveryManifestBuildInput, type ProjectionProfileResult, type RuntimeProjectionResult,
} from "@unframe/delivery";
declare const definition: PresentationDefinition;
declare const artifacts: BuildArtifacts;
declare const input: BuildSourceInput;
declare const publication: DeliverySourceInput;
declare const deliveryInput: DeliveryManifestBuildInput;
validatePresentationDefinition(definition);
verifyBuildIntegrity(artifacts);
parseRenderBundleInput(artifacts.renderBundle);
parseStrictJson(new Uint8Array());
snapshotPlainJson({value: 1});
const initial: InitialRuntimeState = createInitialRuntimeState(definition);
selectBuildArtifacts(input, "presenter");
const profile: ProjectionProfileResult = buildProjectionProfile(publication, "presenter");
const projection: RuntimeProjectionResult = buildRuntimeProjection(input, "presenter");
const manifest = buildDeliveryManifest(deliveryInput);
const epoch: string | undefined = manifest.projectionInstance?.assignmentEpoch;
// @ts-expect-error the role must be presenter or viewer
selectBuildArtifacts(input, "audience");
// @ts-expect-error runtime initialization requires a complete Presentation Definition
createInitialRuntimeState({schemaVersion: 1});
void initial;
void profile;
void projection;
void epoch;
`,
    );
    const requireChecks = createRequire(import.meta.url);
    await execute(
      process.execPath,
      [
        requireChecks.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "--skipLibCheck",
        "false",
        join(directory, "consumer.mts"),
      ],
      { cwd: directory, maxBuffer: 1024 * 1024 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import * as z from "zod";

import {
  assetSetManifestSchema,
  buildManifestSchema,
  capabilityProfileSchema,
  canonicalRuntimeSnapshotSchema,
  participantRuntimeViewSchema,
  m3dCueParticipantRuntimeViewSchema,
  m3dCueRuntimeSnapshotSchema,
  presentationDefinitionSchema,
  publishedPresentationSchema,
  renderBundleSchema,
  runtimeVisibilitySelectionSchema,
} from "../src/presentation/index";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const schemas: ReadonlyArray<readonly [string, z.ZodType]> = [
  ["presentation-definition", presentationDefinitionSchema],
  ["render-bundle", renderBundleSchema],
  ["asset-set-manifest", assetSetManifestSchema],
  ["build-manifest", buildManifestSchema],
  ["published-presentation", publishedPresentationSchema],
  ["capability-profile", capabilityProfileSchema],
  ["m3d-cue-runtime-snapshot", m3dCueRuntimeSnapshotSchema],
  ["runtime-visibility-selection", runtimeVisibilitySelectionSchema],
  ["m3d-cue-participant-runtime-view", m3dCueParticipantRuntimeViewSchema],
  ["canonical-runtime-snapshot", canonicalRuntimeSnapshotSchema],
  ["participant-runtime-view", participantRuntimeViewSchema],
];

async function output(relative: string, bytes: string | Uint8Array): Promise<void> {
  const path = resolve(root, relative);
  const expected = Buffer.from(bytes);
  if (check) {
    let actual: Buffer | undefined;
    try {
      actual = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      !actual ||
      actual.length !== expected.length ||
      !actual.every((byte, index) => byte === expected[index])
    ) {
      process.stderr.write(`Contract artifact is stale: ${relative}\n`);
      process.exitCode = 1;
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, expected);
  }
}

for (const [name, schema] of schemas) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
    override: ({ jsonSchema: node }) => {
      if (!Array.isArray(node.prefixItems)) return;
      node.items = false;
      node.minItems = node.prefixItems.length;
      node.maxItems = node.prefixItems.length;
    },
  });
  await output(
    `presentation/${name}.schema.json`,
    execFileSync(
      "pnpm",
      ["exec", "vp", "fmt", `--stdin-filepath=presentation/${name}.schema.json`],
      {
        cwd: root,
        input: `${JSON.stringify(
          {
            ...jsonSchema,
            $id: `https://contracts.unframe.dev/presentation/${name}.schema.json`,
          },
          null,
          2,
        )}\n`,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  );
}

const temporary = await mkdtemp(resolve(tmpdir(), "unframe-contract-"));
try {
  execFileSync(
    "protoc",
    [
      `--proto_path=${resolve(root, "proto")}`,
      "--include_imports",
      `--descriptor_set_out=${resolve(temporary, "contract.pb")}`,
      "unframe/presentation/runtime.proto",
      "unframe/delivery/delivery.proto",
      "unframe/realtime/realtime.proto",
    ],
    { cwd: resolve(root, "proto"), maxBuffer: 16 * 1024 * 1024 },
  );
  await output("presentation/contract.pb", await readFile(resolve(temporary, "contract.pb")));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

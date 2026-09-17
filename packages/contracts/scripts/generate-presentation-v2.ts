import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import * as z from "zod";

import {
  assetSetManifestV2Schema,
  buildManifestV2Schema,
  capabilityProfileV2Schema,
  presentationDefinitionV2Schema,
  publishedPresentationV2Schema,
  renderBundleV2Schema,
} from "../src/presentation/v2/index";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const schemas: ReadonlyArray<readonly [string, z.ZodType]> = [
  ["presentation-definition", presentationDefinitionV2Schema],
  ["render-bundle", renderBundleV2Schema],
  ["asset-set-manifest", assetSetManifestV2Schema],
  ["build-manifest", buildManifestV2Schema],
  ["published-presentation", publishedPresentationV2Schema],
  ["capability-profile", capabilityProfileV2Schema],
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
    `presentation/v2/${name}.schema.json`,
    execFileSync(
      "pnpm",
      ["exec", "vp", "fmt", `--stdin-filepath=presentation/v2/${name}.schema.json`],
      {
        cwd: root,
        input: `${JSON.stringify(
          {
            ...jsonSchema,
            $id: `https://contracts.unframe.dev/presentation/${name}.v2.schema.json`,
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

const temporary = await mkdtemp(resolve(tmpdir(), "unframe-contract-v2-"));
try {
  execFileSync(
    "protoc",
    [
      `--proto_path=${resolve(root, "proto")}`,
      "--include_imports",
      `--descriptor_set_out=${resolve(temporary, "contract.pb")}`,
      "unframe/presentation/v2/runtime.proto",
      "unframe/delivery/v2/delivery.proto",
      "unframe/realtime/v2/realtime.proto",
    ],
    { cwd: resolve(root, "proto"), maxBuffer: 16 * 1024 * 1024 },
  );
  await output("presentation/v2/contract.pb", await readFile(resolve(temporary, "contract.pb")));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

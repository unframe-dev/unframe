import { readFile } from "node:fs/promises";
import { hashCanonicalJsonPayload } from "../../packages/unframe/artifacts/src/index.ts";
const root = "example/dist/";
const read = async (name: string) => JSON.parse(await readFile(root + name, "utf8"));
const manifest = await read("build-manifest.json");
const checks = await Promise.all(
  [
    ["definition", "definitionHash"],
    ["render-bundle", "renderBundleHash"],
    ["asset-set", "assetSetHash"],
  ].map(async ([file, key]) => ({
    file,
    expected: manifest[key],
    actual: hashCanonicalJsonPayload(await read(file + ".json")),
  })),
);
console.log(
  JSON.stringify(
    { buildId: manifest.buildId, checks, ok: checks.every((c) => c.expected === c.actual) },
    null,
    2,
  ),
);
if (checks.some((c) => c.expected !== c.actual)) process.exitCode = 1;

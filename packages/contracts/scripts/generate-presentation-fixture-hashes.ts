import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import canonicalize from "canonicalize";
import {
  assetSetManifestSchema,
  buildManifestSchema,
  presentationDefinitionSchema,
  publishedPresentationSchema,
  renderBundleSchema,
} from "../src/presentation/index";
import { formatGenerated } from "./format-generated";

const root = resolve(import.meta.dirname, "../presentation/fixtures");
const check = process.argv.includes("--check");
const read = async (name: string) =>
  JSON.parse(await readFile(resolve(root, `${name}.json`), "utf8"));
const hash = (value: unknown) => {
  const json = canonicalize(value);
  if (json === undefined) throw new TypeError("Fixture must be canonical JSON");
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
};
const output = async (name: string, value: unknown) => {
  const path = resolve(root, `${name}.json`);
  const text = formatGenerated(path, `${JSON.stringify(value, null, 2)}\n`);
  if (check) {
    if ((await readFile(path, "utf8")) !== text) {
      process.stderr.write(`Presentation fixture hashes are stale: ${name}\n`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(path, text);
  }
};

const definition = presentationDefinitionSchema.parse(await read("presentation-definition"));
const bundle = renderBundleSchema.parse(await read("render-bundle"));
const assets = assetSetManifestSchema.parse(await read("asset-set-manifest"));
const build = buildManifestSchema.parse(await read("build-manifest"));
const publication = publishedPresentationSchema.parse(await read("published-presentation"));

bundle.definitionHash = hash(definition);
Object.assign(build, {
  definitionHash: hash(definition),
  renderBundleHash: hash(bundle),
  assetSetHash: hash(assets),
});
const payload = { ...build, publicationEpoch: publication.publicationEpoch };
await output("render-bundle", bundle);
await output("build-manifest", build);
await output("published-presentation", {
  ...payload,
  publicationManifestHash: hash(payload),
});

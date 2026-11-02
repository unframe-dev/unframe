import { readFile, writeFile } from "node:fs/promises";
import { parseAllDocuments } from "yaml";

const root = new URL("../../../../pnpm-lock.yaml", import.meta.url);
const lock = parseAllDocuments(await readFile(root, "utf8"))
  .at(-1)
  .toJS();
const original = lock.importers["packages/unframe/styles-node"];
if (!original) throw new Error("styles-node lock importer is missing");
const names = [
  "error-stack-parser",
  "jiti",
  "path-is-inside",
  "postcss-load-config",
  "semver",
  "zod",
];
const dependencies = Object.fromEntries(
  names.map((name) => {
    if (!original.dependencies[name]) throw new Error(`Missing locked dependency: ${name}`);
    return [name, original.dependencies[name]];
  }),
);
const snapshots = {};
const packages = {};
const visit = (name, version) => {
  const candidate = `${name}@${version}`;
  const locator = Object.hasOwn(lock.snapshots, candidate) ? candidate : version;
  if (Object.hasOwn(snapshots, locator)) return;
  const snapshot = lock.snapshots[locator];
  const base = locator.split("(")[0];
  const record = lock.packages[base];
  if (!snapshot || !record) throw new Error(`Missing locked package: ${locator}`);
  snapshots[locator] = snapshot;
  packages[base] = record;
  for (const [child, childVersion] of Object.entries({
    ...snapshot.dependencies,
    ...snapshot.optionalDependencies,
  }))
    visit(child, childVersion);
};
for (const [name, value] of Object.entries(dependencies)) visit(name, value.version);
await writeFile(
  new URL("../dist/adapter-lock.json", import.meta.url),
  JSON.stringify({
    lockfileVersion: lock.lockfileVersion,
    importers: { ".": { dependencies } },
    packages,
    snapshots,
  }),
);

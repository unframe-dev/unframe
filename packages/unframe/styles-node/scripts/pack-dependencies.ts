import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyNodeTransformSnapshot } from "@unframe/workspace";
import { snapshotNodeTransformInputs } from "../src/node-snapshot.js";

const adapterRoot = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "unframe-style-pack-"));
try {
  await writeFile(join(directory, "package.json"), "{}");
  await writeFile(
    join(directory, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
  );
  const snapshot = await snapshotNodeTransformInputs(directory, {
    adapterRoot,
    adapterSubpath: "./compiler",
    adapterDependencies: [
      "error-stack-parser",
      "jiti",
      "path-is-inside",
      "postcss-load-config",
      "semver",
      "zod",
    ],
  });
  const { identity: _identity, sourceIdentity: _sourceIdentity, ...value } = snapshot;
  const graph = value.packages.map((pkg) => {
    if (!pkg.locator.startsWith("postcss-load-config@")) return pkg;
    const { tsx: _tsx, ...dependencies } = pkg.dependencies;
    return { ...pkg, dependencies };
  });
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const item = graph.find((pkg) => pkg.id === id);
    if (!item) throw new Error("Missing adapter dependency");
    for (const child of Object.values(item.dependencies)) visit(child);
  };
  if (!value.adapter) throw new Error("Missing adapter");
  visit(value.adapter.packageId);
  const compact = identifyNodeTransformSnapshot({
    ...value,
    packages: graph
      .filter((pkg) => reachable.has(pkg.id))
      .map((pkg) => (pkg.id === value.adapter?.packageId ? { ...pkg, files: [] } : pkg)),
  });
  await writeFile(
    join(adapterRoot, "dist/adapter-dependencies.json.gz"),
    gzipSync(Buffer.from(JSON.stringify(compact))),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { InstalledDependencyGraph } from "@unframe-dev/workspace";

/** Materializes a captured package graph as an isolated node_modules installation. */
export async function installFixtureGraph(directory: string, graph: InstalledDependencyGraph) {
  const locations = new Map<string, string>(
    graph.packages.map((pkg) => [
      pkg.key,
      join(directory, "node_modules", ".fixture", pkg.key.slice(7)),
    ]),
  );
  const link = async (from: string, specifier: string, key: string) => {
    const destination = join(from, "node_modules", specifier);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(locations.get(key)!, destination);
  };
  for (const pkg of graph.packages) {
    const root = locations.get(pkg.key)!;
    for (const file of pkg.files) {
      const destination = join(root, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(
        destination,
        file.encoding === "utf8" ? file.data : Buffer.from(file.data, "base64"),
      );
    }
    // Fixtures can contain source-only package snapshots without a manifest.
    const manifestPath = join(root, "package.json");
    const manifest = await readFile(manifestPath, "utf8").then(
      (text) => JSON.parse(text),
      () => ({}),
    );
    const names = pkg.dependencies.map((edge) =>
      edge.usage === "types"
        ? edge.specifier.startsWith("@")
          ? `@types/${edge.specifier.slice(1).replace("/", "__")}`
          : `@types/${edge.specifier}`
        : edge.specifier,
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        name: pkg.name,
        version: pkg.version,
        dependencies: Object.fromEntries(names.map((name) => [name, "*"])),
        devDependencies: {},
        optionalDependencies: {},
        peerDependencies: {},
        exports: Object.fromEntries(
          pkg.exports.map((row) => [
            row.subpath,
            {
              ...(row.types ? { types: `./${row.types}` } : {}),
              ...(row.runtimeImport ? { import: `./${row.runtimeImport}` } : {}),
              ...(row.runtimeRequire ? { require: `./${row.runtimeRequire}` } : {}),
            },
          ]),
        ),
      }),
    );
    for (const [index, edge] of pkg.dependencies.entries())
      await link(root, names[index]!, edge.packageKey);
  }
  const roots = graph.rootDependencies.map((edge) => ({
    ...edge,
    name:
      edge.usage === "types"
        ? edge.specifier.startsWith("@")
          ? `@types/${edge.specifier.slice(1).replace("/", "__")}`
          : `@types/${edge.specifier}`
        : edge.specifier,
  }));
  for (const edge of roots) await link(directory, edge.name, edge.packageKey);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "fixture-project",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(roots.map((edge) => [edge.name, "*"])),
    }),
  );
}
export async function readFixtureGraph(path: URL): Promise<InstalledDependencyGraph> {
  return JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
}

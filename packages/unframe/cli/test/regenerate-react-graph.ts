import { execFile } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseAllDocuments, stringify } from "yaml";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import {
  hashDependencyGraph,
  hashLockedPackageContent,
  loadUnframeLock,
  type UnframeLock,
} from "@unframe/workspace";
import { lockedFile, snapshotInstalledPackages } from "@unframe/workspace-node";
import { sdkFixtureSource } from "./authoring-sdk-fixture.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const testDirectory = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "unframe-react-graph-"));
try {
  const documents = parseAllDocuments(await readFile(join(root, "pnpm-lock.yaml"), "utf8"));
  const lock = documents.at(-1)?.toJS() as {
    catalogs?: unknown;
    packageExtensionsChecksum?: unknown;
    importers: Record<
      string,
      {
        dependencies: Record<string, { specifier: string; version: string }>;
        devDependencies: Record<string, { specifier: string; version: string }>;
      }
    >;
  };
  const web = lock.importers["app/web/console"]!;
  const dependencies = Object.fromEntries(
    ["@base-ui/react", "react", "react-dom"].map((name) => [name, web.dependencies[name]!]),
  );
  const devDependencies = Object.fromEntries(
    ["@types/react", "@types/react-dom"].map((name) => [name, web.devDependencies[name]!]),
  );
  lock.importers = { ".": { dependencies, devDependencies } };
  delete lock.catalogs;
  delete lock.packageExtensionsChecksum;
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "unframe-react-graph-fixture",
      version: "1.0.0",
      private: true,
      dependencies: Object.fromEntries(
        Object.entries(dependencies).map(([name, item]) => [name, item.specifier]),
      ),
      devDependencies: Object.fromEntries(
        Object.entries(devDependencies).map(([name, item]) => [name, item.specifier]),
      ),
    }),
  );
  await writeFile(join(temporary, "pnpm-lock.yaml"), stringify(lock));
  await promisify(execFile)(
    "pnpm",
    [
      "--config.verify-deps-before-run=false",
      "install",
      "--frozen-lockfile",
      "--offline",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--trust-lockfile",
    ],
    { cwd: temporary, timeout: 120_000 },
  );
  const graph = await snapshotInstalledPackages(temporary);
  const loaded = loadUnframeLock(
    gunzipSync(await readFile(join(testDirectory, "fixtures/pack-project.lock.gz"))),
  );
  if (!loaded.ok) throw new Error(loaded.diagnostic.message);
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const edges = new Map(
    [...loaded.value.lock.rootDependencies, ...graph.rootDependencies].map((edge) => [
      `${edge.specifier}\0${edge.usage}`,
      edge,
    ]),
  );
  const sdk = loaded.value.lock.packages.find((pkg) => pkg.name === "@unframe/authoring");
  if (!sdk) throw new Error("Authoring package is missing");
  const smallSdk = {
    ...sdk,
    files: [lockedFile("index.ts", new TextEncoder().encode(sdkFixtureSource))],
    exports: [{ subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" }],
    dependencies: [],
  };
  smallSdk.contentIntegrity = hashLockedPackageContent(smallSdk);
  const packages = new Map([smallSdk, ...graph.packages].map((pkg) => [pkg.key, pkg]));
  const next: UnframeLock = {
    ...loaded.value.lock,
    packageManagerLockHash: graph.packageManagerLockHash,
    rootDependencies: [...edges.values()].sort((a, b) =>
      compare(`${a.specifier}\0${a.usage}`, `${b.specifier}\0${b.usage}`),
    ),
    packages: [...packages.values()].sort((a, b) => compare(a.key, b.key)),
  };
  next.dependencyGraphHash = hashDependencyGraph(next);
  const bytes = Buffer.from(canonicalizeJsonPayload(next) + "\n");
  const validated = loadUnframeLock(bytes);
  if (!validated.ok) throw new Error(validated.diagnostic.message);
  await writeFile(
    join(testDirectory, "fixtures/react-graph.lock.gz"),
    gzipSync(bytes, { level: 9 }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

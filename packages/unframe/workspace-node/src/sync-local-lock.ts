import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  authoringPackageRoots,
  hasPostcssConfig,
  prepareLockRefresh,
  prepareLockUpdate,
  type StylePreparationPort,
} from "@unframe-dev/build";
import { loadUnframeLock, type UnframeLock } from "@unframe-dev/workspace";
import type { SourceAssetPorts } from "./source-assets.js";
import {
  digestBytes,
  PnpmProjectLockError,
  readPnpmProjectLock,
  snapshotInstalledPackages,
} from "./package-snapshot.js";
import { installProjectDependencies } from "./install-project-dependencies.js";
import { refreshLocalProjectLock } from "./refresh-local-lock.js";

type Found = Parameters<typeof prepareLockRefresh>[0]["found"];
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "pnpm",
  "packageManager",
] as const;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const configPattern =
  /^(?:postcss\.config\.(?:js|cjs|mjs|ts|cts|mts)|\.postcssrc(?:\.(?:json|yaml|yml|js|cjs|mjs|ts|cts|mts))?)$/;
const exists = (path: string) =>
  stat(path).then(
    (value) => value.isDirectory(),
    () => false,
  );
const dependencyIdentity = (lock: UnframeLock) =>
  digestBytes(
    Buffer.from(
      JSON.stringify({
        roots: lock.rootDependencies,
        packages: lock.packages.map(({ key, locator, contentIntegrity, dependencies }) => ({
          key,
          locator,
          contentIntegrity,
          dependencies,
        })),
        style: lock.styleTransform?.identity,
      }),
    ),
  );
const typeSpecifier = (name: string) =>
  name.startsWith("@types/")
    ? name.slice(7).includes("__")
      ? `@${name.slice(7).replace("__", "/")}`
      : name.slice(7)
    : name;

/** Session-scoped dependency synchronization; only successful lock commits are cached. */
export function createLocalProjectLockSynchronizer(
  ports: SourceAssetPorts & { styles: StylePreparationPort },
  directory: string,
  options: {
    prepareRefresh?: typeof prepareLockRefresh;
    prepareUpdate?: typeof prepareLockUpdate;
  } = {},
) {
  let committed: { fingerprint: string; dependencyHash: string } | undefined;
  let binary: { key: string; hash: string } | undefined;
  async function runtime() {
    const nodePath = await realpath(process.env.UNFRAME_STYLE_NODE ?? process.execPath);
    const stat = await lstat(nodePath);
    const key = JSON.stringify([nodePath, stat.size, stat.mtimeMs, stat.ctimeMs]);
    if (binary?.key !== key) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(nodePath)) hash.update(chunk);
      binary = { key, hash: hash.digest("hex") };
    }
    const closure = process.env.UNFRAME_STYLE_RUNTIME_CLOSURE
      ? (await readFile(process.env.UNFRAME_STYLE_RUNTIME_CLOSURE, "utf8"))
          .trim()
          .split(/\s+/)
          .sort()
      : [];
    return {
      nodePath,
      nodeHash: binary.hash,
      platform: process.platform,
      arch: process.arch,
      closure,
      environment:
        process.platform === "linux"
          ? {
              ...(process.env.NIX_LD ? { NIX_LD: await realpath(process.env.NIX_LD) } : {}),
              NIX_LD_LIBRARY_PATH: closure.map((path) => `${path}/lib`).join(":"),
            }
          : {},
    };
  }
  async function inputs(found: Found) {
    const manifestFile = found.localFiles.find((file) => file.path === "package.json");
    const postcss = hasPostcssConfig(found);
    if (!manifestFile && !postcss) return undefined;
    const manifest = manifestFile
      ? record(JSON.parse(new TextDecoder().decode(manifestFile.bytes)))
      : {};
    const pnpm = await readPnpmProjectLock(directory);
    const dependencies = Object.assign(
      {},
      ...["dependencies", "devDependencies", "optionalDependencies"].map((key) =>
        record(manifest[key]),
      ),
    );
    const roots = authoringPackageRoots(found).filter((name) => Object.hasOwn(dependencies, name));
    const runtimeIdentity = postcss ? await runtime() : undefined;
    const fingerprint = digestBytes(
      Buffer.from(
        JSON.stringify({
          pnpm: digestBytes(pnpm.bytes),
          workspace: pnpm.workspaceBytes ? digestBytes(pnpm.workspaceBytes) : undefined,
          manifest: Object.fromEntries(dependencyFields.map((key) => [key, manifest[key]])),
          roots,
          postcss: [
            manifest.postcss,
            ...found.localFiles
              .filter((file) => configPattern.test(file.path))
              .map((file) => [file.path, digestBytes(file.bytes)]),
          ],
          runtime: runtimeIdentity,
        }),
      ),
    );
    const importerMatches = ["dependencies", "devDependencies", "optionalDependencies"].every(
      (key) => {
        const declared = record(manifest[key]);
        const locked = record(pnpm.importer[key]);
        return (
          Object.keys(declared).length === Object.keys(locked).length &&
          Object.entries(declared).every(
            ([name, specifier]) => record(locked[name]).specifier === specifier,
          )
        );
      },
    );
    const required = Object.keys(
      Object.assign({}, record(manifest.dependencies), record(manifest.devDependencies)),
    );
    const installed = (
      await Promise.all(
        required.map(
          async (name) =>
            (await exists(join(directory, "node_modules", name))) ||
            (await exists(join(pnpm.directory, "node_modules", name))),
        ),
      )
    ).every(Boolean);
    return {
      fingerprint,
      pnpmHash: digestBytes(pnpm.bytes),
      postcss,
      runtimeIdentity,
      roots,
      importerMatches,
      installed,
    };
  }
  return async (
    request: Omit<NonNullable<Parameters<typeof refreshLocalProjectLock>[2]>, "prepare"> = {},
  ) => {
    let preparedCache: typeof committed;
    const result = await refreshLocalProjectLock(ports, directory, {
      ...request,
      prepare: async (input, refreshPorts) => {
        const loaded = loadUnframeLock(input.found.lockBytes);
        if (!loaded.ok)
          return { ok: false, code: loaded.diagnostic.code, message: loaded.diagnostic.message };
        let current: Awaited<ReturnType<typeof inputs>>;
        try {
          current = await inputs(input.found);
        } catch (error) {
          return {
            ok: false,
            code:
              error instanceof PnpmProjectLockError && error.code === "missing"
                ? "cli-lock-package-input-missing"
                : "cli-lock-dependency-input-invalid",
            message:
              error instanceof PnpmProjectLockError
                ? error.message
                : "Dependency inputs or the Node runtime could not be read.",
          };
        }
        const lock = loaded.value.lock;
        let update = false;
        if (current) {
          const styleRuntime = lock.styleTransform?.runtime;
          const runtimeMatches =
            !current.runtimeIdentity ||
            (styleRuntime &&
              Object.entries(current.runtimeIdentity).every(
                ([key, value]) =>
                  JSON.stringify(styleRuntime[key as keyof typeof styleRuntime]) ===
                  JSON.stringify(value),
              ));
          const coherent =
            lock.packageManagerLockHash === current.pnpmHash &&
            current.postcss === Boolean(lock.styleTransform) &&
            runtimeMatches &&
            current.importerMatches &&
            current.installed &&
            current.roots.every((name) =>
              lock.rootDependencies.some(
                (root) =>
                  root.specifier === typeSpecifier(name) &&
                  root.usage === (name.startsWith("@types/") ? "types" : "runtime"),
              ),
            );
          update =
            !coherent ||
            Boolean(
              committed &&
              (committed.fingerprint !== current.fingerprint ||
                committed.dependencyHash !== dependencyIdentity(lock)),
            );
        }
        const prepared = update
          ? await (options.prepareUpdate ?? prepareLockUpdate)(
              { ...input, operation: "update", preserveAssetPins: true },
              {
                ...refreshPorts,
                install: () => installProjectDependencies(directory, input.signal),
                snapshotInstalledPackages: (rootSpecifiers) =>
                  snapshotInstalledPackages(directory, rootSpecifiers ? { rootSpecifiers } : {}),
              },
            )
          : await (options.prepareRefresh ?? prepareLockRefresh)(input, refreshPorts);
        if (prepared.ok && current) {
          const next = loadUnframeLock(prepared.bytes);
          if (!next.ok)
            return { ok: false, code: next.diagnostic.code, message: next.diagnostic.message };
          preparedCache = {
            fingerprint: current.fingerprint,
            dependencyHash: dependencyIdentity(next.value.lock),
          };
        }
        return prepared;
      },
    });
    if (result.ok) committed = preparedCache;
    return result;
  };
}

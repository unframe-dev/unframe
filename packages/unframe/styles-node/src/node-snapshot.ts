import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import * as ts from "typescript";
import {
  identifyNodeTransformSnapshot as identify,
  validateNodeTransformSnapshot,
  workspacePackageFileRoots,
  isWorkspacePackageSnapshotPath,
  workspaceSourcePackageSpecifiers,
} from "@unframe-dev/workspace";
import { lstat, mkdir, readdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseAllDocuments } from "yaml";

import {
  pnpmLockSchema,
  pnpmLocatorSchema,
  packageManifestSchema,
  adapterManifestSchema,
  importerEntrySchema,
  adapterEntrySchema,
  supportsPlatform,
  type NodeSnapshotFile,
  type NodeTransformSnapshot,
} from "@unframe-dev/workspace";
import { probeNodeRuntime } from "./runtime.js";
export type { NodeSnapshotFile, NodeTransformSnapshot } from "@unframe-dev/workspace";
export const withNodeTransformSources = (
  snapshot: NodeTransformSnapshot,
  files: readonly NodeSnapshotFile[],
): NodeTransformSnapshot => {
  const { identity: _identity, sourceIdentity: _sourceIdentity, ...value } = snapshot;
  return identify({ ...value, sourceFiles: [...files] });
};
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const contained = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const collectFiles = async (root: string, workspace = false): Promise<NodeSnapshotFile[]> => {
  const files: NodeSnapshotFile[] = [];
  const roots = workspace
    ? workspacePackageFileRoots(JSON.parse(await readFile(join(root, "package.json"), "utf8")))
    : undefined;
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      if (["node_modules", ".git", ".unframe"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      const sourcePath = relative(root, path).split(sep).join("/");
      if (roots && !isWorkspacePackageSnapshotPath(sourcePath, roots)) continue;
      const actual = await realpath(path);
      if (!contained(root, actual))
        throw new Error(`Snapshot symlink escapes root: ${relative(root, path)}`);
      const stat = await lstat(path);
      if (stat.isSymbolicLink())
        throw new Error(`Snapshot source symlink is unsupported: ${relative(root, path)}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        files.push({
          path: relative(root, path).split(sep).join("/"),
          bytes: (await readFile(path)).toString("base64"),
          ...((stat.mode & 0o111) !== 0 ? { executable: true } : {}),
        });
      else throw new Error("Snapshot contains a special file");
    }
  };
  await walk(root);
  return files;
};
const collectEntryFiles = async (root: string, entry: string): Promise<NodeSnapshotFile[]> => {
  const files = new Map<string, NodeSnapshotFile>();
  const pending = [entry];
  while (pending.length) {
    const path = pending.pop()!;
    if (files.has(path)) continue;
    const full = join(root, path);
    const actual = await realpath(full);
    const metadata = await lstat(full);
    if (!contained(root, actual) || !metadata.isFile() || metadata.isSymbolicLink())
      throw new Error("Node adapter entry closure contains an unsafe file");
    const bytes = await readFile(full);
    files.set(path, {
      path,
      bytes: bytes.toString("base64"),
      ...((metadata.mode & 0o111) !== 0 ? { executable: true } : {}),
    });
    if (!/\.[cm]?[jt]sx?$/iu.test(path)) continue;
    for (const reference of ts.preProcessFile(bytes.toString("utf8"), true, true).importedFiles) {
      if (!reference.fileName.startsWith(".")) continue;
      const target = resolve(dirname(full), reference.fileName);
      if (!contained(root, target)) throw new Error("Node adapter import escapes package");
      let found: string | undefined;
      for (const candidate of [
        target,
        `${target}.js`,
        `${target}.mjs`,
        `${target}.cjs`,
        `${target}.ts`,
        `${target}.json`,
        join(target, "index.js"),
      ]) {
        const metadata = await lstat(candidate).catch((error) => {
          if (
            (error as NodeJS.ErrnoException).code === "ENOENT" ||
            (error as NodeJS.ErrnoException).code === "ENOTDIR"
          )
            return undefined;
          throw error;
        });
        if (metadata?.isFile()) {
          found = relative(root, candidate).split(sep).join("/");
          break;
        }
      }
      if (!found) throw new Error(`Node adapter relative import is missing: ${reference.fileName}`);
      pending.push(found);
    }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path, "en"));
};
const readLock = async (directory: string, workspace: boolean) => {
  const projectRoot = await realpath(directory);
  let root = projectRoot;
  for (;;) {
    try {
      if (root !== projectRoot) {
        const marker = await lstat(join(root, "pnpm-workspace.yaml"));
        if (!marker.isFile())
          throw new Error("Node project workspace marker must be a regular file");
      }
      const documents = parseAllDocuments(await readFile(join(root, "pnpm-lock.yaml"), "utf8"), {
        uniqueKeys: true,
      });
      const document = documents.at(-1);
      if (!document || documents.some((item) => item.errors.length))
        throw new Error("Invalid pnpm lock YAML");
      const lock = pnpmLockSchema.parse(document.toJS({ maxAliasCount: 100 }));
      const importer = lock.importers[relative(root, projectRoot).split(sep).join("/") || "."];
      if (!importer) throw new Error("Node adapter pnpm importer is missing");
      return { root, lock, importer };
    } catch (error) {
      if (!workspace || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(root);
    if (parent === root) throw new Error("Node adapter pnpm lock is missing");
    root = parent;
  }
};
const readAdapterLock = async (directory: string) => {
  const lock = pnpmLockSchema.parse(
    JSON.parse(await readFile(join(directory, "dist", "adapter-lock.json"), "utf8")),
  );
  const importer = lock.importers["."];
  if (!importer) throw new Error("Distributed Node adapter lock is missing its importer");
  let current = await realpath(directory);
  let installedRoot: string | undefined;
  for (;;) {
    if (current.endsWith(`${sep}node_modules`)) installedRoot = dirname(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const root = installedRoot ?? (await readLock(directory, true)).root;
  return { root, lock, importer };
};
export const snapshotNodeTransformInputs = async (
  projectRoot: string,
  options: {
    readonly sourceFiles?: readonly NodeSnapshotFile[];
    readonly adapterRoot?: string;
    readonly adapterSubpath?: string;
    readonly adapterDependencies?: readonly string[];
    readonly adapterDependencySnapshot?: string;
    readonly nodePath?: string;
    readonly rootSpecifiers?: readonly string[];
  } = {},
): Promise<NodeTransformSnapshot> => {
  const root = await realpath(projectRoot);
  const nodePath = await realpath(
    options.nodePath ?? process.env.UNFRAME_STYLE_NODE ?? process.execPath,
  );
  const runtimeData = probeNodeRuntime(nodePath);
  const packages: {
    id: string;
    locator: string;
    integrity: string;
    files: NodeSnapshotFile[];
    dependencies: Record<string, string>;
  }[] = [];
  const seen = new Map<string, string>();
  const visit = async (
    name: string,
    version: string,
    from: string,
    context: Awaited<ReturnType<typeof readLock>>,
    optional = false,
  ): Promise<string | undefined> => {
    const snapshots = context.lock.snapshots;
    let workspaceDirectory: string | undefined;
    let workspaceImporter: typeof context.importer | undefined;
    if (version.startsWith("link:")) {
      const target = version.slice(5);
      const fromImporter =
        context.lock.importers[relative(context.root, from).split(sep).join("/") || "."];
      if (!fromImporter || !target || target.includes("\\") || isAbsolute(target))
        throw new Error("Node workspace dependency must resolve from a locked importer");
      workspaceDirectory = resolve(from, target);
      if (workspaceDirectory === context.root || !contained(context.root, workspaceDirectory))
        throw new Error("Node workspace dependency escapes workspace");
      workspaceImporter =
        context.lock.importers[relative(context.root, workspaceDirectory).split(sep).join("/")];
      if (!workspaceImporter) throw new Error("Node workspace dependency importer is missing");
    }
    const locator = workspaceDirectory
      ? `${name}@workspace:${relative(context.root, workspaceDirectory).split(sep).join("/")}`
      : Object.hasOwn(snapshots, `${name}@${version}`)
        ? `${name}@${version}`
        : version;
    pnpmLocatorSchema.parse(locator);
    if (!workspaceDirectory && !Object.hasOwn(snapshots, locator))
      throw new Error("Node dependency must have a fixed pnpm snapshot locator");
    let current = from;
    let packageRoot: string | undefined;
    for (;;) {
      try {
        packageRoot = await realpath(join(current, "node_modules", name));
        break;
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
      }
      if (current === context.root) break;
      const parent = dirname(current);
      if (!contained(context.root, parent)) break;
      current = parent;
    }
    if (!packageRoot) {
      if (optional) return undefined;
      throw new Error(`Missing Node dependency: ${name}`);
    }
    if (
      workspaceDirectory
        ? packageRoot !== workspaceDirectory
        : !contained(join(context.root, "node_modules"), packageRoot)
    )
      throw new Error("Node dependency escapes installed graph");
    const manifest = packageManifestSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
    );
    const nameVersion = `${manifest.name}@${manifest.version}`;
    const baseLocator = locator.split("(")[0]!;
    const packageRecord = workspaceDirectory
      ? { resolution: { integrity: undefined }, version: manifest.version }
      : context.lock.packages[baseLocator];
    if (!packageRecord) throw new Error("Node package is missing from pnpm lock");
    if (
      workspaceDirectory
        ? manifest.name !== name
        : baseLocator !== nameVersion &&
          !(
            baseLocator.startsWith(`${manifest.name}@file:`) &&
            packageRecord.version === manifest.version
          )
    )
      throw new Error(`Installed package does not match pnpm locator: ${locator}`);
    const compatible = [manifest, packageRecord].every(
      (metadata) =>
        supportsPlatform(metadata.os, runtimeData.platform) &&
        supportsPlatform(metadata.cpu, runtimeData.arch) &&
        (runtimeData.platform !== "linux" ||
          supportsPlatform(metadata.libc, runtimeData.libc === "non-glibc" ? "musl" : "glibc")),
    );
    if (!compatible) {
      if (optional) return undefined;
      throw new Error(`Node dependency does not support the locked platform: ${locator}`);
    }
    const files = await collectFiles(packageRoot, workspaceDirectory !== undefined);
    const integrity = workspaceDirectory
      ? `workspace-content:${digest(JSON.stringify(files))}`
      : packageRecord.resolution.integrity;
    if (!integrity) throw new Error("Node package archive integrity is missing");
    const key = `${context.root}\0${locator}\0${packageRoot}`;
    const previous = seen.get(key);
    if (previous) return previous;
    const id = `p${packages.length}`;
    seen.set(key, id);
    const item = {
      id,
      locator,
      integrity,
      files,
      dependencies: Object.create(null) as Record<string, string>,
    };
    packages.push(item);
    const locked = workspaceImporter ?? snapshots[locator]!;
    const references = workspaceImporter
      ? workspaceSourcePackageSpecifiers(
          files.map((file) => ({
            path: file.path,
            source: Buffer.from(file.bytes, "base64").toString("utf8"),
          })),
        )
      : [];
    const requiredDevelopment = Object.fromEntries(
      Object.entries(workspaceImporter?.devDependencies ?? {}).filter(([name]) =>
        references.includes(name),
      ),
    );
    const edges = {
      ...requiredDevelopment,
      ...locked.dependencies,
      ...locked.optionalDependencies,
    };
    for (const dependency of Object.keys(edges).sort()) {
      const child = await visit(
        dependency,
        workspaceImporter
          ? (edges[dependency] as (typeof context.importer.dependencies)[string]).version
          : (edges[dependency] as string),
        packageRoot,
        context,
        Object.hasOwn(locked.optionalDependencies, dependency),
      );
      if (child) item.dependencies[dependency] = child;
    }
    return id;
  };
  const context = await readLock(root, true);
  const rootDependencies: Record<string, string> = Object.create(null) as Record<string, string>;
  const rootEdges = {
    ...context.importer.dependencies,
    ...context.importer.devDependencies,
    ...context.importer.optionalDependencies,
  };
  for (const name of Object.keys(rootEdges).sort()) {
    if (options.rootSpecifiers && !options.rootSpecifiers.includes(name)) continue;
    const id = await visit(
      name,
      rootEdges[name]!.version,
      root,
      context,
      Object.hasOwn(context.importer.optionalDependencies, name),
    );
    if (id) rootDependencies[name] = id;
  }
  let adapter: NodeTransformSnapshot["adapter"];
  if (options.adapterRoot) {
    const adapterRoot = await realpath(options.adapterRoot);
    const toolContext =
      options.adapterDependencySnapshot || options.adapterDependencies?.length === 0
        ? undefined
        : await readAdapterLock(adapterRoot);
    const adapterManifest = adapterManifestSchema.parse(
      JSON.parse(await readFile(join(adapterRoot, "package.json"), "utf8")),
    );
    const exported =
      typeof adapterManifest.exports === "string"
        ? adapterManifest.exports
        : adapterManifest.exports?.[options.adapterSubpath ?? "."];
    if (options.adapterSubpath && exported === undefined)
      throw new Error(`Node adapter export is missing: ${options.adapterSubpath}`);
    const entryValue =
      exported === undefined
        ? (adapterManifest.main ?? "src/index.ts")
        : importerEntrySchema.parse(exported);
    const entry = adapterEntrySchema.parse(
      (typeof entryValue === "string" ? entryValue : entryValue.import).replace(/^\.\//, ""),
    );
    const packageId = `p${packages.length}`;
    const item = {
      id: packageId,
      locator: `tool:${adapterManifest.name}@${adapterManifest.version}`,
      integrity: "tool-content",
      files: options.adapterSubpath
        ? [
            {
              path: "package.json",
              bytes: (await readFile(join(adapterRoot, "package.json"))).toString("base64"),
            },
            ...(await collectEntryFiles(adapterRoot, entry)),
          ]
        : await collectFiles(adapterRoot),
      dependencies: Object.create(null) as Record<string, string>,
    };
    packages.push(item);
    if (options.adapterDependencySnapshot) {
      const snapshotPath = adapterEntrySchema.parse(options.adapterDependencySnapshot);
      const packed = validateNodeTransformSnapshot(
        JSON.parse(
          gunzipSync(await readFile(join(adapterRoot, snapshotPath)), {
            maxOutputLength: 128 * 1024 * 1024,
          }).toString("utf8"),
        ),
      );
      const packedAdapter = packed.packages.find((pkg) => pkg.id === packed.adapter?.packageId);
      if (!packedAdapter || Object.keys(packed.rootDependencies).length !== 0)
        throw new Error("Invalid distributed Node adapter dependency snapshot");
      const dependencies = packed.packages.filter((pkg) => pkg.id !== packedAdapter.id);
      const ids = new Map(
        dependencies.map((pkg, index) => [pkg.id, `p${packages.length + index}`]),
      );
      const remap = (edges: Readonly<Record<string, string>>) =>
        Object.fromEntries(
          Object.entries(edges).map(([name, id]) => {
            const mapped = ids.get(id);
            if (!mapped) throw new Error("Invalid distributed Node adapter dependency edge");
            return [name, mapped];
          }),
        );
      for (const dependency of dependencies)
        packages.push({
          ...dependency,
          id: ids.get(dependency.id)!,
          files: [...dependency.files],
          dependencies: remap(dependency.dependencies),
        });
      Object.assign(item.dependencies, remap(packedAdapter.dependencies));
    } else {
      for (const name of (
        options.adapterDependencies ?? Object.keys(toolContext!.importer.dependencies)
      ).toSorted()) {
        const value = toolContext!.importer.dependencies[name];
        if (!value) throw new Error(`Node adapter dependency is missing: ${name}`);
        const dependency = await visit(name, value.version, adapterRoot, toolContext!);
        if (dependency) item.dependencies[name] = dependency;
      }
    }
    adapter = { packageId, entry };
  }
  const closure = process.env.UNFRAME_STYLE_RUNTIME_CLOSURE
    ? (await readFile(process.env.UNFRAME_STYLE_RUNTIME_CLOSURE, "utf8")).trim().split(/\s+/).sort()
    : [];
  return identify({
    version: 1,
    runtime: {
      nodePath,
      nodeHash: digest(await readFile(nodePath)),
      ...runtimeData,
      mode: "production",
      closure,
      environment:
        runtimeData.platform === "linux"
          ? {
              ...(process.env.NIX_LD ? { NIX_LD: await realpath(process.env.NIX_LD) } : {}),
              NIX_LD_LIBRARY_PATH: closure.map((path) => `${path}/lib`).join(":"),
            }
          : {},
    },
    sourceFiles: [...(options.sourceFiles ?? (await collectFiles(root)))],
    rootDependencies,
    packages,
    ...(adapter ? { adapter } : {}),
  });
};
export const materializeNodeTransformSnapshot = async (
  input: NodeTransformSnapshot,
  destination: string,
): Promise<{ projectRoot: string; adapterPath?: string }> => {
  const snapshot = validateNodeTransformSnapshot(input);
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error("Node snapshot destination must be empty");
  const directories = new Map<string, string>();
  const ensureDirectory = async (directory: string) => {
    const components = relative(root, directory).split(sep).filter(Boolean);
    let current = root;
    for (const component of components) {
      current = join(current, component);
      await mkdir(current).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Invalid snapshot directory");
      const identity = `${info.dev}:${info.ino}`;
      const previous = directories.get(identity);
      if (previous !== undefined && previous !== current)
        throw new Error("Node snapshot directory alias");
      directories.set(identity, current);
    }
  };
  const place = async (directory: string, files: readonly NodeSnapshotFile[]) => {
    await ensureDirectory(directory);
    for (const file of files) {
      const path = join(directory, file.path);
      await ensureDirectory(dirname(path));
      await writeFile(path, Buffer.from(file.bytes, "base64"), {
        mode: file.executable ? 0o555 : 0o444,
        flag: "wx",
      });
    }
  };
  const links = async (directory: string, edges: Readonly<Record<string, string>>) => {
    for (const [name, id] of Object.entries(edges)) {
      const path = join(directory, "node_modules", name);
      await ensureDirectory(dirname(path));
      await symlink(relative(dirname(path), join(root, "node_modules", ".unframe", id)), path);
    }
  };
  const projectRoot = join(root, "project");
  await place(projectRoot, snapshot.sourceFiles);
  for (const pkg of snapshot.packages)
    await place(join(root, "node_modules", ".unframe", pkg.id), pkg.files);
  await links(projectRoot, snapshot.rootDependencies);
  for (const pkg of snapshot.packages)
    await links(join(root, "node_modules", ".unframe", pkg.id), pkg.dependencies);
  return {
    projectRoot,
    ...(snapshot.adapter
      ? {
          adapterPath: join(
            root,
            "node_modules",
            ".unframe",
            snapshot.adapter.packageId,
            snapshot.adapter.entry,
          ),
        }
      : {}),
  };
};

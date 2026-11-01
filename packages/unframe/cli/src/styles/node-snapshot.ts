import { createHash } from "node:crypto";
import {
  identifyNodeTransformSnapshot as identify,
  validateNodeTransformSnapshot,
} from "@unframe/workspace";
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
} from "@unframe/workspace";
import { probeNodeRuntime } from "./runtime.js";
export type { NodeSnapshotFile, NodeTransformSnapshot } from "@unframe/workspace";
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
const collectFiles = async (root: string): Promise<NodeSnapshotFile[]> => {
  const files: NodeSnapshotFile[] = [];
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      if (["node_modules", ".git", ".unframe"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
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
const readLock = async (directory: string, workspace: boolean) => {
  let root = await realpath(directory);
  for (;;) {
    try {
      const documents = parseAllDocuments(await readFile(join(root, "pnpm-lock.yaml"), "utf8"), {
        uniqueKeys: true,
      });
      const document = documents.at(-1);
      if (!document || documents.some((item) => item.errors.length))
        throw new Error("Invalid pnpm lock YAML");
      const lock = pnpmLockSchema.parse(document.toJS({ maxAliasCount: 100 }));
      const importer = lock.importers[relative(root, directory).split(sep).join("/") || "."];
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
export const snapshotNodeTransformInputs = async (
  projectRoot: string,
  options: {
    readonly sourceFiles?: readonly NodeSnapshotFile[];
    readonly adapterRoot?: string;
    readonly adapterSubpath?: string;
    readonly adapterDependencies?: readonly string[];
    readonly nodePath?: string;
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
    const locator = Object.hasOwn(snapshots, `${name}@${version}`) ? `${name}@${version}` : version;
    pnpmLocatorSchema.parse(locator);
    if (!Object.hasOwn(snapshots, locator))
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
    if (!contained(join(context.root, "node_modules"), packageRoot))
      throw new Error("Node dependency escapes installed graph");
    const manifest = packageManifestSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
    );
    const nameVersion = `${manifest.name}@${manifest.version}`;
    const baseLocator = locator.split("(")[0]!;
    const packageRecord = context.lock.packages[baseLocator];
    if (!packageRecord) throw new Error("Node package is missing from pnpm lock");
    if (
      baseLocator !== nameVersion &&
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
    const integrity = packageRecord.resolution.integrity;
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
      files: await collectFiles(packageRoot),
      dependencies: Object.create(null) as Record<string, string>,
    };
    packages.push(item);
    const locked = snapshots[locator]!;
    const edges = {
      ...locked.dependencies,
      ...locked.optionalDependencies,
    };
    for (const dependency of Object.keys(edges).sort()) {
      const child = await visit(
        dependency,
        edges[dependency]!,
        packageRoot,
        context,
        Object.hasOwn(locked.optionalDependencies, dependency),
      );
      if (child) item.dependencies[dependency] = child;
    }
    return id;
  };
  const context = await readLock(root, false);
  const rootDependencies: Record<string, string> = Object.create(null) as Record<string, string>;
  const rootEdges = {
    ...context.importer.dependencies,
    ...context.importer.devDependencies,
    ...context.importer.optionalDependencies,
  };
  for (const name of Object.keys(rootEdges).sort()) {
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
    const toolContext = await readLock(adapterRoot, true);
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
            ...(await collectFiles(join(adapterRoot, dirname(dirname(entry))))).map((file) => ({
              ...file,
              path: `${dirname(dirname(entry))}/${file.path}`,
            })),
          ]
        : await collectFiles(adapterRoot),
      dependencies: Object.create(null) as Record<string, string>,
    };
    packages.push(item);
    for (const name of (
      options.adapterDependencies ?? Object.keys(toolContext.importer.dependencies)
    ).toSorted()) {
      const value = toolContext.importer.dependencies[name];
      if (!value) throw new Error(`Node adapter dependency is missing: ${name}`);
      const dependency = await visit(name, value.version, adapterRoot, toolContext);
      if (dependency) item.dependencies[name] = dependency;
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

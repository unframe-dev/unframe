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

import {
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
      if (["node_modules", ".git", ".unframe", ".cache"].includes(entry.name)) continue;
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
type NodeManifest = ReturnType<typeof packageManifestSchema.parse> & {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};
const parseManifest = (raw: unknown, project = false): NodeManifest => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Node package manifest must be an object");
  const parsed = packageManifestSchema.parse(
    project ? { name: "unframe-project", version: "0.0.0", ...raw } : raw,
  );
  const dependencies: Record<string, Record<string, string>> = {};
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const value = parsed[field] ?? {};
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Object.entries(value).every(
        ([name, range]) =>
          /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name) &&
          typeof range === "string" &&
          range.length > 0,
      )
    )
      throw new Error(`Invalid Node package ${field}`);
    dependencies[field] = value as Record<string, string>;
  }
  const meta = parsed.peerDependenciesMeta ?? {};
  if (
    !meta ||
    typeof meta !== "object" ||
    Array.isArray(meta) ||
    !Object.values(meta).every(
      (value) =>
        value &&
        typeof value === "object" &&
        (!Object.hasOwn(value, "optional") ||
          typeof (value as { optional: unknown }).optional === "boolean"),
    )
  )
    throw new Error("Invalid Node peer dependency metadata");
  return { ...parsed, ...dependencies, peerDependenciesMeta: meta } as NodeManifest;
};
const readManifest = async (directory: string, project = false): Promise<NodeManifest> =>
  parseManifest(JSON.parse(await readFile(join(directory, "package.json"), "utf8")), project);
const findInstalled = async (name: string, from: string): Promise<string | undefined> => {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name))
    throw new Error(`Invalid Node dependency: ${name}`);
  for (let current = from; ; current = dirname(current)) {
    if (current.split(sep).at(-1) !== "node_modules") {
      const candidate = join(current, "node_modules", name);
      try {
        return await realpath(candidate);
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
        if (
          await lstat(candidate).catch((e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT" || e.code === "ENOTDIR") return undefined;
            throw e;
          })
        )
          throw new Error(`Broken installed Node dependency link: ${name}`);
      }
    }
    if (dirname(current) === current) return undefined;
  }
};
const checkPnp = async (directory: string) => {
  for (let current = directory; ; current = dirname(current)) {
    for (const name of [".pnp.cjs", ".pnp.js", ".pnp.loader.mjs"])
      if (
        await lstat(join(current, name)).catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT" || e.code === "ENOTDIR") return undefined;
          throw e;
        })
      )
        throw new Error("Yarn PnP is not supported; install dependencies using node_modules.");
    if (dirname(current) === current) return;
  }
};
const dependencyNames = (
  manifest: Awaited<ReturnType<typeof readManifest>>,
  development: boolean,
) =>
  Object.keys({
    ...manifest.peerDependencies,
    ...manifest.dependencies,
    ...(development ? manifest.devDependencies : {}),
    ...manifest.optionalDependencies,
  }).sort();
const isLinked = (directory: string) => !directory.split(sep).includes("node_modules");
export const snapshotNodeRuntime = async (
  requestedNodePath?: string,
): Promise<NodeTransformSnapshot["runtime"]> => {
  const nodePath = await realpath(
    requestedNodePath ?? process.env.UNFRAME_STYLE_NODE ?? process.execPath,
  );
  const runtime = probeNodeRuntime(nodePath);
  const closure = process.env.UNFRAME_STYLE_RUNTIME_CLOSURE
    ? (await readFile(process.env.UNFRAME_STYLE_RUNTIME_CLOSURE, "utf8")).trim().split(/\s+/).sort()
    : [];
  return {
    nodePath,
    nodeHash: digest(await readFile(nodePath)),
    ...runtime,
    mode: "production",
    closure,
    environment:
      runtime.platform === "linux"
        ? {
            ...(process.env.NIX_LD ? { NIX_LD: await realpath(process.env.NIX_LD) } : {}),
            NIX_LD_LIBRARY_PATH: closure.map((path) => `${path}/lib`).join(":"),
          }
        : {},
  };
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
  const runtime = await snapshotNodeRuntime(options.nodePath);
  const packages: {
    id: string;
    locator: string;
    integrity: string;
    files: NodeSnapshotFile[];
    dependencies: Record<string, string>;
  }[] = [];
  const seen = new Map<string, string>();
  const capturedFiles = new Map<string, NodeSnapshotFile[]>();
  await checkPnp(root);
  const identity = async (directory: string) => {
    const manifest = await readManifest(directory);
    return `${manifest.name}@${manifest.version}#${digest(relative(root, directory).split(sep).join("/"))}`;
  };
  const visit = async (
    name: string,
    from: string,
    optional = false,
    consumer = from,
  ): Promise<string | undefined> => {
    const packageRoot = (await findInstalled(name, from)) ?? (await findInstalled(name, consumer));
    if (!packageRoot) {
      if (optional) return undefined;
      throw new Error(`Missing Node dependency: ${name}`);
    }
    const workspace = isLinked(packageRoot);
    let files = capturedFiles.get(packageRoot);
    if (!files) {
      files = await collectFiles(packageRoot, workspace);
      capturedFiles.set(packageRoot, files);
    }
    const manifestFile = files.find((file) => file.path === "package.json");
    if (!manifestFile) throw new Error(`Node package manifest is missing: ${packageRoot}`);
    const manifest = parseManifest(
      JSON.parse(Buffer.from(manifestFile.bytes, "base64").toString("utf8")),
    );
    const compatible =
      supportsPlatform(manifest.os, runtime.platform) &&
      supportsPlatform(manifest.cpu, runtime.arch) &&
      (runtime.platform !== "linux" ||
        supportsPlatform(manifest.libc, runtime.libc === "non-glibc" ? "musl" : "glibc"));
    if (!compatible) {
      if (optional) return undefined;
      throw new Error(`Node dependency does not support the captured platform: ${name}`);
    }
    const references = workspace
      ? workspaceSourcePackageSpecifiers(
          files.map((file) => ({
            path: file.path,
            source: Buffer.from(file.bytes, "base64").toString("utf8"),
          })),
        )
      : [];
    const names = dependencyNames(manifest, workspace).filter(
      (name) =>
        !workspace ||
        Object.hasOwn(manifest.dependencies ?? {}, name) ||
        Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
        Object.hasOwn(manifest.peerDependencies ?? {}, name) ||
        references.includes(name),
    );
    let locator = `${manifest.name}@${manifest.version}#${digest(relative(root, packageRoot).split(sep).join("/"))}`;
    if (Object.keys(manifest.peerDependencies ?? {}).length)
      locator += `(consumer#${digest(relative(root, consumer).split(sep).join("/"))})`;
    for (const peer of Object.keys(manifest.peerDependencies ?? {}).sort()) {
      const resolved =
        (await findInstalled(peer, packageRoot)) ?? (await findInstalled(peer, consumer));
      if (resolved) locator += `(${peer}@${await identity(resolved)})`;
    }
    const previous = seen.get(locator);
    if (previous) return previous;
    const id = `p${packages.length}`;
    seen.set(locator, id);
    const item = {
      id,
      locator,
      integrity: `sha256:${digest(JSON.stringify(files))}`,
      files,
      dependencies: Object.create(null) as Record<string, string>,
    };
    packages.push(item);
    for (const dependency of names) {
      const peer = Object.hasOwn(manifest.peerDependencies ?? {}, dependency);
      const peerMeta = manifest.peerDependenciesMeta?.[dependency];
      const child = await visit(
        dependency,
        packageRoot,
        Object.hasOwn(manifest.optionalDependencies ?? {}, dependency) ||
          peerMeta?.optional === true,
        peer ? consumer : packageRoot,
      );
      if (child) item.dependencies[dependency] = child;
    }
    return id;
  };
  const projectManifest = await readManifest(root, true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return parseManifest({}, true);
    throw error;
  });
  const rootDependencies: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of dependencyNames(projectManifest, true)) {
    if (options.rootSpecifiers && !options.rootSpecifiers.includes(name)) continue;
    const id = await visit(
      name,
      root,
      Object.hasOwn(projectManifest.optionalDependencies ?? {}, name) ||
        projectManifest.peerDependenciesMeta?.[name]?.optional === true,
    );
    if (id) rootDependencies[name] = id;
  }
  let adapter: NodeTransformSnapshot["adapter"];
  if (options.adapterRoot) {
    const adapterRoot = await realpath(options.adapterRoot);
    await checkPnp(adapterRoot);
    const toolManifest = await readManifest(adapterRoot);
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
        options.adapterDependencies ?? Object.keys(toolManifest.dependencies ?? {})
      ).toSorted()) {
        if (!Object.hasOwn(toolManifest.dependencies ?? {}, name))
          throw new Error(`Node adapter dependency is missing: ${name}`);
        const dependency = await visit(name, adapterRoot);
        if (dependency) item.dependencies[name] = dependency;
      }
    }
    adapter = { packageId, entry };
  }
  return identify({
    version: 1,
    runtime,
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

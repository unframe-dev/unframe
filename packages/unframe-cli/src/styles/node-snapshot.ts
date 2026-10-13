import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseAllDocuments } from "yaml";

export type NodeSnapshotFile = {
  readonly path: string;
  readonly bytes: string;
  readonly executable?: boolean;
};
export type NodeTransformSnapshot = {
  readonly version: 1;
  readonly identity: string;
  readonly sourceIdentity: string;
  readonly runtime: {
    readonly nodePath: string;
    readonly nodeHash: string;
    readonly version: string;
    readonly platform: string;
    readonly arch: string;
    readonly libc: string;
    readonly mode: "production";
    readonly closure: readonly string[];
    readonly environment: Readonly<Record<string, string>>;
  };
  readonly sourceFiles: readonly NodeSnapshotFile[];
  readonly rootDependencies: Readonly<Record<string, string>>;
  readonly packages: readonly {
    readonly id: string;
    readonly locator: string;
    readonly integrity: string;
    readonly files: readonly NodeSnapshotFile[];
    readonly dependencies: Readonly<Record<string, string>>;
  }[];
  readonly adapter?: { readonly packageId: string; readonly entry: string };
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
};
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const safePath = (path: string) =>
  path.length > 0 &&
  !isAbsolute(path) &&
  !path.includes("\\") &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const safeName = (name: string) =>
  /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name) &&
  !name.split("/").some((part) => part === "." || part === "..");
const canonicalFiles = (files: readonly NodeSnapshotFile[]) => {
  const sorted = files
    .map((file) => {
      if (
        !safePath(file.path) ||
        file.path.split("/").includes("node_modules") ||
        (file.executable !== undefined && typeof file.executable !== "boolean") ||
        typeof file.bytes !== "string" ||
        Buffer.from(file.bytes, "base64").toString("base64") !== file.bytes
      )
        throw new Error("Invalid Node snapshot file");
      return {
        path: file.path,
        bytes: file.bytes,
        ...(file.executable ? { executable: true } : {}),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (new Set(sorted.map((file) => file.path)).size !== sorted.length)
    throw new Error("Duplicate Node snapshot file");
  return sorted;
};
const identify = (
  snapshot: Omit<NodeTransformSnapshot, "identity" | "sourceIdentity">,
): NodeTransformSnapshot => {
  const sourceFiles = canonicalFiles(snapshot.sourceFiles);
  const value = { ...snapshot, sourceFiles };
  return {
    ...value,
    sourceIdentity: digest(canonical(sourceFiles)),
    identity: digest(canonical(value)),
  };
};
export const withNodeTransformSources = (
  snapshot: NodeTransformSnapshot,
  files: readonly NodeSnapshotFile[],
): NodeTransformSnapshot => {
  const { identity: _identity, sourceIdentity: _sourceIdentity, ...value } = snapshot;
  return identify({ ...value, sourceFiles: files });
};
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
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pnpm lock object");
  return value as Record<string, unknown>;
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
      const lock = object(document.toJS({ maxAliasCount: 100 }));
      if (String(lock.lockfileVersion) !== "9.0")
        throw new Error("Node transforms require pnpm lockfileVersion 9.0");
      const importer = object(
        object(lock.importers)[relative(root, directory).split(sep).join("/") || "."],
      );
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
    readonly nodePath?: string;
  } = {},
): Promise<NodeTransformSnapshot> => {
  const root = await realpath(projectRoot);
  const nodePath = await realpath(
    options.nodePath ?? process.env.UNFRAME_STYLE_NODE ?? process.execPath,
  );
  const runtimeData = JSON.parse(
    execFileSync(
      nodePath,
      [
        "-e",
        "const h=process.report.getReport().header; process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime || 'non-glibc'}))",
      ],
      { env: {}, maxBuffer: 1024 * 1024 },
    ).toString(),
  ) as { version: string; platform: string; arch: string; libc: string };
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
    if (!safeName(name) || typeof version !== "string")
      throw new Error("Invalid pnpm Node dependency");
    const snapshots = object(context.lock.snapshots ?? {});
    const locator = Object.hasOwn(snapshots, `${name}@${version}`) ? `${name}@${version}` : version;
    if (
      !Object.hasOwn(snapshots, locator) ||
      locator.includes("link:") ||
      locator.startsWith("/") ||
      /file:(?:\/|[A-Za-z]:|.*(?:^|\/)\.\.(?:\/|$))/.test(locator)
    )
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
    const manifest = object(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")));
    const nameVersion = `${String(manifest.name)}@${String(manifest.version)}`;
    const baseLocator = locator.split("(")[0]!;
    const packageRecord = object(object(context.lock.packages ?? {})[baseLocator]);
    if (
      baseLocator !== nameVersion &&
      !(
        baseLocator.startsWith(`${String(manifest.name)}@file:`) &&
        packageRecord.version === manifest.version
      )
    )
      throw new Error(`Installed package does not match pnpm locator: ${locator}`);
    const supports = (input: unknown, target: string) => {
      if (input === undefined) return true;
      if (!Array.isArray(input) || !input.every((item) => typeof item === "string"))
        throw new Error("Invalid Node platform metadata");
      const allowed = input as string[];
      return (
        !allowed.includes(`!${target}`) &&
        (allowed.every((item) => item.startsWith("!")) ||
          allowed.includes(target) ||
          allowed.includes("any"))
      );
    };
    const compatible = [manifest, packageRecord].every(
      (metadata) =>
        supports(metadata.os, runtimeData.platform) &&
        supports(metadata.cpu, runtimeData.arch) &&
        supports(metadata.libc, runtimeData.libc === "non-glibc" ? "musl" : "glibc"),
    );
    if (!compatible) {
      if (optional) return undefined;
      throw new Error(`Node dependency does not support the locked platform: ${locator}`);
    }
    const integrity = object(packageRecord.resolution).integrity;
    if (typeof integrity !== "string" || !/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/.test(integrity))
      throw new Error("Node package archive integrity is missing");
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
    const locked = object(snapshots[locator]);
    const edges = {
      ...object(locked.dependencies ?? {}),
      ...object(locked.optionalDependencies ?? {}),
    };
    for (const dependency of Object.keys(edges).sort()) {
      const child = await visit(
        dependency,
        String(edges[dependency]),
        packageRoot,
        context,
        Object.hasOwn(object(locked.optionalDependencies ?? {}), dependency),
      );
      if (child) item.dependencies[dependency] = child;
    }
    return id;
  };
  const context = await readLock(root, false);
  const rootDependencies: Record<string, string> = Object.create(null) as Record<string, string>;
  const rootEdges = {
    ...object(context.importer.dependencies ?? {}),
    ...object(context.importer.devDependencies ?? {}),
    ...object(context.importer.optionalDependencies ?? {}),
  };
  for (const name of Object.keys(rootEdges).sort()) {
    const id = await visit(
      name,
      String(object(rootEdges[name]).version),
      root,
      context,
      Object.hasOwn(object(context.importer.optionalDependencies ?? {}), name),
    );
    if (id) rootDependencies[name] = id;
  }
  let adapter: NodeTransformSnapshot["adapter"];
  if (options.adapterRoot) {
    const adapterRoot = await realpath(options.adapterRoot);
    const toolContext = await readLock(adapterRoot, true);
    const adapterManifest = object(
      JSON.parse(await readFile(join(adapterRoot, "package.json"), "utf8")),
    );
    const exported =
      typeof adapterManifest.exports === "string"
        ? adapterManifest.exports
        : object(adapterManifest.exports ?? {})["."];
    const entry =
      typeof exported === "string"
        ? exported
        : typeof exported === "object" && exported !== null
          ? object(exported).import
          : (adapterManifest.main ?? "src/index.ts");
    if (typeof entry !== "string") throw new Error("Node adapter import entry is missing");
    const packageId = `p${packages.length}`;
    const item = {
      id: packageId,
      locator: `tool:${String(adapterManifest.name)}@${String(adapterManifest.version)}`,
      integrity: "tool-content",
      files: await collectFiles(adapterRoot),
      dependencies: Object.create(null) as Record<string, string>,
    };
    packages.push(item);
    for (const [name, value] of Object.entries(
      object(toolContext.importer.dependencies ?? {}),
    ).sort(([a], [b]) => a.localeCompare(b, "en"))) {
      const dependency = await visit(name, String(object(value).version), adapterRoot, toolContext);
      if (dependency) item.dependencies[name] = dependency;
    }
    adapter = { packageId, entry: entry.replace(/^\.\//, "") };
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
      environment: {
        ...(process.env.NIX_LD ? { NIX_LD: await realpath(process.env.NIX_LD) } : {}),
        NIX_LD_LIBRARY_PATH: closure.map((path) => `${path}/lib`).join(":"),
      },
    },
    sourceFiles: options.sourceFiles ?? (await collectFiles(root)),
    rootDependencies,
    packages,
    ...(adapter ? { adapter } : {}),
  });
};
export const validateNodeTransformSnapshot = (input: unknown): NodeTransformSnapshot => {
  if (!input || typeof input !== "object") throw new Error("Invalid Node snapshot");
  const value = input as NodeTransformSnapshot;
  if (
    value.version !== 1 ||
    !Array.isArray(value.sourceFiles) ||
    !Array.isArray(value.packages) ||
    !value.runtime ||
    value.runtime.mode !== "production" ||
    !isAbsolute(value.runtime.nodePath) ||
    !/^[a-f0-9]{64}$/.test(value.runtime.nodeHash) ||
    !value.runtime.environment ||
    Object.entries(value.runtime.environment).some(
      ([key, val]) => !["NIX_LD", "NIX_LD_LIBRARY_PATH"].includes(key) || typeof val !== "string",
    ) ||
    !Array.isArray(value.runtime.closure) ||
    !value.runtime.closure.every(
      (path) => typeof path === "string" && /^\/nix\/store\/[^/]+$/.test(path),
    ) ||
    !["version", "platform", "arch", "libc"].every(
      (key) => typeof value.runtime[key as keyof typeof value.runtime] === "string",
    )
  )
    throw new Error("Invalid Node snapshot");
  const ids = new Set(value.packages.map((pkg) => pkg.id));
  if (ids.size !== value.packages.length) throw new Error("Duplicate Node package");
  const validateEdges = (edges: Readonly<Record<string, string>>) => {
    if (!edges || typeof edges !== "object" || Array.isArray(edges))
      throw new Error("Invalid Node edges");
    for (const [name, id] of Object.entries(edges))
      if (!safeName(name) || !ids.has(id)) throw new Error("Invalid Node edge");
  };
  validateEdges(value.rootDependencies);
  for (const pkg of value.packages) {
    if (
      !/^p\d+$/.test(pkg.id) ||
      typeof pkg.locator !== "string" ||
      typeof pkg.integrity !== "string"
    )
      throw new Error("Invalid Node package id");
    canonicalFiles(pkg.files);
    validateEdges(pkg.dependencies);
  }
  if (value.adapter && (!ids.has(value.adapter.packageId) || !safePath(value.adapter.entry)))
    throw new Error("Invalid Node adapter");
  const { identity, sourceIdentity, ...body } = value;
  const identified = identify(body);
  if (identity !== identified.identity || sourceIdentity !== identified.sourceIdentity)
    throw new Error("Node snapshot integrity mismatch");
  return identified;
};
export const materializeNodeTransformSnapshot = async (
  input: NodeTransformSnapshot,
  destination: string,
): Promise<{ projectRoot: string; adapterPath?: string }> => {
  const snapshot = validateNodeTransformSnapshot(input);
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error("Node snapshot destination must be empty");
  const place = async (directory: string, files: readonly NodeSnapshotFile[]) => {
    await mkdir(directory, { recursive: true });
    for (const file of files) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(file.bytes, "base64"), {
        mode: file.executable ? 0o555 : 0o444,
        flag: "wx",
      });
    }
  };
  const links = async (directory: string, edges: Readonly<Record<string, string>>) => {
    for (const [name, id] of Object.entries(edges)) {
      const path = join(directory, "node_modules", name);
      await mkdir(dirname(path), { recursive: true });
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

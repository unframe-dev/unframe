import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { parseStrictJson } from "./strict-json.js";
import { readDirectoryNames, readRegularFile } from "./path-policy.js";
import {
  hashPackageLocator,
  hashLockedPackageContent,
  type ContentHash,
  type LockedFile,
  type PackageSnapshot,
  type LockedDependency,
} from "./lock.js";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("Expected a nonempty string.");
  return value;
};
export const digestBytes = (bytes: Uint8Array): ContentHash =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const typeSpecifier = (name: string) => {
  if (!name.startsWith("@types/")) return name;
  const plain = name.slice(7);
  return plain.includes("__") ? `@${plain.replace("__", "/")}` : plain;
};
const conditions = {
  runtimeImport: new Set(["browser", "import", "production", "default"]),
  runtimeRequire: new Set(["browser", "require", "production", "default"]),
  types: new Set(["types", "import", "default"]),
};
const target = (value: unknown, active: Set<string>): string | null | undefined => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = target(item, active);
      if (result !== undefined) return result;
    }
    return undefined;
  }
  for (const [condition, branch] of Object.entries(record(value))) {
    if (active.has(condition)) {
      const result = target(branch, active);
      if (result !== undefined) return result;
    }
  }
  return undefined;
};
const pathTarget = (value: string | null | undefined, files: readonly string[]): string | null => {
  if (value == null) return null;
  const path = value.startsWith("./") ? value.slice(2) : value;
  if (
    !path ||
    path.includes("\\") ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    !files.includes(path)
  )
    throw new Error(`Package export does not name a locked file: ${value}`);
  return path;
};
export const resolvePackageExportTargets = (
  manifest: Record<string, unknown>,
  files: readonly string[],
): PackageSnapshot["exports"] => {
  const browserMap =
    manifest.browser && typeof manifest.browser === "object" ? record(manifest.browser) : undefined;
  const browserTarget = (path: string | null) => {
    if (!path || !browserMap) return path;
    const mapped = browserMap[`./${path}`];
    if (mapped === false) return null;
    return mapped === undefined ? path : pathTarget(mapped as string, files);
  };
  if (manifest.browser && typeof manifest.browser === "object") {
    for (const [from, to] of Object.entries(record(manifest.browser))) {
      if (!from.startsWith("./") || !files.includes(from.slice(2)))
        throw new Error("Browser mapping source must name a locked package file.");
      if (
        to !== false &&
        (typeof to !== "string" || !to.startsWith("./") || !files.includes(to.slice(2)))
      )
        throw new Error("Browser mapping target must name a locked package file.");
    }
  }
  if (manifest.imports) {
    for (const name of Object.keys(record(manifest.imports)))
      if (!name.startsWith("#") || name.includes("*"))
        throw new Error("Package aliases must be exact # specifiers.");
  }
  if (manifest.exports === undefined) {
    const first = (...values: unknown[]) =>
      values.find((v) => typeof v === "string" && v.length > 0) as string | undefined;
    const standardIndex = files.includes("index.js") ? "./index.js" : undefined;
    const row = {
      subpath: ".",
      runtimeImport: browserTarget(
        pathTarget(
          first(manifest.browser, manifest.module, manifest.main, standardIndex) ?? null,
          files,
        ),
      ),
      runtimeRequire: browserTarget(pathTarget(first(manifest.main, standardIndex) ?? null, files)),
      types: pathTarget(
        first(
          manifest.types,
          manifest.typings,
          files.includes("index.d.ts") ? "./index.d.ts" : undefined,
        ) ?? null,
        files,
      ),
    };
    if (!row.runtimeImport && !row.runtimeRequire && !row.types)
      throw new Error("Package has no explicit root entry.");
    return [row];
  }
  const exports = manifest.exports;
  const entries =
    typeof exports === "object" &&
    exports !== null &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((k) => k.startsWith("."))
      ? Object.entries(record(exports))
      : ([[".", exports]] as const);
  const rows = new Map<
    string,
    { row: PackageSnapshot["exports"][number]; prefix: number; suffix: number }
  >();
  const blockedWildcards: {
    prefixText: string;
    suffixText: string;
    prefix: number;
    suffix: number;
  }[] = [];
  for (const [declaredSubpath, declaredValue] of entries) {
    const directoryMapping = declaredSubpath.endsWith("/");
    if (directoryMapping && (typeof declaredValue !== "string" || !declaredValue.endsWith("/")))
      throw new Error("Directory export must target a package directory.");
    const subpath = directoryMapping ? `${declaredSubpath}*` : declaredSubpath;
    const value = directoryMapping ? `${declaredValue}*` : declaredValue;
    if (
      subpath !== "." &&
      (!subpath.startsWith("./") ||
        subpath
          .split("/")
          .slice(1)
          .some((part) => !part || part === "." || part === ".."))
    )
      throw new Error(`Export subpath is invalid: ${subpath}`);
    const templates = {
      runtimeImport: target(value, conditions.runtimeImport),
      runtimeRequire: target(value, conditions.runtimeRequire),
      types: target(value, conditions.types),
    };
    const wildcardCount = subpath.split("*").length - 1;
    if (wildcardCount > 1) throw new Error("Export subpath may contain one wildcard.");
    if (wildcardCount === 1 && Object.values(templates).every((template) => template == null)) {
      const marker = subpath.indexOf("*");
      blockedWildcards.push({
        prefixText: subpath.slice(0, marker),
        suffixText: subpath.slice(marker + 1),
        prefix: marker,
        suffix: subpath.length - marker - 1,
      });
      continue;
    }
    const substitutions = new Set<string>();
    if (wildcardCount === 0) substitutions.add("");
    else
      for (const template of Object.values(templates)) {
        if (template == null) continue;
        if (template.split("*").length !== 2 || !template.startsWith("./"))
          throw new Error("Wildcard export must map to a single relative wildcard target.");
        const [prefix, suffix] = template.slice(2).split("*") as [string, string];
        for (const file of files)
          if (
            file.startsWith(prefix) &&
            file.endsWith(suffix) &&
            file.length > prefix.length + suffix.length
          )
            substitutions.add(file.slice(prefix.length, file.length - suffix.length));
      }
    for (const replacement of substitutions) {
      const concreteSubpath = subpath.replace("*", replacement);
      const resolve = (template: string | null | undefined) =>
        pathTarget(template?.replace("*", replacement) ?? null, files);
      const row = {
        subpath: concreteSubpath,
        runtimeImport: browserTarget(resolve(templates.runtimeImport)),
        runtimeRequire: browserTarget(resolve(templates.runtimeRequire)),
        types: resolve(templates.types),
      };
      const previous = rows.get(concreteSubpath);
      const prefix = wildcardCount === 0 ? Infinity : subpath.indexOf("*");
      const suffix = wildcardCount === 0 ? Infinity : subpath.length - prefix - 1;
      if (
        previous &&
        (previous.prefix > prefix || (previous.prefix === prefix && previous.suffix > suffix))
      )
        continue;
      if (
        previous &&
        previous.prefix === prefix &&
        previous.suffix === suffix &&
        JSON.stringify(previous.row) !== JSON.stringify(row)
      )
        throw new Error(`Overlapping package exports are ambiguous: ${concreteSubpath}`);
      rows.set(concreteSubpath, { row, prefix, suffix });
    }
  }
  for (const [subpath, selected] of rows) {
    if (
      blockedWildcards.some(
        (blocked) =>
          subpath.startsWith(blocked.prefixText) &&
          subpath.endsWith(blocked.suffixText) &&
          subpath.length > blocked.prefixText.length + blocked.suffixText.length &&
          (blocked.prefix > selected.prefix ||
            (blocked.prefix === selected.prefix && blocked.suffix >= selected.suffix)),
      )
    )
      rows.delete(subpath);
  }
  return [...rows.values()]
    .map(({ row }) => row)
    .filter((row) => row.runtimeImport || row.runtimeRequire || row.types)
    .sort((a, b) => compare(a.subpath, b.subpath));
};
export const mediaTypeFor = (path: string): string => {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return (
    (
      {
        ".ts": "text/typescript",
        ".tsx": "text/tsx",
        ".mts": "text/typescript",
        ".cts": "text/typescript",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".cjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
};
export const lockedFile = (path: string, bytes: Uint8Array): LockedFile => {
  const mediaType = mediaTypeFor(path);
  const hash = digestBytes(bytes);
  if (mediaType.startsWith("text/") || mediaType === "application/json") {
    const data = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { path, mediaType, hash, encoding: "utf8", data };
  }
  return { path, mediaType, hash, encoding: "base64", data: Buffer.from(bytes).toString("base64") };
};
const packageFiles = async (root: string): Promise<LockedFile[]> => {
  const files: LockedFile[] = [];
  const visit = async (path: string): Promise<void> => {
    const names = await readDirectoryNames(path ? join(root, path) : root);
    if (!names) throw new Error("Package directory is unsafe.");
    for (const name of names) {
      if (name === "node_modules" || name === ".git") continue;
      const relative = path ? `${path}/${name}` : name;
      const full = join(root, relative);
      if (await readDirectoryNames(full)) await visit(relative);
      else {
        const bytes = await readRegularFile(full);
        if (!bytes) throw new Error("Package contains an unsafe file.");
        files.push(lockedFile(relative, bytes));
      }
    }
  };
  await visit("");
  return files.sort((a, b) => compare(a.path, b.path));
};

/** Reads only an explicitly installed pnpm graph; never evaluates package or lifecycle code. */
export const snapshotInstalledPackages = async (
  root: string,
): Promise<{
  packageManagerLockHash: ContentHash;
  rootDependencies: LockedDependency[];
  packages: PackageSnapshot[];
}> => {
  const projectRoot = await realpath(root);
  const bytes = await readRegularFile(join(projectRoot, "pnpm-lock.yaml"));
  if (!bytes) throw new Error("A regular pnpm-lock.yaml is required for lock update.");
  const document = parseDocument(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
    uniqueKeys: true,
  });
  if (document.errors.length) throw new Error("Invalid pnpm lock YAML.");
  const lock = record(document.toJS({ maxAliasCount: 100 }));
  if (String(lock.lockfileVersion) !== "9.0")
    throw new Error("Only pnpm lockfileVersion 9.0 is supported.");
  const importer = record(record(lock.importers)["."]);
  const snapshots = record(lock.snapshots);
  const packages = new Map<string, PackageSnapshot>();
  const dependencyEntries = (input: Record<string, unknown>) =>
    Object.entries({
      ...record(input.dependencies ?? {}),
      ...record(input.optionalDependencies ?? {}),
    });
  const visit = async (
    specifier: string,
    version: string,
    modulesDirectory: string,
  ): Promise<ContentHash> => {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(specifier))
      throw new Error("Invalid dependency specifier.");
    const locator = Object.hasOwn(snapshots, `${specifier}@${version}`)
      ? `${specifier}@${version}`
      : version;
    if (
      !Object.hasOwn(snapshots, locator) ||
      /file:(?:\/|[A-Za-z]:|.*(?:^|\/)\.\.(?:\/|$))/.test(locator) ||
      locator.includes("link:") ||
      locator.startsWith("/")
    )
      throw new Error("Dependency must resolve to a fixed pnpm snapshot locator.");
    const key = hashPackageLocator(locator);
    if (packages.has(locator)) return key;
    const packageRoot = await realpath(join(modulesDirectory, specifier));
    if (!packageRoot.startsWith(`${projectRoot}/node_modules/`))
      throw new Error("Installed package must remain inside the project node_modules snapshot.");
    const files = await packageFiles(packageRoot);
    const manifestFile = files.find((f) => f.path === "package.json");
    if (!manifestFile || manifestFile.encoding !== "utf8")
      throw new Error("Package manifest is missing.");
    const parsedManifest = parseStrictJson(new TextEncoder().encode(manifestFile.data));
    if (!parsedManifest.ok) throw new Error("Invalid package manifest JSON.");
    const manifest = record(parsedManifest.value);
    const name = text(manifest.name);
    const actualVersion = text(manifest.version);
    const archive = locator.includes("@file:") && locator.endsWith(".tgz");
    const packageRecord = archive ? record(record(lock.packages)[locator]) : undefined;
    if (
      archive
        ? !locator.startsWith(`${name}@file:`) || packageRecord?.version !== actualVersion
        : locator !== `${name}@${actualVersion}` && !locator.startsWith(`${name}@${actualVersion}(`)
    )
      throw new Error(
        `Installed package ${name}@${actualVersion} does not match pnpm locator ${locator}.`,
      );
    let exports: PackageSnapshot["exports"];
    try {
      exports = resolvePackageExportTargets(
        manifest,
        files.map((f) => f.path),
      );
    } catch (error) {
      throw new Error(
        `Package ${name}@${actualVersion}: ${error instanceof Error ? error.message : "export resolution failed"}`,
      );
    }
    const item: PackageSnapshot = {
      key,
      locator,
      name,
      version: actualVersion,
      files,
      exports,
      dependencies: [],
      contentIntegrity: "sha256:",
    };
    packages.set(locator, item);
    const snapshot = record(snapshots[locator]);
    for (const [dependency, value] of dependencyEntries(snapshot)) {
      const usage = dependency.startsWith("@types/") ? "types" : "runtime";
      item.dependencies.push({
        specifier: typeSpecifier(dependency),
        usage,
        packageKey: await visit(dependency, text(value), packageRoot.slice(0, -name.length - 1)),
      });
    }
    item.dependencies.sort((a, b) =>
      compare(`${a.specifier}\0${a.usage}`, `${b.specifier}\0${b.usage}`),
    );
    item.contentIntegrity = hashLockedPackageContent(item);
    return key;
  };
  const rootDependencies: LockedDependency[] = [];
  const roots = {
    ...record(importer.dependencies ?? {}),
    ...record(importer.devDependencies ?? {}),
    ...record(importer.optionalDependencies ?? {}),
  };
  for (const [specifier, input] of Object.entries(roots)) {
    rootDependencies.push({
      specifier: typeSpecifier(specifier),
      usage: specifier.startsWith("@types/") ? "types" : "runtime",
      packageKey: await visit(
        specifier,
        text(record(input).version),
        join(projectRoot, "node_modules"),
      ),
    });
  }
  rootDependencies.sort((a, b) =>
    compare(`${a.specifier}\0${a.usage}`, `${b.specifier}\0${b.usage}`),
  );
  return {
    packageManagerLockHash: digestBytes(bytes),
    rootDependencies,
    packages: [...packages.values()].sort((a, b) => compare(a.key, b.key)),
  };
};

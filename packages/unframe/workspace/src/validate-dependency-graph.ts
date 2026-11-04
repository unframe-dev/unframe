import { createHash } from "node:crypto";
import { z } from "zod";
import {
  hashPackageLocator,
  hashLockedPackageContent,
  type InstalledDependencyGraph,
  type ContentHash,
} from "./dependency-graph.js";
import { mediaTypeFor } from "./package-files.js";
const hash = z.templateLiteral(["sha256:", z.string().regex(/^[0-9a-f]{64}$/u)]);
const nonempty = z.string().min(1);
const path = nonempty.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
);
const subpath = z
  .string()
  .refine(
    (value) => value === "." || (value.startsWith("./") && path.safeParse(value.slice(2)).success),
  );
const noProto = z
  .unknown()
  .refine(
    (value) =>
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Object.hasOwn(value, "__proto__"),
  );
const strict = <T extends z.core.$ZodShape>(shape: T) => noProto.pipe(z.strictObject(shape));
const edge = strict({ specifier: nonempty, usage: z.enum(["runtime", "types"]), packageKey: hash });
const lockedFile = z.union([
  strict({ path, mediaType: nonempty, hash, encoding: z.literal("utf8"), data: z.string() }),
  strict({ path, mediaType: nonempty, hash, encoding: z.literal("base64"), data: z.string() }),
]);
const packageExport = strict({
  subpath,
  runtimeImport: path.nullable(),
  runtimeRequire: path.nullable(),
  types: path.nullable(),
}).refine(
  (value) => value.runtimeImport !== null || value.runtimeRequire !== null || value.types !== null,
);
const pkg = strict({
  key: hash,
  locator: nonempty,
  name: nonempty,
  version: nonempty,
  contentIntegrity: hash,
  files: z.array(lockedFile),
  exports: z.array(packageExport),
  dependencies: z.array(edge),
});

const graph = strict({ rootDependencies: z.array(edge), packages: z.array(pkg) });
const orderedUnique = <T>(items: readonly T[], key: (item: T) => string) =>
  items.every((item, index) => index === 0 || key(items[index - 1]!) < key(item));
const edgeKey = (item: { specifier: string; usage: string }) => `${item.specifier}\0${item.usage}`;
const fail = (message: string): never => {
  throw new Error(message);
};
export const validateDependencyGraph = (input: unknown): InstalledDependencyGraph => {
  const parsed = graph.safeParse(input);
  if (!parsed.success) return fail("Installed dependency graph shape is invalid.");
  const result = parsed.data;
  if (
    !orderedUnique(result.rootDependencies, edgeKey) ||
    !orderedUnique(result.packages, (item) => item.key)
  )
    return fail("Installed dependency graph entries must be sorted and unique.");
  const packages = new Map(result.packages.map((item) => [item.key, item]));
  for (const item of result.packages) {
    if (item.key !== hashPackageLocator(item.locator))
      return fail("Package identity does not match its locator.");
    if (
      !orderedUnique(item.files, (file) => file.path) ||
      !orderedUnique(item.exports, (entry) => entry.subpath) ||
      !orderedUnique(item.dependencies, edgeKey)
    )
      return fail("Package snapshot entries must be sorted and unique.");
    for (const file of item.files) {
      const mediaType = mediaTypeFor(file.path);
      const encoding =
        mediaType.startsWith("text/") || mediaType === "application/json" ? "utf8" : "base64";
      if (file.mediaType !== mediaType || file.encoding !== encoding)
        return fail("Package file media type and encoding must match its path.");
      if (
        file.encoding === "base64" &&
        (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.data) ||
          Buffer.from(file.data, "base64").toString("base64") !== file.data)
      )
        return fail("Package file base64 bytes are invalid.");
      const bytes =
        file.encoding === "utf8"
          ? new TextEncoder().encode(file.data)
          : Buffer.from(file.data, "base64");
      if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== file.hash)
        return fail("Package file bytes do not match their hash.");
    }
    const paths = new Set(item.files.map((file) => file.path));
    if (
      item.exports.some((entry) =>
        [entry.runtimeImport, entry.runtimeRequire, entry.types].some(
          (target) => target !== null && !paths.has(target),
        ),
      )
    )
      return fail("Package exports must target snapshot files.");
    if (item.contentIntegrity !== hashLockedPackageContent(item))
      return fail("Package content integrity does not match its bytes.");
  }
  if (
    [...result.rootDependencies, ...result.packages.flatMap((item) => item.dependencies)].some(
      (edge) => !packages.has(edge.packageKey),
    )
  )
    return fail("Every dependency edge must resolve to a snapshot package.");
  const reachable = new Set<string>();
  const visit = (key: ContentHash): void => {
    if (reachable.has(key)) return;
    reachable.add(key);
    for (const edge of packages.get(key)!.dependencies) visit(edge.packageKey);
  };
  for (const edge of result.rootDependencies) visit(edge.packageKey);
  if (reachable.size !== packages.size)
    return fail("Every package must be reachable from a root dependency.");
  return result;
};

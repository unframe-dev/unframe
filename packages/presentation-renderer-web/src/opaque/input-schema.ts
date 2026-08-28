import * as z from "zod";

export const opaqueRendererModuleTypeSchema = z.enum([
  "asset",
  "css",
  "js",
  "jsx",
  "json",
  "ts",
  "tsx",
]);
export type OpaqueRendererModuleType = z.output<typeof opaqueRendererModuleTypeSchema>;
type SourceModuleType = Exclude<OpaqueRendererModuleType, "asset">;

const assetExtensions = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);
const sourceTypeExtensions: Record<SourceModuleType, ReadonlySet<string>> = {
  css: new Set([".css"]),
  js: new Set([".js"]),
  jsx: new Set([".jsx"]),
  json: new Set([".json"]),
  ts: new Set([".ts"]),
  tsx: new Set([".tsx"]),
};
const deniedConfigPattern = /(?:^|\/)(?:postcss|rolldown|tailwind|vite)\.config\.[^/]+$/;

export const extensionOf = (path: string) => {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "" : fileName.slice(index).toLowerCase();
};

const modulePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes(":") &&
      !path.includes("?") &&
      !path.includes("#") &&
      !deniedConfigPattern.test(path) &&
      path
        .split("/")
        .every(
          (segment) =>
            segment.length > 0 && segment !== "." && segment !== ".." && segment !== "node_modules",
        ),
  );

export const opaqueRendererModuleSchema = z
  .strictObject({
    path: modulePathSchema,
    source: z.string(),
    moduleType: opaqueRendererModuleTypeSchema,
  })
  .superRefine((module, context) => {
    const extension = extensionOf(module.path);
    const valid =
      module.moduleType === "asset"
        ? assetExtensions.has(extension)
        : sourceTypeExtensions[module.moduleType].has(extension);
    if (!valid)
      context.addIssue({
        code: "custom",
        path: ["moduleType"],
        message: "Module type must match the module path extension.",
      });
  });

export const opaqueRendererBundleInputSchema = z
  .strictObject({
    entry: modulePathSchema,
    modules: z.array(opaqueRendererModuleSchema).min(1),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, module] of input.modules.entries()) {
      if (seen.has(module.path))
        context.addIssue({
          code: "custom",
          path: ["modules", index, "path"],
          message: "Module paths must be unique.",
        });
      seen.add(module.path);
    }
    const entryIndex = input.modules.findIndex((module) => module.path === input.entry);
    if (entryIndex < 0) {
      context.addIssue({
        code: "custom",
        path: ["entry"],
        message: "Entry must identify a locked package module.",
      });
      return;
    }
    const entry = input.modules[entryIndex];
    if (entry?.moduleType === "asset" || entry?.moduleType === "css")
      context.addIssue({
        code: "custom",
        path: ["modules", entryIndex, "moduleType"],
        message: "Entry must be an executable source module.",
      });
  });

export type ParsedOpaqueRendererBundleInput = z.output<typeof opaqueRendererBundleInputSchema>;

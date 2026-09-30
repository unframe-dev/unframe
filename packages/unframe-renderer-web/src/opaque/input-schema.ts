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
export type SourceModuleType = Exclude<OpaqueRendererModuleType, "asset">;

const assetExtensions = new Set([".jpeg", ".jpg", ".png", ".webp", ".ttf", ".otf"]);
const sourceTypeExtensions: Record<SourceModuleType, ReadonlySet<string>> = {
  css: new Set([".css"]),
  js: new Set([".js", ".cjs", ".mjs"]),
  json: new Set([".json"]),
  jsx: new Set([".jsx"]),
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

const assetModuleSchema = z
  .strictObject({
    moduleType: z.literal("asset"),
    path: modulePathSchema,
    source: z.union([z.string(), z.instanceof(Uint8Array)]),
  })
  .superRefine((module, context) => {
    const extension = extensionOf(module.path);
    if (!assetExtensions.has(extension)) {
      context.addIssue({
        code: "custom",
        message: "Module type must match the module path extension.",
        path: ["moduleType"],
      });
    }
  });

const sourceModuleSchema = z
  .strictObject({
    moduleType: z.enum(["css", "js", "jsx", "json", "ts", "tsx"]),
    path: modulePathSchema,
    source: z.string(),
  })
  .superRefine((module, context) => {
    if (!sourceTypeExtensions[module.moduleType].has(extensionOf(module.path))) {
      context.addIssue({
        code: "custom",
        message: "Module type must match the module path extension.",
        path: ["moduleType"],
      });
    }
  });

export const opaqueRendererModuleSchema = z.union([assetModuleSchema, sourceModuleSchema]);

const resolutionSchema = z.strictObject({
  importerPath: modulePathSchema,
  kind: z.enum(["import", "require"]),
  specifier: z.string().min(1),
  targetPath: modulePathSchema,
});

export const opaqueRendererBundleInputSchema = z
  .strictObject({
    entry: modulePathSchema,
    modules: z.array(opaqueRendererModuleSchema).min(1),
    rendererInputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    resolutions: z.array(resolutionSchema),
    stylesheets: z.array(modulePathSchema),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, module] of input.modules.entries()) {
      if (seen.has(module.path)) {
        context.addIssue({
          code: "custom",
          message: "Module paths must be unique.",
          path: ["modules", index, "path"],
        });
      }
      seen.add(module.path);
    }
    const resolved = new Set<string>();
    for (const [index, resolution] of input.resolutions.entries()) {
      const key = `${resolution.importerPath}\0${resolution.specifier}\0${resolution.kind}`;
      if (resolved.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Resolution must be unique.",
          path: ["resolutions", index],
        });
      }
      resolved.add(key);
      if (
        resolution.importerPath !== "__unframe__/bootstrap.ts" &&
        !seen.has(resolution.importerPath)
      ) {
        context.addIssue({
          code: "custom",
          message: "Resolution importer must be a locked module.",
          path: ["resolutions", index, "importerPath"],
        });
      }
      if (!seen.has(resolution.targetPath)) {
        context.addIssue({
          code: "custom",
          message: "Resolved target must be locked.",
          path: ["resolutions", index, "targetPath"],
        });
      }
    }
    const stylesheetSet = new Set<string>();
    for (const [index, path] of input.stylesheets.entries()) {
      if (
        stylesheetSet.has(path) ||
        input.modules.find((item) => item.path === path)?.moduleType !== "css"
      ) {
        context.addIssue({
          code: "custom",
          message: "Stylesheet must name a unique locked CSS module.",
          path: ["stylesheets", index],
        });
      }
      stylesheetSet.add(path);
    }
    const entryIndex = input.modules.findIndex((module) => module.path === input.entry);
    if (entryIndex < 0) {
      context.addIssue({
        code: "custom",
        message: "Entry must identify a locked package module.",
        path: ["entry"],
      });
      return;
    }
    const entry = input.modules[entryIndex];
    if (entry?.moduleType === "asset" || entry?.moduleType === "css") {
      context.addIssue({
        code: "custom",
        message: "Entry must be an executable source module.",
        path: ["modules", entryIndex, "moduleType"],
      });
    }
  });

type DeepReadonly<T> = T extends Uint8Array
  ? Uint8Array
  : T extends ReadonlyArray<unknown>
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type OpaqueRendererModule = DeepReadonly<z.input<typeof opaqueRendererModuleSchema>>;
export type OpaqueRendererBundleInput = DeepReadonly<
  z.input<typeof opaqueRendererBundleInputSchema>
>;
export type ParsedOpaqueRendererBundleInput = z.output<typeof opaqueRendererBundleInputSchema>;

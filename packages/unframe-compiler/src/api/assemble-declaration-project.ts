import { z } from "zod";
import type {
  ComponentManifest,
  ComponentStructure,
  StaticComponentMetadata,
  ThemeDeclaration,
} from "@unframe/unframe-authoring";
import {
  isComponentManifest,
  isComponentStructure,
  isThemeDeclaration,
} from "@unframe/unframe-authoring";
import type { Diagnostic, ValidationResult } from "@unframe/unframe-core";
import { sortDiagnostics, diagnostic } from "../diagnostics/diagnostics.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { resolveAuthoringStructurePath } from "../project/pair-authoring-declarations.js";
import { checkDeclarationProject } from "./check-declaration-project.js";
import {
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
} from "../semantic/declaration-hashes.js";
import type { CheckedDeclarationProject, CompilerDeclarationProject } from "./types.js";

const nonEmptyStringSchema = z.string().min(1);
const sourceOriginSchema = z
  .object({
    fileName: nonEmptyStringSchema,
    start: z.int().nonnegative(),
    end: z.int().nonnegative(),
    line: z.int().positive(),
    column: z.int().positive(),
  })
  .strict()
  .refine((value) => value.end >= value.start);
const sourceMapEntrySchema = z
  .object({
    path: z.array(z.union([z.string(), z.int().nonnegative()])),
    origin: sourceOriginSchema,
    keyOrigin: sourceOriginSchema.optional(),
  })
  .strict();
const catalogValueSchema = (
  role: "presentation" | "theme" | "component-manifest" | "component-structure",
  rootBuilder:
    | "definePresentation"
    | "defineTheme"
    | "defineComponentManifest"
    | "defineComponentStructure",
) =>
  z
    .object({
      role: z.literal(role),
      fileName: nonEmptyStringSchema,
      rootBuilder: z.literal(rootBuilder),
      value: z.unknown(),
      sourceMap: z.array(sourceMapEntrySchema),
    })
    .strict();
const presentationCatalogSchema = catalogValueSchema("presentation", "definePresentation");
const themeCatalogSchema = catalogValueSchema("theme", "defineTheme");
const manifestCatalogSchema = catalogValueSchema("component-manifest", "defineComponentManifest");
const structureCatalogSchema = catalogValueSchema(
  "component-structure",
  "defineComponentStructure",
);
const componentCatalogSchema = z.union([
  z.object({ manifest: manifestCatalogSchema, structure: structureCatalogSchema }).strict(),
  z
    .object({
      manifest: manifestCatalogSchema,
      metadata: z.unknown(),
      rendererEntry: nonEmptyStringSchema,
      renderer: z
        .object({
          entrySource: z.string(),
          localDependencies: z.array(nonEmptyStringSchema),
          packageImports: z.array(nonEmptyStringSchema),
          renderOrigin: sourceOriginSchema,
          helperOrigins: z.array(sourceOriginSchema),
        })
        .strict(),
    })
    .strict(),
]);
const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const localOriginSchema = z
  .object({
    kind: z.literal("local"),
    entryFile: nonEmptyStringSchema,
    files: z.array(z.object({ path: nonEmptyStringSchema, hash: contentHashSchema }).strict()),
    sourceHash: contentHashSchema,
  })
  .strict();
const packageOriginSchema = z
  .object({
    kind: z.literal("package"),
    packageKey: contentHashSchema,
    subpath: nonEmptyStringSchema,
  })
  .strict();
const lockBase = {
  componentId: nonEmptyStringSchema,
  version: z.int().positive(),
  origin: z.union([localOriginSchema, packageOriginSchema]),
  manifestHash: contentHashSchema,
};
const componentLockSchema = z.union([
  z
    .object({ ...lockBase, mode: z.literal("structured"), structureHash: contentHashSchema })
    .strict(),
  z
    .object({ ...lockBase, mode: z.literal("opaque"), rendererInputHash: contentHashSchema })
    .strict(),
]);
const assetCarrierSchema = z
  .object({
    id: nonEmptyStringSchema,
    mediaType: z.enum(["font/ttf", "font/otf"]),
    checksum: nonEmptyStringSchema,
    encodedSizeBytes: z.int().nonnegative(),
    dataBase64: z.string(),
  })
  .strict();
const assemblyInputSchema = z
  .object({
    catalog: z
      .object({
        presentation: presentationCatalogSchema,
        themes: z.array(themeCatalogSchema),
        components: z.array(componentCatalogSchema),
      })
      .strict(),
    themeHashes: z.array(
      z.object({ themeId: nonEmptyStringSchema, hash: nonEmptyStringSchema }).strict(),
    ),
    componentLocks: z.array(componentLockSchema),
    assets: z.record(z.string(), assetCarrierSchema),
  })
  .strict();

type AssemblyInput = z.output<typeof assemblyInputSchema>;
type ThemeEntry = { readonly id: string; readonly declaration: ThemeDeclaration };
type ComponentEntry = {
  readonly componentId: string;
  readonly version: number;
  readonly manifest: ComponentManifest;
} & (
  | { readonly mode: "structured"; readonly structure: ComponentStructure }
  | {
      readonly mode: "opaque";
      readonly metadata: StaticComponentMetadata;
      readonly rendererEntry: string;
      readonly rendererSource: string;
    }
);

const assemblyEnvelopeDiagnostics = (issues: readonly z.core.$ZodIssue[]): Diagnostic[] => {
  const diagnostics = issues.map((issue) => {
    const [section, entry] = issue.path;
    if (section === "themeHashes")
      return diagnostic(
        "compiler-invalid-theme-hash-entry",
        ["themeHashes", typeof entry === "number" ? entry : 0],
        "Theme hash entries require a non-empty theme ID and hash.",
      );
    if (section === "componentLocks")
      return diagnostic(
        "compiler-invalid-component-lock-entry",
        ["componentLocks", typeof entry === "number" ? entry : 0],
        "Component lock entries require an identity and complete non-empty lock.",
      );
    if (section === "assets")
      return diagnostic(
        "compiler-invalid-asset",
        ["assets", typeof entry === "string" ? entry : ""],
        "Asset carrier entries must use string keys and plain JSON values.",
      );
    if (section === "catalog") {
      const [catalogSection, catalogEntry] = issue.path.slice(1);
      if (catalogSection === "presentation")
        return diagnostic(
          "compiler-invalid-catalog-presentation",
          ["catalog", "presentation"],
          "Presentation catalog wrapper must be complete and provenance-safe.",
        );
      if (catalogSection === "themes")
        return diagnostic(
          "compiler-invalid-catalog-theme-entry",
          ["catalog", "themes", typeof catalogEntry === "number" ? catalogEntry : 0],
          "Theme catalog wrappers must be complete and provenance-safe.",
        );
      if (catalogSection === "components")
        return diagnostic(
          "compiler-invalid-catalog-component-entry",
          ["catalog", "components", typeof catalogEntry === "number" ? catalogEntry : 0],
          "Component catalog wrappers must be complete and provenance-safe.",
        );
    }
    return diagnostic("compiler-invalid-input", [], "Assembly input is malformed.");
  });
  return sortDiagnostics([
    ...new Map(
      diagnostics.map((item) => [`${item.code}\u0000${item.path.join("/")}`, item]),
    ).values(),
  ]);
};

const keyForComponent = (componentId: string, version: number) => `${componentId}\u0000${version}`;
const byString = <T extends { readonly id: string }>(left: T, right: T) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
const byComponent = (left: ComponentEntry, right: ComponentEntry) =>
  left.componentId < right.componentId
    ? -1
    : left.componentId > right.componentId
      ? 1
      : left.version - right.version;
const canonicalRecord = <T>(value: Readonly<Record<string, T>>): Readonly<Record<string, T>> =>
  Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]!]),
  ) as Readonly<Record<string, T>>;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const collectThemes = (input: AssemblyInput, diagnostics: Diagnostic[]): ThemeEntry[] =>
  input.catalog.themes.map((candidate, index) => {
    const id = record(candidate.value)?.id;
    if (typeof id !== "string" || id.length === 0) {
      diagnostics.push(
        diagnostic(
          "compiler-theme-hash-identity-mismatch",
          ["catalog", "themes", index],
          "Theme declarations must expose a non-empty ID for hash pairing.",
        ),
      );
      return { id: `\u0000${index}`, declaration: candidate.value as ThemeDeclaration };
    }
    return { id, declaration: candidate.value as ThemeDeclaration };
  });

const collectComponents = (input: AssemblyInput, diagnostics: Diagnostic[]): ComponentEntry[] =>
  input.catalog.components.map((candidate, index) => {
    const manifest = record(candidate.manifest.value);
    const structure = "structure" in candidate ? record(candidate.structure.value) : undefined;
    const componentId = manifest?.componentId;
    const rawVersion = manifest?.version;
    const version =
      typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion > 0
        ? rawVersion
        : undefined;
    if (typeof componentId !== "string" || componentId.length === 0 || version === undefined) {
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-identity-mismatch",
          ["catalog", "components", index],
          "Component manifests must expose a component ID and positive version for lock pairing.",
        ),
      );
      return {
        componentId: `\u0000${index}`,
        version: 0,
        manifest: candidate.manifest.value as ComponentManifest,
        ...("structure" in candidate
          ? {
              mode: "structured" as const,
              structure: candidate.structure.value as ComponentStructure,
            }
          : {
              mode: "opaque" as const,
              metadata: candidate.metadata as StaticComponentMetadata,
              rendererEntry: candidate.rendererEntry,
              rendererSource: candidate.renderer.entrySource,
            }),
      };
    }
    if ("structure" in candidate && structure?.componentId !== componentId)
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-identity-mismatch",
          ["catalog", "components", index, "structure"],
          "Component structure must use the manifest component ID.",
        ),
      );
    const authoring = record(manifest?.authoring);
    if (authoring?.mode === "opaque" && "structure" in candidate)
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-mode-mismatch",
          ["catalog", "components", index],
          "Opaque Component catalog entries require metadata and renderer entry.",
        ),
      );
    if (authoring?.mode === "structured" && !("structure" in candidate))
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-mode-mismatch",
          ["catalog", "components", index],
          "Structured Component catalog entries require a structure.",
        ),
      );
    if (authoring?.mode === "structured") {
      const expectedStructurePath =
        typeof authoring.structure === "string"
          ? resolveAuthoringStructurePath(candidate.manifest.fileName, authoring.structure)
          : undefined;
      if ("structure" in candidate && expectedStructurePath !== candidate.structure.fileName)
        diagnostics.push(
          diagnostic(
            "compiler-component-structure-path-mismatch",
            ["catalog", "components", index, "structure", "fileName"],
            "Component structure file must exactly match the manifest authoring.structure path.",
          ),
        );
    }
    return {
      componentId,
      version,
      manifest: candidate.manifest.value as ComponentManifest,
      ...("structure" in candidate
        ? {
            mode: "structured" as const,
            structure: candidate.structure.value as ComponentStructure,
          }
        : {
            mode: "opaque" as const,
            metadata: candidate.metadata as StaticComponentMetadata,
            rendererEntry: candidate.rendererEntry,
            rendererSource: candidate.renderer.entrySource,
          }),
    };
  });

const duplicateDiagnostics = <T>(
  values: readonly T[],
  key: (value: T) => string,
  path: readonly (string | number)[],
  code: string,
  message: string,
  diagnostics: Diagnostic[],
) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const identity = key(value);
    if (seen.has(identity)) diagnostics.push(diagnostic(code, [...path, index], message));
    seen.add(identity);
  });
};

/** Assembles source-free compiler declarations from a checked Authoring catalog and explicit carriers. */
export const assembleDeclarationProjectValidated = (
  input: unknown,
): ValidationResult<{
  project: CompilerDeclarationProject;
  checked: CheckedDeclarationProject;
}> => {
  const snapshot = safePlainClone(input);
  if (!snapshot.valid) return snapshot;
  const parsed = assemblyInputSchema.safeParse(snapshot.value);
  if (!parsed.success)
    return { valid: false, diagnostics: assemblyEnvelopeDiagnostics(parsed.error.issues) };

  const value = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const themes = collectThemes(value, diagnostics);
  const components = collectComponents(value, diagnostics);
  duplicateDiagnostics(
    themes,
    (item) => item.id,
    ["catalog", "themes"],
    "compiler-theme-hash-duplicate",
    "Theme declarations must resolve exactly once.",
    diagnostics,
  );
  duplicateDiagnostics(
    value.themeHashes,
    (item) => item.themeId,
    ["themeHashes"],
    "compiler-theme-hash-duplicate",
    "Theme hash entries must resolve exactly once.",
    diagnostics,
  );
  duplicateDiagnostics(
    components,
    (item) => keyForComponent(item.componentId, item.version),
    ["catalog", "components"],
    "compiler-component-lock-duplicate",
    "Component declarations must resolve exactly once.",
    diagnostics,
  );
  duplicateDiagnostics(
    value.componentLocks,
    (item) => keyForComponent(item.componentId, item.version),
    ["componentLocks"],
    "compiler-component-lock-duplicate",
    "Component lock entries must resolve exactly once.",
    diagnostics,
  );

  const themeHashes = new Map(
    value.themeHashes.map((item, index) => [item.themeId, { item, index }]),
  );
  const catalogThemeIds = new Set(themes.map((item) => item.id));
  themes.forEach((theme, index) => {
    if (!themeHashes.has(theme.id))
      diagnostics.push(
        diagnostic(
          "compiler-theme-hash-missing",
          ["catalog", "themes", index],
          "Every Theme declaration requires exactly one hash entry.",
        ),
      );
  });
  value.themeHashes.forEach((entry, index) => {
    if (!catalogThemeIds.has(entry.themeId))
      diagnostics.push(
        diagnostic(
          "compiler-theme-hash-extra",
          ["themeHashes", index],
          "Theme hash entries must reference a catalog Theme declaration.",
        ),
      );
  });

  themes.forEach((theme) => {
    const entry = themeHashes.get(theme.id);
    if (
      entry !== undefined &&
      isThemeDeclaration(theme.declaration) &&
      entry.item.hash !== hashThemeDeclaration(theme.declaration)
    )
      diagnostics.push(
        diagnostic(
          "compiler-theme-hash-mismatch",
          ["themeHashes", entry.index],
          "Theme hash must match the declaration semantic payload.",
        ),
      );
  });

  const locks = new Map(
    value.componentLocks.map((item, index) => [
      keyForComponent(item.componentId, item.version),
      { item, index },
    ]),
  );
  const catalogComponentKeys = new Set(
    components.map((item) => keyForComponent(item.componentId, item.version)),
  );
  components.forEach((component, index) => {
    const exactKey = keyForComponent(component.componentId, component.version);
    if (!locks.has(exactKey)) {
      const hasSameComponent = value.componentLocks.some(
        (lock) => lock.componentId === component.componentId,
      );
      diagnostics.push(
        diagnostic(
          hasSameComponent
            ? "compiler-component-lock-identity-mismatch"
            : "compiler-component-lock-missing",
          ["catalog", "components", index],
          hasSameComponent
            ? "Component lock identity must match the manifest component ID and version."
            : "Every Component declaration requires exactly one lock entry.",
        ),
      );
    }
  });
  value.componentLocks.forEach((entry, index) => {
    if (!catalogComponentKeys.has(keyForComponent(entry.componentId, entry.version)))
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-extra",
          ["componentLocks", index],
          "Component lock entries must reference a catalog Component declaration.",
        ),
      );
  });
  components.forEach((component) => {
    const entry = locks.get(keyForComponent(component.componentId, component.version));
    if (entry === undefined) return;
    const lock = entry.item;
    if (lock.mode !== component.mode)
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-mode-mismatch",
          ["componentLocks", entry.index, "mode"],
          "Component lock mode must match its catalog entry.",
        ),
      );
    if (
      isComponentManifest(component.manifest) &&
      lock.manifestHash !== hashComponentManifestDeclaration(component.manifest)
    )
      diagnostics.push(
        diagnostic(
          "compiler-component-manifest-hash-mismatch",
          ["componentLocks", entry.index, "manifestHash"],
          "Component manifest hash must match the declaration semantic payload.",
        ),
      );
    if (
      component.mode === "structured" &&
      lock.mode === "structured" &&
      isComponentStructure(component.structure) &&
      lock.structureHash !== hashComponentStructureDeclaration(component.structure)
    )
      diagnostics.push(
        diagnostic(
          "compiler-component-structure-hash-mismatch",
          ["componentLocks", entry.index, "structureHash"],
          "Component structure hash must match the declaration semantic payload.",
        ),
      );
  });
  if (diagnostics.length > 0) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };

  const project: CompilerDeclarationProject = {
    presentation: value.catalog.presentation.value as CompilerDeclarationProject["presentation"],
    themes: themes.sort(byString).map((theme) => ({
      declaration: theme.declaration as CompilerDeclarationProject["themes"][number]["declaration"],
      hash: themeHashes.get(theme.id)!.item.hash,
    })),
    components: components.sort(byComponent).map((component) => {
      const {
        componentId: _componentId,
        version: _version,
        ...lock
      } = locks.get(keyForComponent(component.componentId, component.version))!.item;
      return component.mode === "structured"
        ? {
            manifest: component.manifest,
            structure: component.structure,
            lock: lock as Extract<
              CompilerDeclarationProject["components"][number]["lock"],
              { mode: "structured" }
            >,
          }
        : {
            manifest: component.manifest,
            metadata: component.metadata,
            rendererEntry: component.rendererEntry,
            rendererSource: component.rendererSource,
            lock: lock as Extract<
              CompilerDeclarationProject["components"][number]["lock"],
              { mode: "opaque" }
            >,
          };
    }) as CompilerDeclarationProject["components"],
    assets: canonicalRecord(
      value.assets as CompilerDeclarationProject["assets"],
    ) as CompilerDeclarationProject["assets"],
  };
  const checked = checkDeclarationProject(project);
  return checked.valid
    ? { valid: true as const, value: { project, checked: checked.value }, diagnostics: [] as const }
    : checked;
};

export const assembleDeclarationProject = (
  input: unknown,
): ValidationResult<CompilerDeclarationProject> => {
  const result = assembleDeclarationProjectValidated(input);
  return result.valid ? { valid: true, value: result.value.project, diagnostics: [] } : result;
};

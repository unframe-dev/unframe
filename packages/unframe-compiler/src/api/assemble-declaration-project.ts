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
    column: z.int().positive(),
    end: z.int().nonnegative(),
    fileName: nonEmptyStringSchema,
    line: z.int().positive(),
    start: z.int().nonnegative(),
  })
  .strict()
  .refine((value) => value.end >= value.start);
const sourceMapEntrySchema = z
  .object({
    keyOrigin: sourceOriginSchema.optional(),
    origin: sourceOriginSchema,
    path: z.array(z.union([z.string(), z.int().nonnegative()])),
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
      fileName: nonEmptyStringSchema,
      role: z.literal(role),
      rootBuilder: z.literal(rootBuilder),
      sourceMap: z.array(sourceMapEntrySchema),
      value: z.unknown(),
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
      renderer: z
        .object({
          entrySource: z.string(),
          helperOrigins: z.array(sourceOriginSchema),
          localDependencies: z.array(nonEmptyStringSchema),
          packageImports: z.array(nonEmptyStringSchema),
          renderOrigin: sourceOriginSchema,
        })
        .strict(),
      rendererEntry: nonEmptyStringSchema,
    })
    .strict(),
]);
const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const localOriginSchema = z
  .object({
    entryFile: nonEmptyStringSchema,
    files: z.array(z.object({ hash: contentHashSchema, path: nonEmptyStringSchema }).strict()),
    kind: z.literal("local"),
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
  manifestHash: contentHashSchema,
  origin: z.union([localOriginSchema, packageOriginSchema]),
  version: z.int().positive(),
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
    checksum: nonEmptyStringSchema,
    dataBase64: z.string(),
    encodedSizeBytes: z.int().nonnegative(),
    id: nonEmptyStringSchema,
    mediaType: z.enum(["font/ttf", "font/otf"]),
  })
  .strict();
const assemblyInputSchema = z
  .object({
    assets: z.record(z.string(), assetCarrierSchema),
    catalog: z
      .object({
        components: z.array(componentCatalogSchema),
        presentation: presentationCatalogSchema,
        themes: z.array(themeCatalogSchema),
      })
      .strict(),
    componentLocks: z.array(componentLockSchema),
    themeHashes: z.array(
      z.object({ hash: nonEmptyStringSchema, themeId: nonEmptyStringSchema }).strict(),
    ),
  })
  .strict();

type AssemblyInput = z.output<typeof assemblyInputSchema>;
type ThemeEntry = { readonly declaration: ThemeDeclaration; readonly id: string };
type ComponentEntry = {
  readonly componentId: string;
  readonly manifest: ComponentManifest;
  readonly version: number;
} & (
  | { readonly mode: "structured"; readonly structure: ComponentStructure }
  | {
      readonly metadata: StaticComponentMetadata;
      readonly mode: "opaque";
      readonly rendererEntry: string;
      readonly rendererSource: string;
    }
);

const assemblyEnvelopeDiagnostics = (
  issues: ReadonlyArray<z.core.$ZodIssue>,
): Array<Diagnostic> => {
  const diagnostics = issues.map((issue) => {
    const [section, entry] = issue.path;
    if (section === "themeHashes") {
      return diagnostic(
        "compiler-invalid-theme-hash-entry",
        ["themeHashes", typeof entry === "number" ? entry : 0],
        "Theme hash entries require a non-empty theme ID and hash.",
      );
    }
    if (section === "componentLocks") {
      return diagnostic(
        "compiler-invalid-component-lock-entry",
        ["componentLocks", typeof entry === "number" ? entry : 0],
        "Component lock entries require an identity and complete non-empty lock.",
      );
    }
    if (section === "assets") {
      return diagnostic(
        "compiler-invalid-asset",
        ["assets", typeof entry === "string" ? entry : ""],
        "Asset carrier entries must use string keys and plain JSON values.",
      );
    }
    if (section === "catalog") {
      const [catalogSection, catalogEntry] = issue.path.slice(1);
      if (catalogSection === "presentation") {
        return diagnostic(
          "compiler-invalid-catalog-presentation",
          ["catalog", "presentation"],
          "Presentation catalog wrapper must be complete and provenance-safe.",
        );
      }
      if (catalogSection === "themes") {
        return diagnostic(
          "compiler-invalid-catalog-theme-entry",
          ["catalog", "themes", typeof catalogEntry === "number" ? catalogEntry : 0],
          "Theme catalog wrappers must be complete and provenance-safe.",
        );
      }
      if (catalogSection === "components") {
        return diagnostic(
          "compiler-invalid-catalog-component-entry",
          ["catalog", "components", typeof catalogEntry === "number" ? catalogEntry : 0],
          "Component catalog wrappers must be complete and provenance-safe.",
        );
      }
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

const collectThemes = (input: AssemblyInput, diagnostics: Array<Diagnostic>): Array<ThemeEntry> =>
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
      return { declaration: candidate.value as ThemeDeclaration, id: `\u0000${index}` };
    }
    return { declaration: candidate.value as ThemeDeclaration, id };
  });

const collectComponents = (
  input: AssemblyInput,
  diagnostics: Array<Diagnostic>,
): Array<ComponentEntry> =>
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
        manifest: candidate.manifest.value as ComponentManifest,
        version: 0,
        ...("structure" in candidate
          ? {
              mode: "structured" as const,
              structure: candidate.structure.value as ComponentStructure,
            }
          : {
              metadata: candidate.metadata as StaticComponentMetadata,
              mode: "opaque" as const,
              rendererEntry: candidate.rendererEntry,
              rendererSource: candidate.renderer.entrySource,
            }),
      };
    }
    if ("structure" in candidate && structure?.componentId !== componentId) {
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-identity-mismatch",
          ["catalog", "components", index, "structure"],
          "Component structure must use the manifest component ID.",
        ),
      );
    }
    const authoring = record(manifest?.authoring);
    if (authoring?.mode === "opaque" && "structure" in candidate) {
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-mode-mismatch",
          ["catalog", "components", index],
          "Opaque Component catalog entries require metadata and renderer entry.",
        ),
      );
    }
    if (authoring?.mode === "structured" && !("structure" in candidate)) {
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-mode-mismatch",
          ["catalog", "components", index],
          "Structured Component catalog entries require a structure.",
        ),
      );
    }
    if (authoring?.mode === "structured") {
      const expectedStructurePath =
        typeof authoring.structure === "string"
          ? resolveAuthoringStructurePath(candidate.manifest.fileName, authoring.structure)
          : undefined;
      if ("structure" in candidate && expectedStructurePath !== candidate.structure.fileName) {
        diagnostics.push(
          diagnostic(
            "compiler-component-structure-path-mismatch",
            ["catalog", "components", index, "structure", "fileName"],
            "Component structure file must exactly match the manifest authoring.structure path.",
          ),
        );
      }
    }
    return {
      componentId,
      manifest: candidate.manifest.value as ComponentManifest,
      version,
      ...("structure" in candidate
        ? {
            mode: "structured" as const,
            structure: candidate.structure.value as ComponentStructure,
          }
        : {
            metadata: candidate.metadata as StaticComponentMetadata,
            mode: "opaque" as const,
            rendererEntry: candidate.rendererEntry,
            rendererSource: candidate.renderer.entrySource,
          }),
    };
  });

const duplicateDiagnostics = <T>(
  values: ReadonlyArray<T>,
  key: (value: T) => string,
  path: ReadonlyArray<string | number>,
  code: string,
  message: string,
  diagnostics: Array<Diagnostic>,
) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const identity = key(value);
    if (seen.has(identity)) {
      diagnostics.push(diagnostic(code, [...path, index], message));
    }
    seen.add(identity);
  });
};

/** Assembles source-free compiler declarations from a checked Authoring catalog and explicit carriers. */
export const assembleDeclarationProjectValidated = (
  input: unknown,
): ValidationResult<{
  checked: CheckedDeclarationProject;
  project: CompilerDeclarationProject;
}> => {
  const snapshot = safePlainClone(input);
  if (!snapshot.valid) {
    return snapshot;
  }
  const parsed = assemblyInputSchema.safeParse(snapshot.value);
  if (!parsed.success) {
    return { diagnostics: assemblyEnvelopeDiagnostics(parsed.error.issues), valid: false };
  }

  const value = parsed.data;
  const diagnostics: Array<Diagnostic> = [];
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
    value.themeHashes.map((item, index) => [item.themeId, { index, item }]),
  );
  const catalogThemeIds = new Set(themes.map((item) => item.id));
  themes.forEach((theme, index) => {
    if (!themeHashes.has(theme.id)) {
      diagnostics.push(
        diagnostic(
          "compiler-theme-hash-missing",
          ["catalog", "themes", index],
          "Every Theme declaration requires exactly one hash entry.",
        ),
      );
    }
  });
  value.themeHashes.forEach((entry, index) => {
    if (!catalogThemeIds.has(entry.themeId)) {
      diagnostics.push(
        diagnostic(
          "compiler-theme-hash-extra",
          ["themeHashes", index],
          "Theme hash entries must reference a catalog Theme declaration.",
        ),
      );
    }
  });

  themes.forEach((theme) => {
    const entry = themeHashes.get(theme.id);
    if (
      entry !== undefined &&
      isThemeDeclaration(theme.declaration) &&
      entry.item.hash !== hashThemeDeclaration(theme.declaration)
    ) {
      diagnostics.push(
        diagnostic(
          "compiler-theme-hash-mismatch",
          ["themeHashes", entry.index],
          "Theme hash must match the declaration semantic payload.",
        ),
      );
    }
  });

  const locks = new Map(
    value.componentLocks.map((item, index) => [
      keyForComponent(item.componentId, item.version),
      { index, item },
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
    if (!catalogComponentKeys.has(keyForComponent(entry.componentId, entry.version))) {
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-extra",
          ["componentLocks", index],
          "Component lock entries must reference a catalog Component declaration.",
        ),
      );
    }
  });
  components.forEach((component) => {
    const entry = locks.get(keyForComponent(component.componentId, component.version));
    if (entry === undefined) {
      return;
    }
    const lock = entry.item;
    if (lock.mode !== component.mode) {
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-mode-mismatch",
          ["componentLocks", entry.index, "mode"],
          "Component lock mode must match its catalog entry.",
        ),
      );
    }
    if (
      isComponentManifest(component.manifest) &&
      lock.manifestHash !== hashComponentManifestDeclaration(component.manifest)
    ) {
      diagnostics.push(
        diagnostic(
          "compiler-component-manifest-hash-mismatch",
          ["componentLocks", entry.index, "manifestHash"],
          "Component manifest hash must match the declaration semantic payload.",
        ),
      );
    }
    if (
      component.mode === "structured" &&
      lock.mode === "structured" &&
      isComponentStructure(component.structure) &&
      lock.structureHash !== hashComponentStructureDeclaration(component.structure)
    ) {
      diagnostics.push(
        diagnostic(
          "compiler-component-structure-hash-mismatch",
          ["componentLocks", entry.index, "structureHash"],
          "Component structure hash must match the declaration semantic payload.",
        ),
      );
    }
  });
  if (diagnostics.length > 0) {
    return { diagnostics: sortDiagnostics(diagnostics), valid: false };
  }

  const project: CompilerDeclarationProject = {
    assets: canonicalRecord(
      value.assets as CompilerDeclarationProject["assets"],
    ) as CompilerDeclarationProject["assets"],
    components: components.sort(byComponent).map((component) => {
      const {
        componentId: _componentId,
        version: _version,
        ...lock
      } = locks.get(keyForComponent(component.componentId, component.version))!.item;
      return component.mode === "structured"
        ? {
            lock: lock as Extract<
              CompilerDeclarationProject["components"][number]["lock"],
              { mode: "structured" }
            >,
            manifest: component.manifest,
            structure: component.structure,
          }
        : {
            lock: lock as Extract<
              CompilerDeclarationProject["components"][number]["lock"],
              { mode: "opaque" }
            >,
            manifest: component.manifest,
            metadata: component.metadata,
            rendererEntry: component.rendererEntry,
            rendererSource: component.rendererSource,
          };
    }) as CompilerDeclarationProject["components"],
    presentation: value.catalog.presentation.value as CompilerDeclarationProject["presentation"],
    themes: themes.sort(byString).map((theme) => ({
      declaration: theme.declaration as CompilerDeclarationProject["themes"][number]["declaration"],
      hash: themeHashes.get(theme.id)!.item.hash,
    })),
  };
  const checked = checkDeclarationProject(project);
  return checked.valid
    ? { diagnostics: [] as const, valid: true as const, value: { checked: checked.value, project } }
    : checked;
};

export const assembleDeclarationProject = (
  input: unknown,
): ValidationResult<CompilerDeclarationProject> => {
  const result = assembleDeclarationProjectValidated(input);
  return result.valid ? { diagnostics: [], valid: true, value: result.value.project } : result;
};

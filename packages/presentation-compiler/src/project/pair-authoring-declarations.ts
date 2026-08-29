import {
  isComponentManifest,
  isComponentStructure,
  isPresentationDeclaration,
  isThemeDeclaration,
  type ComponentManifest,
  type ComponentStructure,
  type PresentationDeclaration,
  type ThemeDeclaration,
} from "@unframe/presentation";
import type { DeclarationSourceOrigin } from "../lowering/lower-authoring-declaration.js";
import type {
  CollectedAuthoringDeclaration,
  CollectedAuthoringDeclarationsSuccess,
  DeclarationCollectionDiagnostic,
} from "./collect-authoring-declarations.js";

type TypedDeclaration<T> = CollectedAuthoringDeclaration & { readonly value: T };

export type PairedComponentDeclaration = {
  readonly manifest: TypedDeclaration<ComponentManifest>;
  readonly structure: TypedDeclaration<ComponentStructure>;
};

export type PairedAuthoringDeclarationCatalog = {
  readonly presentation: TypedDeclaration<PresentationDeclaration>;
  readonly themes: readonly TypedDeclaration<ThemeDeclaration>[];
  readonly components: readonly PairedComponentDeclaration[];
};

export type PairAuthoringDeclarationsResult =
  | {
      readonly ok: true;
      readonly catalog: PairedAuthoringDeclarationCatalog;
      readonly diagnostics: [];
    }
  | { readonly ok: false; readonly diagnostics: readonly DeclarationCollectionDiagnostic[] };

const fallbackOrigin: DeclarationSourceOrigin = {
  fileName: "",
  start: 0,
  end: 0,
  line: 1,
  column: 1,
};

const compareDiagnostics = (
  left: DeclarationCollectionDiagnostic,
  right: DeclarationCollectionDiagnostic,
) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const samePath = (left: readonly (string | number)[], right: readonly (string | number)[]) =>
  left.length === right.length && left.every((segment, index) => segment === right[index]);

const originAt = (declaration: CollectedAuthoringDeclaration, path: readonly (string | number)[]) =>
  declaration.sourceMap.find((entry) => samePath(entry.path, path))?.origin ??
  declaration.sourceMap.find((entry) => entry.path.length === 0)?.origin ?? {
    ...fallbackOrigin,
    fileName: declaration.fileName,
  };

const diagnosticAt = (
  declaration: CollectedAuthoringDeclaration,
  path: readonly (string | number)[],
  code: string,
  message: string,
): DeclarationCollectionDiagnostic => ({ code, message, ...originAt(declaration, path) });

const pathForStructure = (manifestFileName: string, value: string): string | undefined => {
  const relative = value.startsWith("./") ? value.slice(2) : value;
  if (
    relative.length === 0 ||
    relative.endsWith("/") ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.startsWith("/")
  )
    return undefined;
  const directory = manifestFileName.split("/").slice(0, -1);
  const segments = [...directory];
  let hasNormalSegment = false;
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") return undefined;
    if (segment === "..") {
      if (hasNormalSegment || segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    hasNormalSegment = true;
    segments.push(segment);
  }
  return hasNormalSegment ? segments.join("/") : undefined;
};

const ownDataValue = (value: unknown, key: string): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
};

const potentialStructurePath = (declaration: CollectedAuthoringDeclaration): string | undefined => {
  const authoring = ownDataValue(declaration.value, "authoring");
  const structure = ownDataValue(authoring, "structure");
  return typeof structure === "string"
    ? pathForStructure(declaration.fileName, structure)
    : undefined;
};

const rootOrigin = (declaration: CollectedAuthoringDeclaration) => originAt(declaration, []);
const compareDeclarations = (
  left: CollectedAuthoringDeclaration,
  right: CollectedAuthoringDeclaration,
) => {
  const leftOrigin = rootOrigin(left);
  const rightOrigin = rootOrigin(right);
  return (
    (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
    leftOrigin.start - rightOrigin.start ||
    leftOrigin.end - rightOrigin.end ||
    (left.role < right.role ? -1 : left.role > right.role ? 1 : 0) ||
    (left.rootBuilder < right.rootBuilder ? -1 : left.rootBuilder > right.rootBuilder ? 1 : 0)
  );
};

const compareComponentDeclarations = (
  left: PairedComponentDeclaration,
  right: PairedComponentDeclaration,
) =>
  (left.manifest.value.componentId < right.manifest.value.componentId
    ? -1
    : left.manifest.value.componentId > right.manifest.value.componentId
      ? 1
      : 0) ||
  left.manifest.value.version - right.manifest.value.version ||
  compareDeclarations(left.manifest, right.manifest);

/** Pairs already-normalized static declarations without executing Authoring builders. */
export const pairAuthoringDeclarations = (
  input: CollectedAuthoringDeclarationsSuccess,
): PairAuthoringDeclarationsResult => {
  const declarations = [...input.declarations].sort(compareDeclarations);
  const diagnostics: DeclarationCollectionDiagnostic[] = [];
  const presentations: TypedDeclaration<PresentationDeclaration>[] = [];
  const themes: TypedDeclaration<ThemeDeclaration>[] = [];
  const manifests: TypedDeclaration<ComponentManifest>[] = [];
  const structures: TypedDeclaration<ComponentStructure>[] = [];
  const rawStructureFiles = new Set(
    declarations
      .filter((declaration) => declaration.role === "component-structure")
      .map((declaration) => declaration.fileName),
  );
  const presentationCount = declarations.filter(
    (declaration) => declaration.role === "presentation",
  ).length;
  const potentiallyReferencedStructureFiles = new Set<string>();

  for (const declaration of declarations) {
    switch (declaration.role) {
      case "presentation":
        if (isPresentationDeclaration(declaration.value))
          presentations.push(declaration as TypedDeclaration<PresentationDeclaration>);
        else
          diagnostics.push(
            diagnosticAt(
              declaration,
              [],
              "compiler-invalid-declaration",
              "Presentation declaration failed Authoring SDK validation.",
            ),
          );
        break;
      case "theme":
        if (isThemeDeclaration(declaration.value))
          themes.push(declaration as TypedDeclaration<ThemeDeclaration>);
        else
          diagnostics.push(
            diagnosticAt(
              declaration,
              [],
              "compiler-invalid-declaration",
              "Theme declaration failed Authoring SDK validation.",
            ),
          );
        break;
      case "component-manifest":
        if (isComponentManifest(declaration.value))
          manifests.push(declaration as TypedDeclaration<ComponentManifest>);
        else {
          const structurePath = potentialStructurePath(declaration);
          if (structurePath) potentiallyReferencedStructureFiles.add(structurePath);
          diagnostics.push(
            diagnosticAt(
              declaration,
              [],
              "compiler-invalid-declaration",
              "Component manifest declaration failed Authoring SDK validation.",
            ),
          );
        }
        break;
      case "component-structure":
        if (isComponentStructure(declaration.value))
          structures.push(declaration as TypedDeclaration<ComponentStructure>);
        else
          diagnostics.push(
            diagnosticAt(
              declaration,
              [],
              "compiler-invalid-declaration",
              "Component structure declaration failed Authoring SDK validation.",
            ),
          );
        break;
    }
  }

  if (presentationCount !== 1) {
    const declaration =
      declarations.find((item) => item.role === "presentation") ?? declarations[0];
    if (declaration)
      diagnostics.push(
        diagnosticAt(
          declaration,
          [],
          "compiler-presentation-declaration-count-invalid",
          "Exactly one presentation declaration is required.",
        ),
      );
    else
      diagnostics.push({
        code: "compiler-presentation-declaration-count-invalid",
        message: "Exactly one presentation declaration is required.",
        ...fallbackOrigin,
      });
  }

  const themesById = new Map<string, TypedDeclaration<ThemeDeclaration>>();
  for (const theme of themes) {
    const existing = themesById.get(theme.value.id);
    if (existing)
      diagnostics.push(
        diagnosticAt(
          theme,
          ["id"],
          "compiler-theme-duplicate",
          `Theme id '${theme.value.id}' is declared more than once.`,
        ),
      );
    else themesById.set(theme.value.id, theme);
  }

  const manifestsByIdentity = new Map<string, TypedDeclaration<ComponentManifest>>();
  for (const manifest of manifests) {
    const identity = `${manifest.value.componentId}\0${manifest.value.version}`;
    const existing = manifestsByIdentity.get(identity);
    if (existing) {
      diagnostics.push(
        diagnosticAt(
          manifest,
          ["componentId"],
          "compiler-component-manifest-duplicate",
          `Component id '${manifest.value.componentId}' is declared more than once.`,
        ),
      );
      continue;
    }
    manifestsByIdentity.set(identity, manifest);
    const authoring = manifest.value.authoring;
    if (authoring.mode === "opaque") {
      diagnostics.push(
        diagnosticAt(
          manifest,
          ["authoring", "mode"],
          "compiler-opaque-component-unsupported",
          "Opaque component authoring is not supported by this milestone.",
        ),
      );
      continue;
    }
  }

  const structuresByFile = new Map(structures.map((structure) => [structure.fileName, structure]));
  const referencedStructures = new Set<TypedDeclaration<ComponentStructure>>();
  const components: PairedComponentDeclaration[] = [];
  for (const manifest of manifestsByIdentity.values()) {
    const authoring = manifest.value.authoring;
    if (authoring.mode !== "structured") continue;
    const structurePath = pathForStructure(manifest.fileName, authoring.structure);
    if (!structurePath) {
      diagnostics.push(
        diagnosticAt(
          manifest,
          ["authoring", "structure"],
          "compiler-component-structure-entry-invalid",
          "Structured component authoring.structure must be a root-contained POSIX relative file path.",
        ),
      );
      continue;
    }
    const structure = structuresByFile.get(structurePath);
    if (!structure && !rawStructureFiles.has(structurePath)) {
      diagnostics.push(
        diagnosticAt(
          manifest,
          ["authoring", "structure"],
          "compiler-component-structure-not-found",
          `No collected component structure exists at '${structurePath}'.`,
        ),
      );
      continue;
    }
    if (!structure) continue;
    referencedStructures.add(structure);
    if (structure.value.componentId !== manifest.value.componentId) {
      diagnostics.push(
        diagnosticAt(
          structure,
          ["componentId"],
          "compiler-component-identity-mismatch",
          `Structure component id '${structure.value.componentId}' does not match manifest component id '${manifest.value.componentId}'.`,
        ),
      );
      continue;
    }
    components.push({ manifest, structure });
  }
  for (const structure of structures) {
    if (
      referencedStructures.has(structure) ||
      potentiallyReferencedStructureFiles.has(structure.fileName)
    )
      continue;
    diagnostics.push(
      diagnosticAt(
        structure,
        [],
        "compiler-component-structure-unreferenced",
        `Component structure '${structure.fileName}' is not referenced by a structured component manifest.`,
      ),
    );
  }

  if (diagnostics.length !== 0)
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  return {
    ok: true,
    catalog: {
      presentation: presentations[0]!,
      themes: [...themesById.values()].sort(compareDeclarations),
      components: components.sort(compareComponentDeclarations),
    },
    diagnostics: [],
  };
};

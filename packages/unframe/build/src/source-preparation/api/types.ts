import type { ComponentPackageLock } from "@unframe/authoring";
import type { Diagnostic } from "@unframe/presentation";
import type { PairedAuthoringDeclarationCatalog } from "@unframe/source";
import type { CompilerSourceAsset } from "@unframe/compiler";

export type DeclarationProjectThemeHash = {
  readonly themeId: string;
  readonly hash: string;
};
export type DeclarationProjectComponentLock = ComponentPackageLock & {
  readonly componentId: string;
  readonly version: number;
};
export type DeclarationProjectAssemblyInput = {
  readonly catalog: PairedAuthoringDeclarationCatalog;
  readonly themeHashes: readonly DeclarationProjectThemeHash[];
  readonly componentLocks: readonly DeclarationProjectComponentLock[];
  readonly assets: Readonly<Record<string, CompilerSourceAsset>>;
};
export type DeclarationProjectAssemblyCarrier = Omit<DeclarationProjectAssemblyInput, "catalog">;
export type AuthoringProjectPipelineResult<T> =
  | { readonly valid: true; readonly value: T; readonly diagnostics: [] }
  | {
      readonly valid: false;
      readonly phase: "source";
      readonly diagnostics: readonly import("@unframe/source").AuthoringProjectDiagnostic[];
    }
  | {
      readonly valid: false;
      readonly phase: "assembly" | "compile";
      readonly diagnostics: readonly Diagnostic[];
    };

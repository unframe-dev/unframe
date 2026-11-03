import type { ComponentPackageLock } from "@unframe-dev/authoring";
import type { Diagnostic } from "@unframe-dev/presentation";
import type { PairedAuthoringDeclarationCatalog } from "@unframe-dev/source";
import type { CompilerSourceAsset } from "@unframe-dev/compiler";

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
      readonly diagnostics: readonly import("@unframe-dev/source").AuthoringProjectDiagnostic[];
    }
  | {
      readonly valid: false;
      readonly phase: "assembly" | "compile";
      readonly diagnostics: readonly Diagnostic[];
    };

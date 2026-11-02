export type CompilerStage =
  | "source"
  | "assembly"
  | "frozen-input"
  | "input"
  | "check"
  | "renderer-validation"
  | "cache"
  | "planning"
  | "rendering"
  | "encoding"
  | "artifacts";

export class CompilerInternalError extends Error {
  readonly code = "compiler-internal-error";

  constructor(
    readonly stage: CompilerStage,
    cause: unknown,
  ) {
    super(`Compiler failed during ${stage}.`, { cause });
    this.name = "CompilerInternalError";
  }
}

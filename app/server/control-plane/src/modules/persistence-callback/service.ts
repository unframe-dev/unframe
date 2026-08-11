import type { CheckpointInput, CompletionInput } from "./schema";

export type PersistenceResult = "applied" | "duplicate" | "not_found";

export type PersistenceCallbackRepository = {
  applyCheckpoint(value: CheckpointInput): Promise<PersistenceResult>;
  applyCompletion(value: CompletionInput): Promise<PersistenceResult>;
};

export class PersistenceCallbackError extends Error {
  constructor(readonly code: "not_found") {
    super(code);
  }
}

export class PersistenceCallbackService {
  constructor(private readonly repository: PersistenceCallbackRepository) {}

  async checkpoint(value: CheckpointInput) {
    return this.result(await this.repository.applyCheckpoint(value));
  }

  async complete(value: CompletionInput) {
    return this.result(await this.repository.applyCompletion(value));
  }

  private result(result: PersistenceResult) {
    if (result === "not_found") throw new PersistenceCallbackError("not_found");
    return { applied: result === "applied" };
  }
}

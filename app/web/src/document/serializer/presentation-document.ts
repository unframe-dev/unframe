import { migrateDocument } from "../migrations/migrate-document";

export class DocumentSerializationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentSerializationError";
  }
}

export function serializePresentationDocument(input: unknown): string {
  return JSON.stringify(migrateDocument(input));
}

export function deserializePresentationDocument(serialized: string) {
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch (error) {
    throw new DocumentSerializationError("Document JSON could not be parsed", {
      cause: error,
    });
  }

  return migrateDocument(input);
}

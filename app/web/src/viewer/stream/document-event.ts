import { z } from "zod";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import { applyCommand } from "../../editor/commands/apply-command";
import { EditorCommandSchema, type EditorCommand } from "../../editor/commands/editor-command";

export const DocumentEventSchema = z.object({
  presentationId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  command: EditorCommandSchema,
});

export type DocumentEvent = z.infer<typeof DocumentEventSchema>;

export class RevisionGapError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly receivedRevision: number,
  ) {
    super(`Expected document revision ${expectedRevision}, received ${receivedRevision}`);
    this.name = "RevisionGapError";
  }
}

export class PresentationMismatchError extends Error {
  constructor(readonly presentationId: string) {
    super(`Document event targets a different presentation: ${presentationId}`);
    this.name = "PresentationMismatchError";
  }
}

export function createDocumentEvent(
  document: PresentationDocument,
  command: EditorCommand,
): DocumentEvent {
  return DocumentEventSchema.parse({
    presentationId: document.id,
    baseRevision: document.revision,
    revision: document.revision + 1,
    command,
  });
}

export function applyDocumentEvent(
  document: PresentationDocument,
  input: DocumentEvent,
): PresentationDocument {
  const event = DocumentEventSchema.parse(input);
  if (event.presentationId !== document.id) {
    throw new PresentationMismatchError(event.presentationId);
  }

  const expectedRevision = document.revision + 1;
  if (event.baseRevision !== document.revision || event.revision !== expectedRevision) {
    throw new RevisionGapError(expectedRevision, event.revision);
  }

  const result = applyCommand(document, event.command);
  if (result.document.revision !== event.revision) {
    throw new RevisionGapError(event.revision, result.document.revision);
  }
  return result.document;
}

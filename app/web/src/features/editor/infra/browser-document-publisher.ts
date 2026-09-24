import type { PresentationDocument } from "@/features/editor/model/presentation-document";
import {
  deserializePresentationDocument,
  serializePresentationDocument,
} from "@/features/editor/model/presentation-document-serializer";
import {
  applyDocumentEvent,
  DocumentEventSchema,
  type DocumentEvent,
  type DocumentPublisher,
} from "@/features/editor/model/document-event";

export interface SnapshotStore {
  load(presentationId: string): Promise<PresentationDocument | null>;
  save(document: PresentationDocument): Promise<void>;
}

export class SnapshotNotFoundError extends Error {
  constructor(readonly presentationId: string) {
    super(`No snapshot exists for presentation ${presentationId}`);
    this.name = "SnapshotNotFoundError";
  }
}

export class BrowserSnapshotStore implements SnapshotStore {
  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly keyPrefix = "unframe:presentation:",
  ) {}

  async load(presentationId: string): Promise<PresentationDocument | null> {
    const serialized = this.storage.getItem(`${this.keyPrefix}${presentationId}`);
    return serialized ? deserializePresentationDocument(serialized) : null;
  }

  async save(document: PresentationDocument): Promise<void> {
    this.storage.setItem(
      `${this.keyPrefix}${document.id}`,
      serializePresentationDocument(document),
    );
  }
}

export class BrowserDocumentPublisher implements DocumentPublisher {
  constructor(private readonly snapshots: SnapshotStore) {}

  async publish(input: DocumentEvent): Promise<void> {
    const event = DocumentEventSchema.parse(input);
    const document = await this.snapshots.load(event.presentationId);
    if (!document || document.id !== event.presentationId) {
      throw new SnapshotNotFoundError(event.presentationId);
    }
    const nextDocument = applyDocumentEvent(document, event);
    await this.snapshots.save(nextDocument);
  }
}

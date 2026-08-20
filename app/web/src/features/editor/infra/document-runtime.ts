import { demoDocument } from "@/features/editor/model/demo-document";
import type { PresentationDocument } from "@/features/editor/model/presentation-document";
import {
  BrowserDocumentPublisher,
  BrowserSnapshotStore,
} from "@/features/editor/infra/browser-document-publisher";

export class PresentationNotFoundError extends Error {
  constructor(readonly presentationId: string) {
    super(`Presentation ${presentationId} is not available`);
    this.name = "PresentationNotFoundError";
  }
}

export const browserSnapshotStore = new BrowserSnapshotStore();
export const browserDocumentPublisher = new BrowserDocumentPublisher(browserSnapshotStore);

export async function loadPresentationSnapshot(
  presentationId: string,
): Promise<PresentationDocument> {
  if (presentationId !== demoDocument.id) {
    throw new PresentationNotFoundError(presentationId);
  }

  const existing = await browserSnapshotStore.load(presentationId);
  if (existing) return existing;

  const fixture = structuredClone(demoDocument);
  await browserSnapshotStore.save(fixture);
  return fixture;
}

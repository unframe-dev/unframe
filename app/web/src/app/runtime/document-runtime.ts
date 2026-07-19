import { demoDocument } from "../../document/fixtures/demo-document";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import {
  BroadcastChannelDocumentStream,
  BrowserSnapshotStore,
} from "../../viewer/stream/broadcast-channel-document-stream";

export class PresentationNotFoundError extends Error {
  constructor(readonly presentationId: string) {
    super(`Presentation ${presentationId} is not available`);
    this.name = "PresentationNotFoundError";
  }
}

export const browserSnapshotStore = new BrowserSnapshotStore();
export const browserDocumentStream = new BroadcastChannelDocumentStream(browserSnapshotStore);

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

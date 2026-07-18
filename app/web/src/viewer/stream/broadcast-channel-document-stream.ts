import type { PresentationDocument } from "../../document/schema/presentation-document";
import {
  deserializePresentationDocument,
  serializePresentationDocument,
} from "../../document/serializer/presentation-document";
import { applyDocumentEvent, DocumentEventSchema, type DocumentEvent } from "./document-event";

export type DocumentEventListener = (event: DocumentEvent) => void;
export type Unsubscribe = () => void;

export interface DocumentStream {
  loadSnapshot(presentationId: string): Promise<PresentationDocument>;
  publish(event: DocumentEvent): Promise<void>;
  subscribe(presentationId: string, listener: DocumentEventListener): Unsubscribe;
}

export interface SnapshotStore {
  load(presentationId: string): Promise<PresentationDocument | null>;
  save(document: PresentationDocument): Promise<void>;
}

type MessageListener = (event: MessageEvent<unknown>) => void;

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "message", listener: MessageListener): void;
  close(): void;
}

export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

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

const createBrowserChannel: BroadcastChannelFactory = (name) => new BroadcastChannel(name);

function channelName(presentationId: string): string {
  return `unframe:document:${presentationId}`;
}

export class BroadcastChannelDocumentStream implements DocumentStream {
  constructor(
    private readonly snapshots: SnapshotStore,
    private readonly createChannel: BroadcastChannelFactory = createBrowserChannel,
  ) {}

  async loadSnapshot(presentationId: string): Promise<PresentationDocument> {
    const document = await this.snapshots.load(presentationId);
    if (!document || document.id !== presentationId) {
      throw new SnapshotNotFoundError(presentationId);
    }
    return document;
  }

  async publish(input: DocumentEvent): Promise<void> {
    const event = DocumentEventSchema.parse(input);
    const document = await this.loadSnapshot(event.presentationId);
    const nextDocument = applyDocumentEvent(document, event);
    await this.snapshots.save(nextDocument);

    const channel = this.createChannel(channelName(event.presentationId));
    channel.postMessage(event);
    channel.close();
  }

  subscribe(presentationId: string, listener: DocumentEventListener): Unsubscribe {
    const channel = this.createChannel(channelName(presentationId));
    const handleMessage: MessageListener = (message) => {
      const result = DocumentEventSchema.safeParse(message.data);
      if (result.success && result.data.presentationId === presentationId) {
        listener(result.data);
      }
    };
    channel.addEventListener("message", handleMessage);

    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }
}

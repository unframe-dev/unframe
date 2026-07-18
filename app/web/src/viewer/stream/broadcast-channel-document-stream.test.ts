import { describe, expect, it } from "vitest";
import { demoDocument } from "../../document/fixtures/demo-document";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import { createDocumentEvent, type DocumentEvent } from "./document-event";
import {
  BroadcastChannelDocumentStream,
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
  type SnapshotStore,
} from "./broadcast-channel-document-stream";

class MemorySnapshotStore implements SnapshotStore {
  constructor(private document: PresentationDocument) {}

  async load() {
    return structuredClone(this.document);
  }

  async save(document: PresentationDocument) {
    this.document = structuredClone(document);
  }
}

function createFakeBroadcastChannelFactory(): BroadcastChannelFactory {
  const listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  return (name: string): BroadcastChannelLike => {
    const channelListeners = listeners.get(name) ?? new Set();
    listeners.set(name, channelListeners);

    return {
      postMessage(message) {
        for (const listener of channelListeners) {
          listener(new MessageEvent("message", { data: message }));
        }
      },
      addEventListener(_type, listener) {
        channelListeners.add(listener);
      },
      removeEventListener(_type, listener) {
        channelListeners.delete(listener);
      },
      close() {},
    };
  };
}

describe("BroadcastChannelDocumentStream", () => {
  it("publishes committed commands and advances the stored snapshot", async () => {
    const snapshots = new MemorySnapshotStore(demoDocument);
    const channels = createFakeBroadcastChannelFactory();
    const editor = new BroadcastChannelDocumentStream(snapshots, channels);
    const viewer = new BroadcastChannelDocumentStream(snapshots, channels);
    const received: DocumentEvent[] = [];
    const unsubscribe = viewer.subscribe("demo", (event) => received.push(event));
    const event = createDocumentEvent(demoDocument, {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { locked: true },
    });

    await editor.publish(event);

    expect(received).toEqual([event]);
    await expect(viewer.loadSnapshot("demo")).resolves.toMatchObject({
      revision: 1,
    });
    unsubscribe();
  });
});

import { describe, expect, it } from "vitest";
import { demoDocument } from "@/features/editor/model/demo-document";
import type { PresentationDocument } from "@/features/editor/model/presentation-document";
import { createDocumentEvent } from "@/features/editor/model/document-event";
import { BrowserDocumentPublisher, type SnapshotStore } from "./browser-document-publisher";

class MemorySnapshotStore implements SnapshotStore {
  constructor(private document: PresentationDocument) {}

  async load(_presentationId: string) {
    return structuredClone(this.document);
  }

  async save(document: PresentationDocument) {
    this.document = structuredClone(document);
  }
}

describe("BrowserDocumentPublisher", () => {
  it("persists committed commands in the browser snapshot", async () => {
    const snapshots = new MemorySnapshotStore(demoDocument);
    const publisher = new BrowserDocumentPublisher(snapshots);
    const event = createDocumentEvent(demoDocument, {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { locked: true },
    });

    await publisher.publish(event);

    await expect(snapshots.load("demo")).resolves.toMatchObject({
      revision: 1,
    });
  });
});

import { describe, expect, it } from "vitest";
import { demoDocument } from "@/features/editor/model/demo-document";
import { applyDocumentEvent, createDocumentEvent, RevisionGapError } from "./document-event";

describe("document events", () => {
  it("applies a continuous revision to the read-only document", () => {
    const command = {
      changes: { visible: false },
      elementId: "demo-model-element",
      type: "element.update",
    } as const;
    const event = createDocumentEvent(demoDocument, command);

    const next = applyDocumentEvent(demoDocument, event);

    expect(next.revision).toBe(1);
    expect(next.slides[0]?.elements[0]?.visible).toBe(false);
  });

  it("rejects a revision gap before applying the command", () => {
    const event = {
      baseRevision: 4,
      command: {
        changes: { visible: false },
        elementId: "demo-model-element",
        type: "element.update",
      },
      presentationId: "demo",
      revision: 5,
    } as const;

    expect(() => applyDocumentEvent(demoDocument, event)).toThrow(RevisionGapError);
    expect(demoDocument.revision).toBe(0);
  });
});

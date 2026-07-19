import { describe, expect, it } from "vitest";
import { demoDocument } from "../../document/fixtures/demo-document";
import { applyDocumentEvent, createDocumentEvent, RevisionGapError } from "./document-event";

describe("document events", () => {
  it("applies a continuous revision to the read-only document", () => {
    const command = {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { visible: false },
    } as const;
    const event = createDocumentEvent(demoDocument, command);

    const next = applyDocumentEvent(demoDocument, event);

    expect(next.revision).toBe(1);
    expect(next.slides[0]?.elements[0]?.visible).toBe(false);
  });

  it("rejects a revision gap before applying the command", () => {
    const event = {
      presentationId: "demo",
      baseRevision: 4,
      revision: 5,
      command: {
        type: "element.update",
        elementId: "demo-model-element",
        changes: { visible: false },
      },
    } as const;

    expect(() => applyDocumentEvent(demoDocument, event)).toThrow(RevisionGapError);
    expect(demoDocument.revision).toBe(0);
  });
});

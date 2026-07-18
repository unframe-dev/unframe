import { describe, expect, it } from "vitest";
import { demoDocument } from "../../document/fixtures/demo-document";
import { createHistoryState, executeCommand, redoCommand, undoCommand } from "./history";

describe("editor history", () => {
  it("increments revision for execute, undo, and redo", () => {
    const initial = createHistoryState(demoDocument);
    const executed = executeCommand(initial, {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { name: "Edited" },
    });
    const undone = undoCommand(executed);
    const redone = redoCommand(undone);

    expect(executed.document.revision).toBe(1);
    expect(undone.document.revision).toBe(2);
    expect(undone.document.slides[0]?.elements[0]?.name).toBe("Unframe sculpture");
    expect(redone.document.revision).toBe(3);
    expect(redone.document.slides[0]?.elements[0]?.name).toBe("Edited");
  });

  it("clears redo entries when a new command is executed", () => {
    const executed = executeCommand(createHistoryState(demoDocument), {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { locked: true },
    });
    const undone = undoCommand(executed);
    const diverged = executeCommand(undone, {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { visible: false },
    });

    expect(diverged.redoStack).toHaveLength(0);
    expect(redoCommand(diverged)).toBe(diverged);
  });

  it("returns the same state when no history entry is available", () => {
    const state = createHistoryState(demoDocument);

    expect(undoCommand(state)).toBe(state);
    expect(redoCommand(state)).toBe(state);
  });
});

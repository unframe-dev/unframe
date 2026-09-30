import { describe, expect, it } from "vitest";
import { demoDocument } from "@/features/editor/model/demo-document";
import { createHistoryState, executeCommand, redoCommand, undoCommand } from "./history";

describe("editor history", () => {
  it("increments revision for execute, undo, and redo", () => {
    const initial = createHistoryState(demoDocument);
    const executed = executeCommand(initial, {
      changes: { name: "Edited" },
      elementId: "demo-model-element",
      type: "element.update",
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
      changes: { locked: true },
      elementId: "demo-model-element",
      type: "element.update",
    });
    const undone = undoCommand(executed);
    const diverged = executeCommand(undone, {
      changes: { visible: false },
      elementId: "demo-model-element",
      type: "element.update",
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

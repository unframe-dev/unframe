import { describe, expect, it } from "vitest";

import {
  initialPresentationTuiState,
  presentationTuiCommands,
  reducePresentationTuiState,
} from "../src/tui/model.js";

describe("presentation TUI model", () => {
  it("wraps command selection without depending on a terminal renderer", () => {
    expect(presentationTuiCommands.map((command) => command.id)).toEqual(["check", "build"]);

    const previous = reducePresentationTuiState(initialPresentationTuiState, { type: "previous" });
    expect(previous.selectedIndex).toBe(1);
    expect(reducePresentationTuiState(previous, { type: "next" })).toEqual(
      initialPresentationTuiState,
    );
  });

  it("marks selection and quit as explicit effects", () => {
    const selected = reducePresentationTuiState(initialPresentationTuiState, { type: "select" });
    expect(selected.effect).toEqual({ type: "command-selected", command: "check" });

    const cleared = reducePresentationTuiState(selected, { type: "effect-handled" });
    expect(cleared.effect).toBeUndefined();
    expect(reducePresentationTuiState(cleared, { type: "quit" }).effect).toEqual({ type: "quit" });
  });
});

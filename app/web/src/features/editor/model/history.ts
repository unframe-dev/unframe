import type { PresentationDocument } from "@/features/editor/model/presentation-document";
import { applyCommand } from "./apply-command";
import type { EditorCommand } from "./editor-command";

export interface HistoryEntry {
  command: EditorCommand;
  inverse: EditorCommand;
}

export interface HistoryState {
  document: PresentationDocument;
  redoStack: ReadonlyArray<HistoryEntry>;
  undoStack: ReadonlyArray<HistoryEntry>;
}

export function createHistoryState(document: PresentationDocument): HistoryState {
  return { document, redoStack: [], undoStack: [] };
}

export function executeCommand(state: HistoryState, command: EditorCommand): HistoryState {
  const result = applyCommand(state.document, command);
  return {
    document: result.document,
    redoStack: [],
    undoStack: [...state.undoStack, { command, inverse: result.inverse }],
  };
}

export function undoCommand(state: HistoryState): HistoryState {
  const entry = state.undoStack.at(-1);
  if (!entry) {
    return state;
  }

  const result = applyCommand(state.document, entry.inverse);
  return {
    document: result.document,
    redoStack: [...state.redoStack, entry],
    undoStack: state.undoStack.slice(0, -1),
  };
}

export function redoCommand(state: HistoryState): HistoryState {
  const entry = state.redoStack.at(-1);
  if (!entry) {
    return state;
  }

  const result = applyCommand(state.document, entry.command);
  return {
    document: result.document,
    redoStack: state.redoStack.slice(0, -1),
    undoStack: [...state.undoStack, { command: entry.command, inverse: result.inverse }],
  };
}

import type { PresentationDocument } from "../../document/schema/presentation-document";
import { applyCommand } from "../commands/apply-command";
import type { EditorCommand } from "../commands/editor-command";

export interface HistoryEntry {
  command: EditorCommand;
  inverse: EditorCommand;
}

export interface HistoryState {
  document: PresentationDocument;
  undoStack: readonly HistoryEntry[];
  redoStack: readonly HistoryEntry[];
}

export function createHistoryState(document: PresentationDocument): HistoryState {
  return { document, undoStack: [], redoStack: [] };
}

export function executeCommand(state: HistoryState, command: EditorCommand): HistoryState {
  const result = applyCommand(state.document, command);
  return {
    document: result.document,
    undoStack: [...state.undoStack, { command, inverse: result.inverse }],
    redoStack: [],
  };
}

export function undoCommand(state: HistoryState): HistoryState {
  const entry = state.undoStack.at(-1);
  if (!entry) return state;

  const result = applyCommand(state.document, entry.inverse);
  return {
    document: result.document,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, entry],
  };
}

export function redoCommand(state: HistoryState): HistoryState {
  const entry = state.redoStack.at(-1);
  if (!entry) return state;

  const result = applyCommand(state.document, entry.command);
  return {
    document: result.document,
    undoStack: [...state.undoStack, { command: entry.command, inverse: result.inverse }],
    redoStack: state.redoStack.slice(0, -1),
  };
}
